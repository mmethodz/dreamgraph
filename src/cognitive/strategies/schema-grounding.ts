/**
 * Strategy — Schema Grounding (per plans/DATASTORE_AS_HUB.md, Slice 3).
 *
 * Uses the live `tables[]` populated by `scan_database` to:
 *   1. Propose `stored_in` dream edges from data_model entities to the
 *      datastore whose tables match (exact = 0.85, fuzzy = 0.55).
 *   2. Propose `shares_state_with` edges between top-level entities
 *      (feature/workflow) in *different repos* whose data_model
 *      neighbors resolve to the same datastore.
 *   3. Raise `missing_link` tensions for:
 *        - phantom_entity: data_model with no resolvable table.
 *        - shadow_table:   table with no data_model representation.
 *
 * Inert when no datastores exist or no scan has populated `tables[]`.
 */

import { engine } from "../engine.js";
import { logger } from "../../utils/logger.js";
import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactSnapshot, type FactEntity } from "./_shared.js";

const EXACT_CONF = 0.85;
const FUZZY_CONF = 0.55;
const SHARES_STATE_BASE = 0.45;

/** Normalize "TableName" / "table_name" / "tableName" → "tablename". */
function normTable(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip common id-prefix patterns. e.g. "data_model:db.public.users" → "users". */
function dataModelLeaf(id: string): string {
  const tail = id.split(/[:.]/).pop() ?? id;
  return normTable(tail);
}

interface TableIndex {
  /** Normalized table name → datastore id. */
  byName: Map<string, string>;
  /** Datastore id → set of normalized table names. */
  byStore: Map<string, Set<string>>;
}

function buildTableIndex(snapshot: FactSnapshot): TableIndex {
  const byName = new Map<string, string>();
  const byStore = new Map<string, Set<string>>();
  for (const e of snapshot.entities.values()) {
    if (e.type !== "datastore" || !e.tables) continue;
    const set = new Set<string>();
    for (const t of e.tables) {
      const n = normTable(t.name);
      if (!n) continue;
      set.add(n);
      // First-writer-wins (avoid silently swapping anchor of duplicates).
      if (!byName.has(n)) byName.set(n, e.id);
    }
    byStore.set(e.id, set);
  }
  return { byName, byStore };
}

/**
 * Resolve which datastore a data_model belongs to by table-name match.
 * Returns the matching datastore id + match strength, or null when no match.
 */
function resolveByTable(
  dm: FactEntity,
  index: TableIndex,
): { storeId: string; conf: number; how: "exact" | "fuzzy" } | null {
  // Try the canonical leaf id first, then the entity name.
  const candidates = [dataModelLeaf(dm.id), normTable(dm.name)].filter(
    (s) => s.length > 0,
  );
  for (const c of candidates) {
    const exact = index.byName.get(c);
    if (exact) return { storeId: exact, conf: EXACT_CONF, how: "exact" };
  }
  // Fuzzy: contains-match against any known table name.
  for (const c of candidates) {
    for (const [tableName, storeId] of index.byName.entries()) {
      if (tableName.includes(c) || c.includes(tableName)) {
        return { storeId, conf: FUZZY_CONF, how: "fuzzy" };
      }
    }
  }
  return null;
}

export interface SchemaGroundingResult {
  edges: DreamEdge[];
  tensions_raised: number;
}

export async function schemaGrounding(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): Promise<SchemaGroundingResult> {
  const edges: DreamEdge[] = [];
  let tensions_raised = 0;
  const now = new Date().toISOString();

  // Inert when nothing scanned yet.
  const datastores = [...snapshot.entities.values()].filter(
    (e) => e.type === "datastore",
  );
  if (datastores.length === 0) {
    return { edges, tensions_raised };
  }
  const index = buildTableIndex(snapshot);
  const totalTables = [...index.byStore.values()].reduce(
    (a, b) => a + b.size,
    0,
  );
  if (totalTables === 0) {
    return { edges, tensions_raised };
  }

  // --------------------------------------------------------------------
  // (1) Propose `stored_in` edges from data_model → datastore (by table match).
  // (2) Track which data_models resolved to which datastore for step 3.
  // (3) Track which table names are claimed (for shadow_table tensions).
  // --------------------------------------------------------------------
  const dmStoreOf = new Map<string, string>(); // dataModelId → storeId
  const claimedTables = new Map<string, Set<string>>(); // storeId → claimed table names
  for (const id of index.byStore.keys()) claimedTables.set(id, new Set());

  const dataModels = [...snapshot.entities.values()].filter(
    (e) => e.type === "data_model",
  );
  const phantomEntities: FactEntity[] = [];

  for (const dm of dataModels) {
    const match = resolveByTable(dm, index);
    if (!match) {
      // Only flag as phantom if the data_model isn't already linked to *some* datastore.
      const linkedToAnyStore = dm.links.some(
        (l) => snapshot.entities.get(l.target)?.type === "datastore",
      );
      if (!linkedToAnyStore) phantomEntities.push(dm);
      continue;
    }
    dmStoreOf.set(dm.id, match.storeId);
    const claimed = claimedTables.get(match.storeId);
    if (claimed) {
      // Mark whichever table candidate matched.
      const leaf = dataModelLeaf(dm.id);
      const nameNorm = normTable(dm.name);
      if (index.byName.get(leaf) === match.storeId) claimed.add(leaf);
      if (index.byName.get(nameNorm) === match.storeId) claimed.add(nameNorm);
    }
    if (edges.length >= max) continue;
    if (snapshot.edgeSet.has(`${dm.id}|${match.storeId}`)) continue;
    edges.push({
      id: dreamId("schema"),
      from: dm.id,
      to: match.storeId,
      type: "datastore",
      relation: "stored_in",
      reason: `Schema grounding: data_model "${dm.name}" matches table in ${match.storeId} (${match.how}).`,
      confidence: match.conf,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      strategy: "schema_grounding",
      meta: { match: match.how, datastore: match.storeId },
      ttl: DEFAULT_DECAY.ttl,
      decay_rate: DEFAULT_DECAY.decay_rate,
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      plausibility: 0,
      evidence_score: 0,
      contradiction_score: 0,
    });
    snapshot.edgeSet.add(`${dm.id}|${match.storeId}`);
  }

  // --------------------------------------------------------------------
  // (4) `shares_state_with` between top-level entities in different repos
  //     that touch the same datastore through their data_model neighbors.
  // --------------------------------------------------------------------
  // Build: storeId → Map<repo, Set<entityId>> for features/workflows.
  const storeRepoOwners = new Map<string, Map<string, Set<string>>>();
  for (const e of snapshot.entities.values()) {
    if (e.type !== "feature" && e.type !== "workflow") continue;
    if (!e.source_repo) continue;
    for (const link of e.links) {
      const neighbor = snapshot.entities.get(link.target);
      if (!neighbor || neighbor.type !== "data_model") continue;
      const storeId =
        dmStoreOf.get(neighbor.id) ??
        // Fall back to existing fact-graph stored_in link target.
        neighbor.links.find(
          (l) =>
            snapshot.entities.get(l.target)?.type === "datastore",
        )?.target;
      if (!storeId) continue;
      let byRepo = storeRepoOwners.get(storeId);
      if (!byRepo) {
        byRepo = new Map();
        storeRepoOwners.set(storeId, byRepo);
      }
      let owners = byRepo.get(e.source_repo);
      if (!owners) {
        owners = new Set();
        byRepo.set(e.source_repo, owners);
      }
      owners.add(e.id);
    }
  }

  for (const [storeId, byRepo] of storeRepoOwners.entries()) {
    if (byRepo.size < 2) continue; // need at least two repos
    const repos = [...byRepo.keys()];
    for (let i = 0; i < repos.length && edges.length < max; i++) {
      for (let j = i + 1; j < repos.length && edges.length < max; j++) {
        const aSet = byRepo.get(repos[i])!;
        const bSet = byRepo.get(repos[j])!;
        for (const aId of aSet) {
          if (edges.length >= max) break;
          for (const bId of bSet) {
            if (edges.length >= max) break;
            const a = snapshot.entities.get(aId);
            const b = snapshot.entities.get(bId);
            if (!a || !b) continue;
            // Only same-type pairings to keep the relation meaningful.
            if (a.type !== b.type) continue;
            if (
              snapshot.edgeSet.has(`${aId}|${bId}`) ||
              snapshot.edgeSet.has(`${bId}|${aId}`)
            ) {
              continue;
            }
            const conf = Math.min(SHARES_STATE_BASE + 0.1 * (byRepo.size - 1), 0.75);
            edges.push({
              id: dreamId("schema"),
              from: aId,
              to: bId,
              type: a.type as DreamEdge["type"],
              relation: "shares_state_with",
              reason: `Schema grounding: "${a.name}" (${repos[i]}) and "${b.name}" (${repos[j]}) both touch ${storeId}.`,
              confidence: Math.round(conf * 100) / 100,
              origin: "rem",
              created_at: now,
              dream_cycle: cycle,
              strategy: "schema_grounding",
              meta: { datastore: storeId, repos: [repos[i], repos[j]] },
              ttl: DEFAULT_DECAY.ttl,
              decay_rate: DEFAULT_DECAY.decay_rate,
              reinforcement_count: 0,
              last_reinforced_cycle: cycle,
              status: "candidate",
              activation_score: 0,
              plausibility: 0,
              evidence_score: 0,
              contradiction_score: 0,
            });
            snapshot.edgeSet.add(`${aId}|${bId}`);
          }
        }
      }
    }
  }

  // --------------------------------------------------------------------
  // (5) Raise tensions for shadow tables / phantom data_models.
  //     Reuses the existing `missing_link` type to avoid widening the
  //     TensionSignal union (see plans/DATASTORE_AS_HUB.md decision notes).
  // --------------------------------------------------------------------
  // shadow_table: table that no data_model claimed.
  for (const [storeId, names] of index.byStore.entries()) {
    const claimed = claimedTables.get(storeId) ?? new Set();
    for (const name of names) {
      if (claimed.has(name)) continue;
      try {
        await engine.recordTension({
          type: "missing_link",
          domain: "data_model",
          entities: [storeId],
          description: `shadow_table: ${storeId} has table "${name}" with no data_model entity.`,
          urgency: 0.4,
        });
        tensions_raised++;
      } catch (err) {
        logger.debug(
          `schema_grounding: failed to raise shadow_table tension: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  // phantom_entity: data_model with no resolvable table.
  for (const dm of phantomEntities) {
    try {
      await engine.recordTension({
        type: "missing_link",
        domain: "data_model",
        entities: [dm.id],
        description: `phantom_entity: data_model "${dm.name}" has no matching table in any scanned datastore.`,
        urgency: 0.5,
      });
      tensions_raised++;
    } catch (err) {
      logger.debug(
        `schema_grounding: failed to raise phantom_entity tension: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { edges, tensions_raised };
}
