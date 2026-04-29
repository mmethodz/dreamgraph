/**
 * Wire types mirroring the daemon's Phase 0 snapshot envelope.
 * Keep in sync with src/graph/snapshot.ts on the server side.
 */

export const EXPECTED_SNAPSHOT_VERSION = 1;

export type ExplorerNodeType =
  | "feature"
  | "workflow"
  | "data_model"
  | "capability"
  | "datastore"
  | "dream_node"
  | "tension";

export type ExplorerEdgeKind =
  | "fact"
  | "validated"
  | "candidate"
  | "dream"
  | "tension";

export interface ExplorerNode {
  id: string;
  type: ExplorerNodeType;
  label: string;
  degree: number;
  health: number;
  confidence: number;
}

export interface ExplorerEdge {
  s: string;
  t: string;
  kind: ExplorerEdgeKind;
  conf: number;
}

export interface SnapshotStats {
  node_count: number;
  edge_count: number;
  build_ms: number;
  bytes_uncompressed: number;
}

export interface GraphSnapshot {
  version: number;
  etag: string;
  generated_at: string;
  instance_uuid: string;
  stats: SnapshotStats;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}

/* ------------------------------------------------------------------ */
/*  Phase 2 query response shapes                                     */
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
  outgoing: ExplorerEdge[];
  incoming: ExplorerEdge[];
}

export interface NeighborhoodResult {
  root: string;
  depth: number;
  truncated: boolean;
  nodes: ExplorerNode[];
  edges: ExplorerEdge[];
}

export interface SearchHit {
  id: string;
  type: ExplorerNodeType;
  label: string;
  score: number;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
}

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
  health_mean: number;
  confidence_mean: number;
}

export interface TensionEntity {
  id: string;
  type: string;
  domain: string;
  entities: string[];
  description: string;
  occurrences: number;
  urgency: number;
  first_seen: string;
  last_seen: string;
  attempted: boolean;
  resolved: boolean;
  ttl: number;
}

export interface TensionView {
  active: TensionEntity[];
  resolved: { tension_id: string; resolved_at: string; original: TensionEntity }[];
  total_active: number;
  total_resolved: number;
}

