/**
 * Phase 3 / Slice 2 — Bottom event dock.
 *
 * Fixed-position list of the last cognitive events streamed from
 * /explorer/events. Color-coded by kind, collapsible, auto-shows newest
 * at the top.
 */

import { useState } from "react";
import type { GraphEvent, GraphEventKind } from "./sse";

interface Props {
  events: GraphEvent[];
  connected: boolean;
}

const KIND_COLORS: Record<GraphEventKind, string> = {
  "snapshot.changed": "#7aa2ff",
  "cache.invalidated": "#5a6577",
  "dream.cycle.completed": "#d4b3ff",
  "tension.created": "#ff7474",
  "tension.resolved": "#9be8de",
  "candidate.added": "#ffc58a",
  "candidate.promoted": "#a8c2ff",
  "candidate.rejected": "#c87ab8",
  "audit.appended": "#f0d56b",
};

const KIND_LABELS: Record<GraphEventKind, string> = {
  "snapshot.changed": "snapshot",
  "cache.invalidated": "cache",
  "dream.cycle.completed": "dream cycle",
  "tension.created": "tension +",
  "tension.resolved": "tension ✓",
  "candidate.added": "candidate +",
  "candidate.promoted": "promoted",
  "candidate.rejected": "rejected",
  "audit.appended": "audit",
};

export function EventDock({ events, connected }: Props): JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <div className={`event-dock${open ? " open" : " collapsed"}`}>
      <button
        className="event-dock-header"
        onClick={() => setOpen((v) => !v)}
        title={connected ? "Live event stream connected" : "Reconnecting…"}
      >
        <span className={`event-dock-led${connected ? " on" : " off"}`} />
        <span className="event-dock-title">
          live events {events.length > 0 ? `(${events.length})` : ""}
        </span>
        <span className="event-dock-chevron">{open ? "▾" : "▴"}</span>
      </button>
      {open ? (
        <ul className="event-dock-list">
          {events.length === 0 ? (
            <li className="event-dock-empty">no events yet — waiting for the engine…</li>
          ) : (
            events.map((ev) => (
              <li key={ev.seq} className="event-dock-item">
                <span
                  className="event-dock-kind"
                  style={{ color: KIND_COLORS[ev.kind] }}
                >
                  {KIND_LABELS[ev.kind] ?? ev.kind}
                </span>
                <span className="event-dock-meta">
                  #{ev.seq} · {new Date(ev.ts).toLocaleTimeString()}
                </span>
                {ev.kind === "audit.appended" && ev.payload ? (
                  <span
                    className="event-dock-ids"
                    title={`mutation_id: ${ev.payload.mutation_id}\nreason: ${ev.payload.reason}\nbefore: ${ev.payload.before_hash ?? "—"}\nafter: ${ev.payload.after_hash ?? "—"}`}
                  >
                    {String(ev.payload.intent ?? "?")}
                    {ev.payload.dry_run ? " (dry-run)" : ""}
                    {ev.payload.ok === false ? " ✖" : ""}
                  </span>
                ) : ev.affected_ids.length > 0 ? (
                  <span className="event-dock-ids" title={ev.affected_ids.join(", ")}>
                    {ev.affected_ids.slice(0, 3).join(", ")}
                    {ev.affected_ids.length > 3 ? ` +${ev.affected_ids.length - 3}` : ""}
                  </span>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
