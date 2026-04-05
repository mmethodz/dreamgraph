/**
 * DreamGraph MCP Server — Semantic UI Registry tools.
 *
 * Three tools for managing platform-independent UI element definitions:
 *   register_ui_element — Register or update a semantic element
 *   query_ui_elements — Search by category, platform, purpose, or feature
 *   generate_ui_migration_plan — Gap analysis between source and target platforms
 *
 * The registry describes WHAT elements are (purpose, data contract,
 * interaction model), not HOW they look. No code generation.
 *
 * Data file: data/ui_registry.json
 */

import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  UIRegistryFile,
  SemanticElement,
  RegisterUIElementOutput,
  QueryUIElementsOutput,
  GenerateUIMigrationOutput,
  MigrationPortedElement,
  MigrationGapElement,
  ToolResponse,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const REGISTRY_PATH = resolve(config.dataDir, "ui_registry.json");

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function loadRegistry(): Promise<UIRegistryFile> {
  try {
    if (!existsSync(REGISTRY_PATH)) return emptyRegistry();
    const raw = await readFile(REGISTRY_PATH, "utf-8");
    return JSON.parse(raw) as UIRegistryFile;
  } catch {
    return emptyRegistry();
  }
}

async function saveRegistry(data: UIRegistryFile): Promise<void> {
  data.metadata.total_elements = data.elements.length;
  const categories = new Set(data.elements.map((e) => e.category));
  data.metadata.total_categories = categories.size;
  data.metadata.last_updated = new Date().toISOString();
  await writeFile(REGISTRY_PATH, JSON.stringify(data, null, 2), "utf-8");
  logger.debug("UI registry saved to disk");
}

function emptyRegistry(): UIRegistryFile {
  return {
    metadata: {
      description:
        "Semantic UI Registry — platform-independent element definitions with purpose, data contract, and interaction model.",
      schema_version: "1.0.0",
      total_elements: 0,
      total_categories: 0,
      last_updated: null,
    },
    elements: [],
  };
}

// ---------------------------------------------------------------------------
// Complexity heuristic for migration planning
// ---------------------------------------------------------------------------

function estimateComplexity(
  el: SemanticElement
): "trivial" | "moderate" | "complex" {
  const inputCount = el.data_contract.inputs.length;
  const outputCount = el.data_contract.outputs.length;
  const hasChildren = (el.children?.length ?? 0) > 0;

  if (el.category === "composite") return "complex";
  if (inputCount + outputCount >= 5) return "complex";
  if (inputCount + outputCount >= 2 || hasChildren) return "moderate";
  return "trivial";
}

// ---------------------------------------------------------------------------
// Zod enum for categories (shared across tools)
// ---------------------------------------------------------------------------

const categoryEnum = z.enum([
  "data_display",
  "data_input",
  "navigation",
  "feedback",
  "layout",
  "action",
  "composite",
]);

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerUIRegistryTools(server: McpServer): void {
  // =========================================================================
  // register_ui_element
  // =========================================================================

  server.tool(
    "register_ui_element",
    "Register a semantic UI element with its purpose, data contract, and interaction model. Platform-independent: describes what the element IS, not how it looks. If the element already exists, implementations are merged and other fields are updated.",
    {
      id: z
        .string()
        .describe(
          'Unique identifier, e.g. "data_table", "filter_bar", "entity_profile"'
        ),
      name: z.string().describe("Human-readable name"),
      purpose: z
        .string()
        .describe("The deep intent — what this element exists to do"),
      category: categoryEnum.describe("Category of UI element"),
      inputs: z
        .array(
          z.object({
            name: z.string(),
            type: z.string().describe('"array<T>", "object", "string", etc.'),
            description: z.string(),
            required: z.boolean(),
          })
        )
        .describe("What data this element consumes"),
      outputs: z
        .array(
          z.object({
            name: z.string(),
            type: z.string(),
            description: z.string(),
            trigger: z
              .string()
              .describe('"on_click", "on_change", "on_submit", etc.'),
          })
        )
        .describe("What data this element emits"),
      interactions: z
        .array(
          z.object({
            action: z
              .string()
              .describe('"sort", "filter", "select", "edit_inline", etc.'),
            description: z.string(),
          })
        )
        .describe("What the user can do with this element"),
      children: z
        .array(z.string())
        .optional()
        .describe("SemanticElement IDs of child elements"),
      implementations: z
        .array(
          z.object({
            platform: z
              .string()
              .describe('"react", "maui", "swiftui", "html", "flutter"'),
            component: z
              .string()
              .describe('"DataGrid", "UITableView", "<table>", etc.'),
            source_file: z.string().optional(),
            notes: z.string().optional(),
          })
        )
        .optional()
        .describe("Known platform implementations"),
      used_by: z
        .array(z.string())
        .optional()
        .describe("Feature IDs that use this element"),
      tags: z.array(z.string()).optional().describe("Tags for searchability"),

      // Optional enrichment (Category 1)
      state: z
        .record(z.string(), z.enum(["boolean", "string", "number"]))
        .optional()
        .describe(
          'Observable state flags, e.g. { "is_generating": "boolean", "has_image": "boolean" }'
        ),
      flows: z
        .array(z.string())
        .optional()
        .describe(
          'Ordered workflow flows, e.g. ["prompt → generate → display → edit → save"]'
        ),
      error_states: z
        .array(
          z.object({
            condition: z.string().describe("When this error occurs"),
            behavior: z.string().describe("How the element responds"),
            severity: z
              .enum(["info", "warning", "error", "fatal"])
              .optional()
              .describe("Severity level"),
          })
        )
        .optional()
        .describe("Known error/edge-case states"),
      rendering_capabilities: z
        .array(z.string())
        .optional()
        .describe(
          'Capability-based abstraction, e.g. ["touch", "mouse", "keyboard", "voice"]'
        ),

      // Derivable metadata (Category 2)
      is_async: z
        .boolean()
        .optional()
        .describe("Whether the element involves async operations"),
      default_action: z
        .string()
        .optional()
        .describe("Default/primary action when invoked without specifics"),
      visibility_conditions: z
        .array(z.string())
        .optional()
        .describe(
          'Conditions controlling visibility, e.g. ["has_api_key", "has_image"]'
        ),
    },
    async (params) => {
      logger.debug(`register_ui_element called: "${params.id}"`);

      const result = await safeExecute<RegisterUIElementOutput>(
        async (): Promise<ToolResponse<RegisterUIElementOutput>> => {
          const registry = await loadRegistry();
          const existing = registry.elements.find((e) => e.id === params.id);
          let merged = false;

          if (existing) {
            // Merge: append implementations (no dup by platform), union used_by, overwrite rest
            existing.name = params.name;
            existing.purpose = params.purpose;
            existing.category = params.category;
            existing.data_contract = {
              inputs: params.inputs,
              outputs: params.outputs,
            };
            existing.interactions = params.interactions;
            if (params.children) existing.children = params.children;
            existing.tags = params.tags ?? existing.tags;

            // Category 1 – optional enrichment (overwrite when supplied)
            if (params.state !== undefined) existing.state = params.state;
            if (params.flows !== undefined) existing.flows = params.flows;
            if (params.error_states !== undefined)
              existing.error_states = params.error_states;
            if (params.rendering_capabilities !== undefined)
              existing.rendering_capabilities = params.rendering_capabilities;

            // Category 2 – derivable metadata (overwrite when supplied)
            if (params.is_async !== undefined) existing.is_async = params.is_async;
            if (params.default_action !== undefined)
              existing.default_action = params.default_action;
            if (params.visibility_conditions !== undefined)
              existing.visibility_conditions = params.visibility_conditions;

            // Merge implementations (no duplicate platforms)
            const newImpls = params.implementations ?? [];
            for (const impl of newImpls) {
              const idx = existing.implementations.findIndex(
                (i) => i.platform === impl.platform
              );
              if (idx >= 0) {
                existing.implementations[idx] = impl;
              } else {
                existing.implementations.push(impl);
              }
            }

            // Union used_by
            const usedBySet = new Set([
              ...existing.used_by,
              ...(params.used_by ?? []),
            ]);
            existing.used_by = [...usedBySet];

            merged = true;
          } else {
            // New element
            const element: SemanticElement = {
              id: params.id,
              name: params.name,
              purpose: params.purpose,
              category: params.category,
              data_contract: {
                inputs: params.inputs,
                outputs: params.outputs,
              },
              interactions: params.interactions,
              children: params.children,
              implementations: params.implementations ?? [],
              used_by: params.used_by ?? [],
              tags: params.tags ?? [],
              // Category 1 – optional enrichment
              ...(params.state !== undefined && { state: params.state }),
              ...(params.flows !== undefined && { flows: params.flows }),
              ...(params.error_states !== undefined && {
                error_states: params.error_states,
              }),
              ...(params.rendering_capabilities !== undefined && {
                rendering_capabilities: params.rendering_capabilities,
              }),
              // Category 2 – derivable metadata
              ...(params.is_async !== undefined && { is_async: params.is_async }),
              ...(params.default_action !== undefined && {
                default_action: params.default_action,
              }),
              ...(params.visibility_conditions !== undefined && {
                visibility_conditions: params.visibility_conditions,
              }),
            };
            registry.elements.push(element);
          }

          await saveRegistry(registry);

          return success({
            element_id: params.id,
            name: params.name,
            category: params.category,
            inputs_count: params.inputs.length,
            outputs_count: params.outputs.length,
            merged,
            message: merged
              ? `Updated existing semantic element "${params.id}". Implementations merged.`
              : `Registered new semantic element "${params.id}" (${params.category}).`,
          });
        }
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // =========================================================================
  // query_ui_elements
  // =========================================================================

  server.tool(
    "query_ui_elements",
    "Search the semantic UI registry by category, purpose, platform, or feature. Returns elements with their full data contracts. Use missing_platform to find elements that need porting to a target platform.",
    {
      category: categoryEnum
        .optional()
        .describe("Filter by element category"),
      purpose_search: z
        .string()
        .optional()
        .describe("Search purpose text"),
      platform: z
        .string()
        .optional()
        .describe("Return elements implemented for this platform"),
      feature_id: z
        .string()
        .optional()
        .describe("Return elements used by this feature"),
      missing_platform: z
        .string()
        .optional()
        .describe(
          "Return elements that do NOT have an implementation for this platform — instant migration checklist"
        ),
    },
    async (params) => {
      logger.debug("query_ui_elements called");

      const result = await safeExecute<QueryUIElementsOutput>(
        async (): Promise<ToolResponse<QueryUIElementsOutput>> => {
          const registry = await loadRegistry();
          let filtered = [...registry.elements];

          if (params.category) {
            filtered = filtered.filter((e) => e.category === params.category);
          }

          if (params.purpose_search) {
            const q = params.purpose_search.toLowerCase();
            filtered = filtered.filter((e) =>
              e.purpose.toLowerCase().includes(q)
            );
          }

          if (params.platform) {
            const p = params.platform.toLowerCase();
            filtered = filtered.filter((e) =>
              e.implementations.some((i) => i.platform.toLowerCase() === p)
            );
          }

          if (params.feature_id) {
            const fid = params.feature_id.toLowerCase();
            filtered = filtered.filter((e) =>
              e.used_by.some((u) => u.toLowerCase() === fid)
            );
          }

          if (params.missing_platform) {
            const mp = params.missing_platform.toLowerCase();
            filtered = filtered.filter(
              (e) =>
                !e.implementations.some(
                  (i) => i.platform.toLowerCase() === mp
                )
            );
          }

          // Aggregate stats
          const categories: Record<string, number> = {};
          const platforms: Record<string, number> = {};
          for (const el of filtered) {
            categories[el.category] = (categories[el.category] ?? 0) + 1;
            for (const impl of el.implementations) {
              platforms[impl.platform] =
                (platforms[impl.platform] ?? 0) + 1;
            }
          }

          return success({
            elements: filtered,
            total: filtered.length,
            categories,
            platforms,
          });
        }
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // =========================================================================
  // generate_ui_migration_plan
  // =========================================================================

  server.tool(
    "generate_ui_migration_plan",
    "Generate a platform migration plan. Lists all semantic elements from the source platform, checks which already exist on the target platform, and produces a gap analysis with data contract summaries and complexity estimates.",
    {
      source_platform: z
        .string()
        .describe('Source platform, e.g. "react"'),
      target_platform: z
        .string()
        .describe('Target platform, e.g. "swiftui"'),
      scope: z
        .array(z.string())
        .optional()
        .describe("Optional: limit to these feature IDs"),
    },
    async (params) => {
      logger.debug(
        `generate_ui_migration_plan: ${params.source_platform} → ${params.target_platform}`
      );

      const result = await safeExecute<GenerateUIMigrationOutput>(
        async (): Promise<ToolResponse<GenerateUIMigrationOutput>> => {
          const registry = await loadRegistry();
          const src = params.source_platform.toLowerCase();
          const tgt = params.target_platform.toLowerCase();

          // Filter to elements on source platform
          let sourceElements = registry.elements.filter((e) =>
            e.implementations.some((i) => i.platform.toLowerCase() === src)
          );

          // Optional scope by feature
          if (params.scope && params.scope.length > 0) {
            const scopeSet = new Set(
              params.scope.map((s) => s.toLowerCase())
            );
            sourceElements = sourceElements.filter((e) =>
              e.used_by.some((u) => scopeSet.has(u.toLowerCase()))
            );
          }

          const alreadyPorted: MigrationPortedElement[] = [];
          const migrationNeeded: MigrationGapElement[] = [];

          for (const el of sourceElements) {
            const srcImpl = el.implementations.find(
              (i) => i.platform.toLowerCase() === src
            );
            const tgtImpl = el.implementations.find(
              (i) => i.platform.toLowerCase() === tgt
            );

            if (tgtImpl) {
              alreadyPorted.push({
                element_id: el.id,
                name: el.name,
                source_component: srcImpl?.component ?? "unknown",
                target_component: tgtImpl.component,
              });
            } else {
              const inputSummary = el.data_contract.inputs
                .map((i) => `${i.name}: ${i.type}`)
                .join(", ");
              const outputSummary = el.data_contract.outputs
                .map((o) => `${o.name}: ${o.type} (${o.trigger})`)
                .join(", ");

              migrationNeeded.push({
                element_id: el.id,
                name: el.name,
                purpose: el.purpose,
                category: el.category,
                source_component: srcImpl?.component ?? "unknown",
                data_contract_summary: `Inputs: [${inputSummary}] → Outputs: [${outputSummary}]`,
                complexity_estimate: estimateComplexity(el),
              });
            }
          }

          const total = sourceElements.length;
          const ported = alreadyPorted.length;
          const gap = migrationNeeded.length;

          return success({
            source_platform: params.source_platform,
            target_platform: params.target_platform,
            already_ported: alreadyPorted,
            migration_needed: migrationNeeded,
            total_elements: total,
            ported_count: ported,
            gap_count: gap,
            coverage_percent:
              total > 0 ? Math.round((ported / total) * 100) : 100,
          });
        }
      );

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );
}
