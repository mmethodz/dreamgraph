import {
  ALL_EDGE_KINDS,
  ALL_NODE_TYPES,
  toggle,
  type FilterState,
} from "./filters";
import type { ExplorerEdgeKind, ExplorerNodeType } from "./types";

interface Props {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  /** Optional swatch colors keyed by node type (for visual cues). */
  nodeColors: Record<ExplorerNodeType, string>;
  edgeColors: Record<ExplorerEdgeKind, string>;
}

/**
 * Filters panel: toggle node types, edge kinds, and a confidence floor.
 * Doubles as the legend (each row is a swatch + checkbox).
 */
export function FiltersPanel({ filters, onChange, nodeColors, edgeColors }: Props) {
  return (
    <div className="filters">
      <h3 className="filters-title">Node types</h3>
      <ul className="filters-list">
        {ALL_NODE_TYPES.map((t) => (
          <li key={t} className="filters-row">
            <label>
              <input
                type="checkbox"
                checked={filters.nodeTypes.has(t)}
                onChange={() =>
                  onChange({ ...filters, nodeTypes: toggle(filters.nodeTypes, t) })
                }
              />
              <span
                className="filters-swatch"
                style={{ background: nodeColors[t] }}
              />
              <span className="filters-name">{t}</span>
            </label>
          </li>
        ))}
      </ul>

      <h3 className="filters-title">Edge kinds</h3>
      <ul className="filters-list">
        {ALL_EDGE_KINDS.map((k) => (
          <li key={k} className="filters-row">
            <label>
              <input
                type="checkbox"
                checked={filters.edgeKinds.has(k)}
                onChange={() =>
                  onChange({ ...filters, edgeKinds: toggle(filters.edgeKinds, k) })
                }
              />
              <span
                className="filters-swatch filters-swatch--bar"
                style={{ background: edgeColors[k] }}
              />
              <span className="filters-name">{k}</span>
            </label>
          </li>
        ))}
      </ul>

      <h3 className="filters-title">Min confidence</h3>
      <div className="filters-row filters-row--slider">
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={filters.minConfidence}
          onChange={(e) =>
            onChange({ ...filters, minConfidence: Number(e.target.value) })
          }
        />
        <span className="filters-conf">{filters.minConfidence.toFixed(2)}</span>
      </div>
    </div>
  );
}
