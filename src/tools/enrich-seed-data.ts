/**
 * DreamGraph MCP Server — enrich_seed_data tool.
 *
 * Lets the LLM feed curated knowledge into the fact graph.  The LLM
 * reads source code (via code_senses, read_source_code, etc.) and then
 * calls this tool to push structured entity data to the server.
 *
 * The server validates, deduplicates, merges, and persists.  The LLM
 * never touches the files directly — this is the write interface.
 *
 * Supported targets:
 *   "features"     → features.json
 *   "workflows"    → workflows.json
 *   "data_model"   → data_model.json
 *
 * Modes:
 *   "merge"   (default) — upsert by id; existing entries are preserved,
 *             matching ids are updated, new ids are appended.
 *   "replace" — wipe existing data and write only the incoming entries.
 *             Use this when the LLM has a complete, authoritative view
 *             and wants to do a clean replacement of stale init_graph data.
 *
 * Both modes:
 *   - Template/schema stubs (_schema, _fields, _note) are auto-removed.
 *   - The resource index (index.json) is rebuilt after every write.
 *   - Cache is invalidated so subsequent reads see fresh data.
 *
 * Protection: Seed data tier — only init_graph and enrich_seed_data
 * are allowed to write these files.
 */

import { z } from "zod";
import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataPath } from "../utils/paths.js";
import { loadJsonArray, invalidateCache } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  Feature,
  Workflow,
  DataModelEntity,
  CapabilityEntity,
  IndexEntry,
  ResourceIndex,
  GraphLink,
  WorkflowStep,
  EntityField,
  EntityRelationship,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Zod schemas for LLM-supplied entity data
// ---------------------------------------------------------------------------

// Lenient schemas: accept both full objects AND plain strings.
// LLMs frequently send simplified forms; we coerce them to full objects.

const GraphLinkSchema = z.object({
  target: z.string(),
  type: z.enum(["feature", "workflow", "data_model"]).default("feature"),
  relationship: z.string().default("related_to"),
  description: z.string().default(""),
  strength: z.enum(["strong", "moderate", "weak"]).default("moderate"),
}).passthrough();

/** Accept full GraphLink object OR a plain string (coerced to a link target). */
const GraphLinkLenient = z.union([
  GraphLinkSchema,
  z.string().transform((s) => ({
    target: s,
    type: "feature" as const,
    relationship: "related_to",
    description: "",
    strength: "moderate" as const,
  })),
]);

/** Accept a string path or an object like {path: "..."}. */
const SourceFileItem = z.union([
  z.string(),
  z.object({ path: z.string() }).transform((o) => o.path),
  z.object({ file: z.string() }).transform((o) => o.file),
  z.object({ rel: z.string() }).transform((o) => o.rel),
]);

const FeatureEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  source_repo: z.string().default(""),
  source_files: z.array(SourceFileItem).default([]),
  status: z.string().default("active"),
  category: z.string().default("core"),
  tags: z.array(z.string()).default([]),
  domain: z.string().default("core"),
  keywords: z.array(z.string()).default([]),
  links: z.array(GraphLinkLenient).default([]),
}).passthrough();

const WorkflowStepSchema = z.object({
  order: z.number().default(0),
  name: z.string(),
  description: z.string().default(""),
});

/** Accept full step object OR a plain string (coerced to a named step). */
const WorkflowStepLenient = z.union([
  WorkflowStepSchema,
  z.string().transform((s) => ({
    order: 0,
    name: s,
    description: "",
  })),
]);

const WorkflowEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  trigger: z.string().default(""),
  source_repo: z.string().default(""),
  source_files: z.array(SourceFileItem).default([]),
  domain: z.string().default("core"),
  keywords: z.array(z.string()).default([]),
  status: z.string().default("active"),
  steps: z.array(WorkflowStepLenient).default([]),
  links: z.array(GraphLinkLenient).default([]),
}).passthrough();

const EntityFieldSchema = z.object({
  name: z.string(),
  type: z.string(),
  description: z.string().default(""),
});

/** Accept full field object OR a plain string (coerced to a named field). */
const EntityFieldLenient = z.union([
  EntityFieldSchema,
  z.string().transform((s) => ({ name: s, type: "unknown", description: "" })),
]);

const EntityRelationshipSchema = z.object({
  type: z.string(),
  target: z.string(),
  via: z.string().default(""),
});

/** Accept full rel object OR a plain string (coerced to a references target). */
const EntityRelationshipLenient = z.union([
  EntityRelationshipSchema,
  z.string().transform((s) => ({ type: "references", target: s, via: "" })),
]);

const DataModelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  table_name: z.string().default(""),
  storage: z.string().default("unknown"),
  source_repo: z.string().default(""),
  source_files: z.array(SourceFileItem).default([]),
  domain: z.string().default("core"),
  keywords: z.array(z.string()).default([]),
  status: z.string().default("active"),
  key_fields: z.array(EntityFieldLenient).default([]),
  relationships: z.array(EntityRelationshipLenient).default([]),
  links: z.array(GraphLinkLenient).default([]),
}).passthrough();

const CapabilityEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  source_repo: z.string().default(""),
  source_files: z.array(SourceFileItem).default([]),
  category: z.string().default("core"),
  status: z.string().default("active"),
  tags: z.array(z.string()).default([]),
  domain: z.string().default("core"),
  keywords: z.array(z.string()).default([]),
  links: z.array(GraphLinkLenient).default([]),
}).passthrough();

// ---------------------------------------------------------------------------
// Target file mapping
// ---------------------------------------------------------------------------

type SeedTarget = "features" | "workflows" | "data_model" | "capabilities";

const TARGET_FILES: Record<SeedTarget, string> = {
  features: "features.json",
  workflows: "workflows.json",
  data_model: "data_model.json",
  capabilities: "capabilities.json",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove template/schema stub entries that have _schema/_fields/_note keys */
function stripTemplateStubs<T>(arr: T[]): T[] {
  return arr.filter(
    (e) => {
      const obj = e as Record<string, unknown>;
      return !("_schema" in obj) && !("_fields" in obj) && !("_note" in obj);
    },
  );
}

/** Merge new entries into existing by id (upsert) */
function mergeById<T>(existing: T[], incoming: T[]): { merged: T[]; inserted: number; updated: number } {
  const map = new Map<string, T>();
  for (const e of existing) map.set((e as Record<string, unknown>).id as string, e);

  let inserted = 0;
  let updated = 0;

  for (const entry of incoming) {
    const id = (entry as Record<string, unknown>).id as string;
    if (map.has(id)) {
      updated++;
    } else {
      inserted++;
    }
    map.set(id, entry);
  }

  return { merged: [...map.values()], inserted, updated };
}

/** Rebuild index.json from all four seed files */
async function rebuildIndex(): Promise<number> {
  const features = await loadJsonArray<Feature>("features.json");
  const workflows = await loadJsonArray<Workflow>("workflows.json");
  const dataModel = await loadJsonArray<DataModelEntity>("data_model.json");
  const capabilities = await loadJsonArray<CapabilityEntity>("capabilities.json");

  const entities: Record<string, IndexEntry> = {};

  for (const f of stripTemplateStubs(features)) {
    entities[f.id] = {
      type: "feature",
      uri: `dreamgraph://resource/feature/${f.id}`,
      name: f.name,
      source_repo: f.source_repo,
    };
  }
  for (const w of stripTemplateStubs(workflows)) {
    entities[w.id] = {
      type: "workflow",
      uri: `dreamgraph://resource/workflow/${w.id}`,
      name: w.name,
      source_repo: w.source_repo,
    };
  }
  for (const d of stripTemplateStubs(dataModel)) {
    entities[d.id] = {
      type: "data_model",
      uri: `dreamgraph://resource/data_model/${d.id}`,
      name: d.name,
      source_repo: d.source_repo,
    };
  }
  for (const c of stripTemplateStubs(capabilities)) {
    entities[c.id] = {
      type: "capability",
      uri: `dreamgraph://resource/capability/${c.id}`,
      name: c.name,
      source_repo: c.source_repo,
    };
  }

  const index: ResourceIndex = { entities };
  await fs.writeFile(dataPath("index.json"), JSON.stringify(index, null, 2), "utf-8");
  invalidateCache("index.json");
  return Object.keys(entities).length;
}

/** Write a seed file and invalidate cache */
async function writeSeed(filename: string, data: unknown): Promise<void> {
  await fs.writeFile(dataPath(filename), JSON.stringify(data, null, 2), "utf-8");
  invalidateCache(filename);
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

interface EnrichResult {
  target: SeedTarget;
  file: string;
  mode: "merge" | "replace";
  entries_received: number;
  entries_inserted: number;
  entries_updated: number;
  total_entries: number;
  index_entries: number;
  validation_errors: string[];
  message: string;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerEnrichSeedDataTool(server: McpServer): void {
  server.tool(
    "enrich_seed_data",
    "Feed curated knowledge into the fact graph. Use this after reading source code " +
    "to populate features, workflows, data model, and capability entities. The server validates " +
    "structure, merges by ID (upsert), strips template stubs, and rebuilds the " +
    "resource index. Pass structured entity data — the server manages persistence. " +
    "Call once per target or batch multiple entities in a single call. " +
    "Use mode='replace' to do a clean replacement when you have complete knowledge.",
    {
      target: z
        .enum(["features", "workflows", "data_model", "capabilities"])
        .describe("Which seed data file to enrich"),
      entries: z
        .array(z.record(z.string(), z.unknown()))
        .min(1)
        .describe(
          "Array of entity objects. Each MUST have 'id' (string) and 'name' (string). " +
          "Common optional fields: description, source_repo, source_files (string[]), " +
          "domain, keywords (string[]), status, tags (string[]), " +
          "links (array of {target, type, relationship, description, strength} — or plain target strings). " +
          "Features additionally: category. " +
          "Capabilities additionally: category. " +
          "Workflows additionally: trigger, steps (array of {order, name, description} — or plain step-name strings). " +
          "Data model additionally: table_name, storage, " +
          "key_fields (array of {name, type, description} — or plain field-name strings), " +
          "relationships (array of {type, target, via} — or plain target strings). " +
          "Simple string values are auto-coerced to full objects where possible.",
        ),
      mode: z
        .enum(["merge", "replace"])
        .default("merge")
        .describe(
          "merge (default): upsert by id — preserves existing entries, updates matching ids, appends new ones. " +
          "replace: wipe existing data and write only the incoming entries. " +
          "Use replace when you have a complete view and want to clean out stale init_graph entries.",
        ),
    },
    async ({ target, entries, mode }) => {
      logger.info(`enrich_seed_data: ${entries.length} entries for '${target}' (mode=${mode})`);

      const result = await safeExecute<EnrichResult>(
        async (): Promise<ToolResponse<EnrichResult>> => {
          const filename = TARGET_FILES[target];
          const validationErrors: string[] = [];

          // ----- Validate entries against the target schema -----
          let validated: Array<Feature | Workflow | DataModelEntity | CapabilityEntity>;

          switch (target) {
            case "features": {
              validated = [];
              for (const raw of entries) {
                const parsed = FeatureEntrySchema.safeParse(raw);
                if (parsed.success) {
                  validated.push(parsed.data as unknown as Feature);
                } else {
                  validationErrors.push(
                    `Feature entry '${(raw as Record<string, unknown>).id ?? "?"}': ${parsed.error.issues.map((i) => i.message).join("; ")}`,
                  );
                }
              }
              break;
            }
            case "workflows": {
              validated = [];
              for (const raw of entries) {
                const parsed = WorkflowEntrySchema.safeParse(raw);
                if (parsed.success) {
                  // Re-number steps that have order=0 (from string coercion or missing order)
                  const wf = parsed.data as unknown as Workflow;
                  if (wf.steps?.length) {
                    const needsRenumber = wf.steps.some((s: WorkflowStep) => s.order === 0);
                    if (needsRenumber) {
                      wf.steps.forEach((s: WorkflowStep, i: number) => { s.order = i + 1; });
                    }
                  }
                  validated.push(wf);
                } else {
                  validationErrors.push(
                    `Workflow entry '${(raw as Record<string, unknown>).id ?? "?"}': ${parsed.error.issues.map((i) => i.message).join("; ")}`,
                  );
                }
              }
              break;
            }
            case "data_model": {
              validated = [];
              for (const raw of entries) {
                const parsed = DataModelEntrySchema.safeParse(raw);
                if (parsed.success) {
                  validated.push(parsed.data as unknown as DataModelEntity);
                } else {
                  validationErrors.push(
                    `Data model entry '${(raw as Record<string, unknown>).id ?? "?"}': ${parsed.error.issues.map((i) => i.message).join("; ")}`,
                  );
                }
              }
              break;
            }
            case "capabilities": {
              validated = [];
              for (const raw of entries) {
                const parsed = CapabilityEntrySchema.safeParse(raw);
                if (parsed.success) {
                  validated.push(parsed.data as unknown as CapabilityEntity);
                } else {
                  validationErrors.push(
                    `Capability entry '${(raw as Record<string, unknown>).id ?? "?"}': ${parsed.error.issues.map((i) => i.message).join("; ")}`,
                  );
                }
              }
              break;
            }
          }

          if (validated.length === 0) {
            return error(
              "NO_VALID_ENTRIES",
              `All ${entries.length} entries failed validation: ${validationErrors.join(" | ")}`,
            );
          }

          // ----- Load existing, strip stubs, merge or replace -----
          type SeedEntity = Feature | Workflow | DataModelEntity | CapabilityEntity;

          let merged: SeedEntity[];
          let inserted: number;
          let updated: number;

          if (mode === "replace") {
            // Clean replacement — ignore existing, write only validated entries
            merged = validated;
            inserted = validated.length;
            updated = 0;
            logger.info(
              `enrich_seed_data: replace mode — discarding existing ${filename} data`,
            );
          } else {
            // Merge mode — upsert by id
            const existing = stripTemplateStubs(
              await loadJsonArray<SeedEntity>(filename),
            );
            const mergeResult = mergeById<SeedEntity>(existing, validated);
            merged = mergeResult.merged;
            inserted = mergeResult.inserted;
            updated = mergeResult.updated;
          }

          // ----- Write merged data -----
          await writeSeed(filename, merged);
          logger.info(
            `enrich_seed_data: wrote ${filename} — ${inserted} new, ${updated} updated, ${merged.length} total`,
          );

          // ----- Rebuild index -----
          const indexEntries = await rebuildIndex();
          logger.info(`enrich_seed_data: index rebuilt with ${indexEntries} entries`);

          const modeLabel = mode === "replace" ? "Replaced" : "Enriched";
          const summary =
            `${modeLabel} ${target}: ${inserted} inserted, ${updated} updated, ${merged.length} total entries. ` +
            `Index: ${indexEntries} entries.` +
            (validationErrors.length > 0
              ? ` ${validationErrors.length} entries skipped (validation errors).`
              : "");

          return success<EnrichResult>({
            target,
            file: filename,
            mode,
            entries_received: entries.length,
            entries_inserted: inserted,
            entries_updated: updated,
            total_entries: merged.length,
            index_entries: indexEntries,
            validation_errors: validationErrors,
            message: summary,
          });
        },
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
