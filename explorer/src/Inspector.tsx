import { useEffect, useState } from "react";
import { fetchNode } from "./api";
import type { ExplorerEdge, ExplorerNode, NodeRecord, StatsResult } from "./types";

interface Props {
  selected: ExplorerNode | null;
  stats: StatsResult | null;
  onNavigate: (id: string) => void;
}

/**
 * Right-hand inspector. Shows snapshot stats when nothing is selected.
 * On selection, fetches the full NodeRecord (entity + outgoing/incoming
 * edges) and renders the type-specific entity payload + adjacency lists.
 */
export function Inspector({ selected, stats, onNavigate }: Props) {
  const [record, setRecord] = useState<NodeRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      setRecord(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchNode(selected.id)
      .then((r) => {
        if (cancelled) return;
        setRecord(r);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (!selected) {
    return (
      <div className="inspector">
        <h2 className="inspector-title">Snapshot</h2>
        {stats ? (
          <dl className="kv">
            <dt>Nodes</dt><dd>{stats.totals.nodes}</dd>
            <dt>Edges</dt><dd>{stats.totals.edges}</dd>
            <dt>Tensions (active)</dt><dd>{stats.totals.tensions_active}</dd>
            <dt>Tensions (resolved)</dt><dd>{stats.totals.tensions_resolved}</dd>
            <dt>Mean health</dt><dd>{stats.health_mean.toFixed(2)}</dd>
            <dt>Mean confidence</dt><dd>{stats.confidence_mean.toFixed(2)}</dd>
          </dl>
        ) : (
          <p className="inspector-empty">Loading stats…</p>
        )}
        {stats ? (
          <>
            <h3 className="inspector-subtitle">By type</h3>
            <dl className="kv">
              {Object.entries(stats.nodes_by_type).map(([k, v]) => (
                <>
                  <dt key={`t-${k}`}>{k}</dt>
                  <dd key={`v-${k}`}>{v}</dd>
                </>
              ))}
            </dl>
            <h3 className="inspector-subtitle">By edge kind</h3>
            <dl className="kv">
              {Object.entries(stats.edges_by_kind).map(([k, v]) => (
                <>
                  <dt key={`et-${k}`}>{k}</dt>
                  <dd key={`ev-${k}`}>{v}</dd>
                </>
              ))}
            </dl>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="inspector">
      <h2 className="inspector-title">{selected.label}</h2>
      <p className="inspector-id">{selected.type} · {selected.id}</p>
      <dl className="kv">
        <dt>Degree</dt><dd>{selected.degree}</dd>
        <dt>Health</dt><dd>{selected.health.toFixed(2)}</dd>
        <dt>Confidence</dt><dd>{selected.confidence.toFixed(2)}</dd>
      </dl>
      {loading ? <p className="inspector-empty">Loading…</p> : null}
      {error ? <p className="inspector-error">{error}</p> : null}
      {record ? (
        <>
          <EntityBlock record={record} />
          <EdgeList
            title="Outgoing"
            edges={record.outgoing}
            otherKey="t"
            onNavigate={onNavigate}
          />
          <EdgeList
            title="Incoming"
            edges={record.incoming}
            otherKey="s"
            onNavigate={onNavigate}
          />
        </>
      ) : null}
    </div>
  );
}

function EntityBlock({ record }: { record: NodeRecord }) {
  const e = record.entity as Record<string, unknown> | null;
  if (!e) return null;
  const interesting = [
    "category",
    "tags",
    "domain",
    "urgency",
    "status",
    "strategy",
    "reason",
    "description",
    "source_repo",
    "source_files",
    "key_fields",
    "steps",
    "entities",
  ];
  const rows = interesting
    .map((k) => [k, e[k]] as const)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0));
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="inspector-subtitle">Entity</h3>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <>
            <dt key={`ek-${k}`}>{k}</dt>
            <dd key={`ev-${k}`}>{renderValue(v)}</dd>
          </>
        ))}
      </dl>
    </>
  );
}

function renderValue(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : (x as { name?: string }).name ?? JSON.stringify(x)))
      .join(", ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function EdgeList({
  title,
  edges,
  otherKey,
  onNavigate,
}: {
  title: string;
  edges: ExplorerEdge[];
  otherKey: "s" | "t";
  onNavigate: (id: string) => void;
}) {
  if (edges.length === 0) return null;
  return (
    <>
      <h3 className="inspector-subtitle">{title} ({edges.length})</h3>
      <ul className="edgelist">
        {edges.map((e, i) => {
          const id = e[otherKey];
          return (
            <li key={`${id}-${e.kind}-${i}`} className={`edgelist-item k-${e.kind}`}>
              <button className="edgelist-link" onClick={() => onNavigate(id)}>
                <span className={`edgelist-kind k-${e.kind}`}>{e.kind}</span>
                <span className="edgelist-target">{id}</span>
                <span className="edgelist-conf">{e.conf.toFixed(2)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
