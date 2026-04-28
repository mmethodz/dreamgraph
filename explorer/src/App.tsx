import { useEffect, useMemo, useState } from "react";
import { fetchSnapshot, fetchStats, SnapshotVersionError } from "./api";
import { GraphCanvas } from "./GraphCanvas";
import { SearchBar } from "./SearchBar";
import { FiltersPanel } from "./FiltersPanel";
import { Inspector } from "./Inspector";
import { TensionsPanel } from "./TensionsPanel";
import { CandidatesPanel } from "./CandidatesPanel";
import { defaultFilters, type ExplorerMode, type FilterState } from "./filters";
import { EDGE_STYLES, NODE_COLORS } from "./theme";
import type { ExplorerEdgeKind, ExplorerNodeType, GraphSnapshot, StatsResult } from "./types";
import { useEventStream } from "./sse";
import { EventDock } from "./EventDock";

type RightTab = "inspector" | "tensions" | "candidates";

export function App() {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [stats, setStats] = useState<StatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionError, setVersionError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>(() => defaultFilters());
  const [mode, setMode] = useState<ExplorerMode>("atlas");
  const [rightTab, setRightTab] = useState<RightTab>("inspector");
  const [conflictBanner, setConflictBanner] = useState(false);
  const { events: liveEvents, pulses, connected: sseConnected } = useEventStream();

  const refreshSnapshot = () => {
    const t0 = performance.now();
    fetchSnapshot()
      .then((s) => {
        setSnapshot(s);
        const ms = Math.round(performance.now() - t0);
        void fetch("/explorer/api/metrics/client", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ "snapshot.fetch_ms": ms }),
        }).catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (err instanceof SnapshotVersionError) setVersionError(true);
        else setError(err instanceof Error ? err.message : String(err));
      });
    fetchStats().then(setStats).catch(() => undefined);
  };

  useEffect(() => {
    refreshSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedNode = useMemo(() => {
    if (!snapshot || !selected) return null;
    return snapshot.nodes.find((n) => n.id === selected) ?? null;
  }, [snapshot, selected]);

  const nodeColors = NODE_COLORS as Record<ExplorerNodeType, string>;
  const edgeColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(EDGE_STYLES)) out[k] = v.color;
    return out as Record<ExplorerEdgeKind, string>;
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <span className="brand">DreamGraph Explorer</span>
        <span className="meta">Phase 4 · curated mutations</span>
        <SearchBar onPick={setSelected} />
        <div className="mode-toggle">
          <button
            className={`mode-btn${mode === "atlas" ? " active" : ""}`}
            onClick={() => setMode("atlas")}
            title="Show the entire graph"
          >
            Atlas
          </button>
          <button
            className={`mode-btn${mode === "focus" ? " active" : ""}`}
            onClick={() => setMode("focus")}
            disabled={!selected}
            title={selected ? "Show only the selected node and its 2-hop neighborhood" : "Select a node first"}
          >
            Focus
          </button>
        </div>
        {snapshot ? (
          <span className="meta">
            instance <strong>{snapshot.instance_uuid.slice(0, 8)}</strong>
          </span>
        ) : null}
        {snapshot ? (
          <span className="meta">
            etag <strong>{snapshot.etag.slice(7, 15)}</strong>
          </span>
        ) : null}
      </div>

      <aside className="left">
        <FiltersPanel
          filters={filters}
          onChange={setFilters}
          nodeColors={nodeColors}
          edgeColors={edgeColors}
        />
        {versionError ? (
          <div className="error-banner">
            Daemon snapshot version is newer than this Explorer build — please
            update the SPA assets.
          </div>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
      </aside>

      {snapshot ? (
        <GraphCanvas
          snapshot={snapshot}
          onSelect={setSelected}
          filters={filters}
          mode={mode}
          selected={selected}
          pulses={pulses}
        />
      ) : (
        <div className="canvas-wrap">
          <div className="status">
            {error || versionError ? "snapshot unavailable" : "loading snapshot…"}
          </div>
        </div>
      )}

      <aside className="right">
        <div className="right-tabs">
          <button
            className={`right-tab${rightTab === "inspector" ? " active" : ""}`}
            onClick={() => setRightTab("inspector")}
          >
            Inspector
          </button>
          <button
            className={`right-tab${rightTab === "tensions" ? " active" : ""}`}
            onClick={() => setRightTab("tensions")}
          >
            Tensions
            {stats && stats.totals.tensions_active > 0 ? (
              <span className="right-tab-badge">{stats.totals.tensions_active}</span>
            ) : null}
          </button>
          <button
            className={`right-tab${rightTab === "candidates" ? " active" : ""}`}
            onClick={() => setRightTab("candidates")}
          >
            Candidates
          </button>
        </div>
        {conflictBanner ? (
          <div className="conflict-banner">
            Graph moved on. Snapshot refreshed — please retry.
          </div>
        ) : null}
        {rightTab === "inspector" ? (
          <Inspector
            selected={selectedNode}
            stats={stats}
            onNavigate={setSelected}
          />
        ) : rightTab === "tensions" && snapshot ? (
          <TensionsPanel
            instanceUuid={snapshot.instance_uuid}
            etag={snapshot.etag}
            onConflict={() => {
              setConflictBanner(true);
              refreshSnapshot();
              setTimeout(() => setConflictBanner(false), 4000);
            }}
            onApplied={() => {
              refreshSnapshot();
            }}
            onInspect={(id) => {
              setSelected(id);
              setRightTab("inspector");
            }}
          />
        ) : rightTab === "candidates" && snapshot ? (
          <CandidatesPanel
            instanceUuid={snapshot.instance_uuid}
            etag={snapshot.etag}
            onConflict={() => {
              setConflictBanner(true);
              refreshSnapshot();
              setTimeout(() => setConflictBanner(false), 4000);
            }}
            onApplied={() => {
              refreshSnapshot();
            }}
            onInspect={(id) => {
              setSelected(id);
              setRightTab("inspector");
            }}
          />
        ) : (
          <div className="panel-empty">Loading…</div>
        )}
      </aside>
      <EventDock events={liveEvents} connected={sseConnected} />
    </div>
  );
}
