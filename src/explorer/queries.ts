/**
 * DreamGraph Explorer — Phase 2 read-only queries.
 *
 * Surface (per plans/DREAMGRAPH_EXPLORER.md §4.2):
 *   GET /explorer/api/node/:id
 *   GET /explorer/api/neighborhood/:id?depth=N&limit=M
 *   GET /explorer/api/search?q=...&types=...&limit=
 *   GET /explorer/api/edges?kind=...&min_conf=&limit=
 *   GET /explorer/api/tensions[?status=active|resolved]
 *   GET /explorer/api/stats
 *
 * All endpoints derive from the same in-memory `GraphIndex` cached by the
 * snapshot etag. The index is rebuilt lazily when a fresh snapshot supersedes
 * the cached one — no SSE invalidation yet (Phase 3).
 *
 * No file I/O happens here directly; everything reads the snapshot the
 * `GraphSnapshotService` already produces, plus the raw stores via
 * `loadGraphRaw` for full entity records / tension details.
 */

import { getGraphSnapshot } from "../graph/snapshot.js";
import type {
  ExplorerEdge,
  ExplorerEdgeKind,
  ExplorerNode,
  ExplorerNodeType,
  GraphSnapshot,
} from "../graph/snapshot.js";
import { graphEventBus } from "../graph/events.js";
import { loadGraphRaw, type GraphRawSnapshot } from "../graph/store.js";
import type {
  CapabilityEntity,
  DataModelEntity,
  Feature,
  Workflow,
} from "../types/index.js";
import type {
  DreamNode,
  ResolvedTension,
  TensionSignal,
} from "../cognitive/types.js";

/* ------------------------------------------------------------------ */
/*  GraphIndex — O(1) per-node neighbor lookup                        */
/* ------------------------------------------------------------------ */

interface IndexedNode extends ExplorerNode {
  /** Lower-case label/id for substring search. */
  searchKey: string;
}

export class GraphIndex {
  readonly etag: string;
  readonly snapshot: GraphSnapshot;
  readonly nodesById: Map<string, IndexedNode>;
  /** Outgoing + incoming neighbors, keyed by node id → set of neighbor ids. */
  readonly neighbors: Map<string, Set<string>>;
  /** Edges grouped by source so neighborhood queries can recover edge data. */
  readonly edgesByEndpoint: Map<string, ExplorerEdge[]>;

  constructor(snapshot: GraphSnapshot) {
    this.snapshot = snapshot;
    this.etag = snapshot.etag;
    this.nodesById = new Map();
    this.neighbors = new Map();
    this.edgesByEndpoint = new Map();

    for (const n of snapshot.nodes) {
      this.nodesById.set(n.id, {
        ...n,
        searchKey: `${n.label} ${n.id}`.toLowerCase(),
      });
      this.neighbors.set(n.id, new Set());
      this.edgesByEndpoint.set(n.id, []);
    }
    for (const e of snapshot.edges) {
      // Endpoints are guaranteed to exist by the snapshot builder.
      this.neighbors.get(e.s)?.add(e.t);
      this.neighbors.get(e.t)?.add(e.s);
      this.edgesByEndpoint.get(e.s)?.push(e);
      this.edgesByEndpoint.get(e.t)?.push(e);
    }
  }

  /** Breadth-first walk up to `depth` hops. Returns reached node ids. */
  bfs(rootId: string, depth: number, limit: number): Set<string> {
    const out = new Set<string>();
    if (!this.nodesById.has(rootId)) return out;
    out.add(rootId);
    let frontier = [rootId];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        const ns = this.neighbors.get(id);
        if (!ns) continue;
        for (const m of ns) {
          if (!out.has(m)) {
            out.add(m);
            next.push(m);
            if (out.size >= limit) return out;
          }
        }
      }
      frontier = next;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/*  Cached singleton — rebuilt when snapshot etag changes             */
/* ------------------------------------------------------------------ */

let cached: GraphIndex | null = null;

// Drop the cached index whenever an upstream producer signals the underlying
// data may have shifted. The next getIndex() call will rebuild from the fresh
// snapshot. Subscribed once at module load — the bus is process-wide so
// re-subscribing on every call would leak handlers.
graphEventBus.subscribe((event) => {
  if (event.kind === "snapshot.changed" || event.kind === "cache.invalidated") {
    cached = null;
  }
});

async function getIndex(): Promise<GraphIndex> {
  const snap = await getGraphSnapshot();
  if (!cached || cached.etag !== snap.etag) {
    cached = new GraphIndex(snap);
  }
  return cached;
}

/** Test seam — reset the cache so fixtures take effect. */
export function _resetGraphIndexCache(): void {
  cached = null;
}

/* ------------------------------------------------------------------ */
/*  Entity record resolver                                            */
/* ------------------------------------------------------------------ */

export interface NodeRecord {
  id: string;
  type: ExplorerNodeType;
  label: string;
  degree: number;
  health: number;
  confidence: number;
  /** Original entity (Feature / Workflow / DreamNode / TensionSignal / …). */
  entity: unknown;
  /** Edges where this node is the source (to-target shape). */
  outgoing: ExplorerEdge[];
  /** Edges where this node is the target (from-source shape). */
  incoming: ExplorerEdge[];
}

function findEntity(raw: GraphRawSnapshot, id: string, type: ExplorerNodeType): unknown {
  switch (type) {
    case "feature":
      return (raw.features as Feature[]).find((f) => f.id === id) ?? null;
    case "workflow":
      return (raw.workflows as Workflow[]).find((w) => w.id === id) ?? null;
    case "data_model":
      return (raw.dataModel as DataModelEntity[]).find((d) => d.id === id) ?? null;
    case "capability":
      return (raw.capabilities as CapabilityEntity[]).find((c) => c.id === id) ?? null;
    case "dream_node":
      return (raw.dreamGraph.nodes ?? []).find((n: DreamNode) => n.id === id) ?? null;
    case "tension":
      return (raw.tensions.signals ?? []).find((s: TensionSignal) => s.id === id) ?? null;
  }
}

export async function getNodeRecord(id: string): Promise<NodeRecord | null> {
  const idx = await getIndex();
  const node = idx.nodesById.get(id);
  if (!node) return null;
  const raw = await loadGraphRaw();
  const entity = findEntity(raw, id, node.type);

  const outgoing: ExplorerEdge[] = [];
  const incoming: ExplorerEdge[] = [];
  for (const e of idx.edgesByEndpoint.get(id) ?? []) {
    if (e.s === id) outgoing.push(e);
    if (e.t === id) incoming.push(e);
  }

  return {
    id: node.id,
    type: node.type,
    label: node.label,
    degree: node.degree,
    health: node.health,
    confidence: node.confidence,
    entity,
    outgoing,
    incoming,
  };
}

/* ------------------------------------------------------------------ */
/*  Neighborhood                                                       */
/* ------------------------------------------------------------------ */

export interface NeighborhoodResult {
  root: string;
  depth: number;
  truncated: boolean;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}

export async function getNeighborhood(
  rootId: string,
  depth: number,
  limit: number,
): Promise<NeighborhoodResult | null> {
  const idx = await getIndex();
  if (!idx.nodesById.has(rootId)) return null;
  const reached = idx.bfs(rootId, Math.max(1, Math.min(depth, 4)), limit);

  const nodes: ExplorerNode[] = [];
  for (const id of reached) {
    const n = idx.nodesById.get(id);
    if (n) nodes.push(stripIndexedNode(n));
  }
  const edges: ExplorerEdge[] = [];
  // Include only edges whose BOTH endpoints are inside the reached set —
  // this keeps the rendered subgraph closed.
  const seenEdgeKey = new Set<string>();
  for (const id of reached) {
    for (const e of idx.edgesByEndpoint.get(id) ?? []) {
      if (!reached.has(e.s) || !reached.has(e.t)) continue;
      const k = `${e.s}->${e.t}::${e.kind}`;
      if (seenEdgeKey.has(k)) continue;
      seenEdgeKey.add(k);
      edges.push(e);
    }
  }

  return {
    root: rootId,
    depth,
    truncated: reached.size >= limit,
    nodes,
    edges,
  };
}

/* ------------------------------------------------------------------ */
/*  Search                                                             */
/* ------------------------------------------------------------------ */

export interface SearchHit {
  id: string;
  type: ExplorerNodeType;
  label: string;
  /** Higher = better match. */
  score: number;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
}

export async function search(
  q: string,
  typeFilter: Set<ExplorerNodeType> | null,
  limit: number,
): Promise<SearchResult> {
  const idx = await getIndex();
  const needle = q.trim().toLowerCase();
  if (needle.length === 0) return { query: q, hits: [] };

  const hits: SearchHit[] = [];
  for (const n of idx.nodesById.values()) {
    if (typeFilter && !typeFilter.has(n.type)) continue;
    const labelLow = n.label.toLowerCase();
    const idLow = n.id.toLowerCase();
    let score = 0;
    if (labelLow === needle) score = 1.0;
    else if (idLow === needle) score = 0.95;
    else if (labelLow.startsWith(needle)) score = 0.85;
    else if (idLow.startsWith(needle)) score = 0.75;
    else if (labelLow.includes(needle)) score = 0.55;
    else if (idLow.includes(needle)) score = 0.45;
    else continue;

    // Tiny degree boost so well-connected matches float up.
    score += Math.min(0.05, n.degree * 0.001);
    hits.push({ id: n.id, type: n.type, label: n.label, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return { query: q, hits: hits.slice(0, Math.max(1, limit)) };
}

/* ------------------------------------------------------------------ */
/*  Edges (filtered list)                                              */
/* ------------------------------------------------------------------ */

export interface EdgeListResult {
  total: number;
  truncated: boolean;
  edges: ExplorerEdge[];
}

export async function listEdges(
  kindFilter: Set<ExplorerEdgeKind> | null,
  minConf: number,
  limit: number,
): Promise<EdgeListResult> {
  const idx = await getIndex();
  const out: ExplorerEdge[] = [];
  let total = 0;
  for (const e of idx.snapshot.edges) {
    if (kindFilter && !kindFilter.has(e.kind)) continue;
    if (e.conf < minConf) continue;
    total++;
    if (out.length < limit) out.push(e);
  }
  return { total, truncated: total > out.length, edges: out };
}

/* ------------------------------------------------------------------ */
/*  Tensions                                                           */
/* ------------------------------------------------------------------ */

export interface TensionView {
  active: TensionSignal[];
  resolved: ResolvedTension[];
  total_active: number;
  total_resolved: number;
}

export async function getTensionView(
  status: "active" | "resolved" | "all",
): Promise<TensionView> {
  const raw = await loadGraphRaw();
  const active = status === "resolved" ? [] : (raw.tensions.signals ?? []);
  const resolved = status === "active" ? [] : (raw.tensions.resolved_tensions ?? []);
  return {
    active,
    resolved,
    total_active: (raw.tensions.signals ?? []).length,
    total_resolved: (raw.tensions.resolved_tensions ?? []).length,
  };
}

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

export interface StatsResult {
  generated_at: string;
  etag: string;
  totals: {
    nodes: number;
    edges: number;
    tensions_active: number;
    tensions_resolved: number;
  };
  nodes_by_type: Record<ExplorerNodeType, number>;
  edges_by_kind: Record<ExplorerEdgeKind, number>;
  /** Mean health / confidence across all nodes. */
  health_mean: number;
  confidence_mean: number;
}

const NODE_TYPES: ExplorerNodeType[] = [
  "feature", "workflow", "data_model", "capability", "dream_node", "tension",
];
const EDGE_KINDS: ExplorerEdgeKind[] = [
  "fact", "validated", "candidate", "dream", "tension",
];

export async function getStats(): Promise<StatsResult> {
  const idx = await getIndex();
  const raw = await loadGraphRaw();

  const nodesByType = Object.fromEntries(
    NODE_TYPES.map((t) => [t, 0]),
  ) as Record<ExplorerNodeType, number>;
  const edgesByKind = Object.fromEntries(
    EDGE_KINDS.map((k) => [k, 0]),
  ) as Record<ExplorerEdgeKind, number>;

  let healthSum = 0;
  let confSum = 0;
  for (const n of idx.snapshot.nodes) {
    nodesByType[n.type]++;
    healthSum += n.health;
    confSum += n.confidence;
  }
  for (const e of idx.snapshot.edges) {
    edgesByKind[e.kind]++;
  }
  const denom = Math.max(1, idx.snapshot.nodes.length);

  return {
    generated_at: idx.snapshot.generated_at,
    etag: idx.snapshot.etag,
    totals: {
      nodes: idx.snapshot.nodes.length,
      edges: idx.snapshot.edges.length,
      tensions_active: (raw.tensions.signals ?? []).length,
      tensions_resolved: (raw.tensions.resolved_tensions ?? []).length,
    },
    nodes_by_type: nodesByType,
    edges_by_kind: edgesByKind,
    health_mean: healthSum / denom,
    confidence_mean: confSum / denom,
  };
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

function stripIndexedNode(n: IndexedNode): ExplorerNode {
  const { searchKey: _searchKey, ...rest } = n;
  return rest;
}

/** Type-safe split helper: "feature,workflow" → Set with valid kinds only. */
export function parseNodeTypeSet(csv: string | undefined): Set<ExplorerNodeType> | null {
  if (!csv) return null;
  const valid = new Set<ExplorerNodeType>();
  for (const raw of csv.split(",")) {
    const t = raw.trim();
    if ((NODE_TYPES as string[]).includes(t)) valid.add(t as ExplorerNodeType);
  }
  return valid.size > 0 ? valid : null;
}

export function parseEdgeKindSet(csv: string | undefined): Set<ExplorerEdgeKind> | null {
  if (!csv) return null;
  const valid = new Set<ExplorerEdgeKind>();
  for (const raw of csv.split(",")) {
    const t = raw.trim();
    if ((EDGE_KINDS as string[]).includes(t)) valid.add(t as ExplorerEdgeKind);
  }
  return valid.size > 0 ? valid : null;
}
