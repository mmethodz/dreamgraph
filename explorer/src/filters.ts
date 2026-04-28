import type { ExplorerEdgeKind, ExplorerNodeType } from "./types";

/**
 * Visibility/filter state shared between App, Filters panel, Legend, and
 * GraphCanvas. Defaults make every kind visible.
 */
export interface FilterState {
  /** Visible node types. */
  nodeTypes: Set<ExplorerNodeType>;
  /** Visible edge kinds. */
  edgeKinds: Set<ExplorerEdgeKind>;
  /** Minimum confidence for edges & dream nodes (0..1). */
  minConfidence: number;
}

/** Layout / camera mode. */
export type ExplorerMode = "atlas" | "focus";

export const ALL_NODE_TYPES: ExplorerNodeType[] = [
  "feature",
  "workflow",
  "data_model",
  "capability",
  "dream_node",
  "tension",
];

export const ALL_EDGE_KINDS: ExplorerEdgeKind[] = [
  "fact",
  "validated",
  "candidate",
  "dream",
  "tension",
];

export function defaultFilters(): FilterState {
  return {
    nodeTypes: new Set(ALL_NODE_TYPES),
    edgeKinds: new Set(ALL_EDGE_KINDS),
    minConfidence: 0,
  };
}

export function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
