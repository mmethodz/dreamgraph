/**
 * DreamGraph — Shared types and helpers for dream strategies.
 *
 * Extracted from dreamer.ts to support 1-strategy-per-file structure.
 * Each strategy file imports `FactSnapshot`, `FactEntity`, `dreamId`,
 * and other helpers from here.
 *
 * `idCounter` lives at module scope here so all strategies share the
 * same monotonically-increasing dream-id namespace, exactly as before.
 */

import { loadJsonArray } from "../../utils/cache.js";
import type { Feature, Workflow, DataModelEntity } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Fact Graph Snapshot — in-memory read-only copy for dream analysis
// ---------------------------------------------------------------------------

export interface FactEntity {
  id: string;
  type: "feature" | "workflow" | "data_model";
  name: string;
  description: string;
  domain: string;
  keywords: string[];
  source_repo: string;
  source_files: string[];
  tags: string[];
  category: string;
  links: Array<{
    target: string;
    type: string;
    relationship: string;
    description: string;
    strength: string;
    meta?: {
      direction?: string;
      api_route?: string;
      table?: string;
      see_also?: Array<{ target: string; type: string; hint: string }>;
    };
  }>;
  /** Workflow steps (ordered names) — only for workflow entities */
  steps: string[];
  /** Data model key field names — only for data_model entities */
  key_fields: string[];
  /** Data model relationship targets — only for data_model entities */
  relationships: Array<{ type: string; target: string; via: string }>;
  /** Words extracted from description for semantic matching */
  descriptionTokens: Set<string>;
}

export interface FactSnapshot {
  entities: Map<string, FactEntity>;
  /** Set of "from|to" strings for fast edge existence checks */
  edgeSet: Set<string>;
  /** All domain values */
  domains: Set<string>;
  /** Shared source files → entity IDs that reference them */
  sourceFileIndex: Map<string, string[]>;
}

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

export const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "shall", "should", "may", "might", "can", "could", "this", "that",
  "these", "those", "it", "its", "not", "no", "all", "each", "every",
  "as", "if", "when", "than", "also", "into", "such", "which", "their",
]);

/** Extract meaningful tokens from text for semantic matching. */
export function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

// ---------------------------------------------------------------------------
// Dream ID generation — shared monotonic counter across all strategies
// ---------------------------------------------------------------------------

let idCounter = 0;

export function dreamId(prefix: string): string {
  idCounter++;
  return `dream_${prefix}_${Date.now()}_${idCounter}`;
}

// ---------------------------------------------------------------------------
// Reverse relation map (used by symmetry-completion)
// ---------------------------------------------------------------------------

export function inferReverseRelation(relation: string): string {
  const reverseMap: Record<string, string> = {
    implements: "implemented_by",
    implemented_by: "implements",
    reads: "read_by",
    read_by: "reads",
    writes: "written_by",
    written_by: "writes",
    depends_on: "depended_on_by",
    depended_on_by: "depends_on",
    triggers: "triggered_by",
    triggered_by: "triggers",
    produces: "produced_by",
    produced_by: "produces",
    consumes: "consumed_by",
    consumed_by: "consumes",
    syncs: "synced_by",
    synced_by: "syncs",
    extends: "extended_by",
    extended_by: "extends",
    stores: "stored_in",
    stored_in: "stores",
    validates: "validated_by",
    validated_by: "validates",
    exports: "exported_by",
    exported_by: "exports",
    manages: "managed_by",
    managed_by: "manages",
  };

  return reverseMap[relation] ?? `reverse_of_${relation}`;
}

// ---------------------------------------------------------------------------
// Fact snapshot builder — assembles the read-only graph copy
// ---------------------------------------------------------------------------

export async function buildFactSnapshot(): Promise<FactSnapshot> {
  const [features, workflows, dataModel] = await Promise.all([
    loadJsonArray<Feature>("features.json"),
    loadJsonArray<Workflow>("workflows.json"),
    loadJsonArray<DataModelEntity>("data_model.json"),
  ]);

  const entities = new Map<string, FactEntity>();
  const edgeSet = new Set<string>();
  const domains = new Set<string>();
  const sourceFileIndex = new Map<string, string[]>();

  const indexSourceFiles = (entityId: string, files: string[]) => {
    for (const f of files) {
      const list = sourceFileIndex.get(f) ?? [];
      list.push(entityId);
      sourceFileIndex.set(f, list);
    }
  };

  const mapLinks = (links: Feature["links"]) =>
    (links ?? []).map((l) => ({
      target: l.target,
      type: l.type,
      relationship: l.relationship,
      description: l.description ?? "",
      strength: l.strength,
      meta: l.meta
        ? {
            direction: l.meta.direction,
            api_route: l.meta.api_route,
            table: l.meta.table,
            see_also: l.meta.see_also?.map((sa) => ({
              target: sa.target,
              type: sa.type,
              hint: sa.hint,
            })),
          }
        : undefined,
    }));

  for (const f of features) {
    const desc = f.description ?? "";
    entities.set(f.id, {
      id: f.id,
      type: "feature",
      name: f.name,
      description: desc,
      domain: f.domain ?? "",
      keywords: f.keywords ?? [],
      source_repo: f.source_repo,
      source_files: f.source_files ?? [],
      tags: f.tags ?? [],
      category: f.category ?? "",
      links: mapLinks(f.links),
      steps: [],
      key_fields: [],
      relationships: [],
      descriptionTokens: tokenize(desc),
    });
    if (f.domain) domains.add(f.domain);
    indexSourceFiles(f.id, f.source_files ?? []);
    for (const link of f.links ?? []) {
      edgeSet.add(`${f.id}|${link.target}`);
    }
  }

  for (const w of workflows) {
    const desc = w.description ?? "";
    entities.set(w.id, {
      id: w.id,
      type: "workflow",
      name: w.name,
      description: desc,
      domain: w.domain ?? "",
      keywords: w.keywords ?? [],
      source_repo: w.source_repo,
      source_files: w.source_files ?? [],
      tags: [],
      category: "",
      links: mapLinks(w.links),
      steps: (w.steps ?? []).map((s) => (typeof s === "string" ? s : s.name)),
      key_fields: [],
      relationships: [],
      descriptionTokens: tokenize(desc),
    });
    if (w.domain) domains.add(w.domain);
    indexSourceFiles(w.id, w.source_files ?? []);
    for (const link of w.links ?? []) {
      edgeSet.add(`${w.id}|${link.target}`);
    }
  }

  for (const e of dataModel) {
    const desc = e.description ?? "";
    entities.set(e.id, {
      id: e.id,
      type: "data_model",
      name: e.name,
      description: desc,
      domain: e.domain ?? "",
      keywords: e.keywords ?? [],
      source_repo: e.source_repo,
      source_files: e.source_files ?? [],
      tags: [],
      category: "",
      links: mapLinks(e.links),
      steps: [],
      key_fields: (e.key_fields ?? []).map((kf) =>
        typeof kf === "string" ? kf : kf.name,
      ),
      relationships: (e.relationships ?? []).map((r) => ({
        type: r.type,
        target: r.target,
        via: r.via,
      })),
      descriptionTokens: tokenize(desc),
    });
    if (e.domain) domains.add(e.domain);
    indexSourceFiles(e.id, e.source_files ?? []);
    for (const link of e.links ?? []) {
      edgeSet.add(`${e.id}|${link.target}`);
    }
  }

  return { entities, edgeSet, domains, sourceFileIndex };
}
