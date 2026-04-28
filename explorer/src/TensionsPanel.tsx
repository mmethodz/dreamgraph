import { useEffect, useState } from "react";
import { applyMutation, fetchTensions, MutationConflictError } from "./api";
import { ReasonField } from "./ReasonField";
import type { TensionEntity, TensionView } from "./types";

interface Props {
  instanceUuid: string;
  etag: string;
  onConflict: () => void;
  onApplied: (affected: string[]) => void;
  onInspect: (id: string) => void;
}

/**
 * Active tensions list with inline `Resolve` form per row.
 *
 * Refetches on mount and whenever the snapshot etag changes (which the
 * caller advances after every successful mutation or SSE-driven snapshot
 * refresh). Resolutions go through `tension.resolve` with the user's
 * (possibly LLM-assisted) reason.
 */
export function TensionsPanel({ instanceUuid, etag, onConflict, onApplied, onInspect }: Props) {
  const [view, setView] = useState<TensionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchTensions("active")
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [etag]);

  if (error) return <div className="panel-error">{error}</div>;
  if (!view) return <div className="panel-empty">Loading tensions…</div>;
  if (view.active.length === 0)
    return <div className="panel-empty">No active tensions. Graph is calm.</div>;

  return (
    <div className="muts-list">
      {view.active.map((t) => (
        <TensionRow
          key={t.id}
          tension={t}
          open={openId === t.id}
          onToggle={() => setOpenId((cur) => (cur === t.id ? null : t.id))}
          instanceUuid={instanceUuid}
          etag={etag}
          onConflict={onConflict}
          onInspect={onInspect}
          onApplied={(affected) => {
            setOpenId(null);
            onApplied(affected);
          }}
        />
      ))}
    </div>
  );
}

function TensionRow(props: {
  tension: TensionEntity;
  open: boolean;
  onToggle: () => void;
  instanceUuid: string;
  etag: string;
  onConflict: () => void;
  onApplied: (affected: string[]) => void;
  onInspect: (id: string) => void;
}) {
  const { tension, open, onToggle, instanceUuid, etag, onConflict, onApplied, onInspect } = props;
  const [resolution, setResolution] = useState<"confirmed_fixed" | "false_positive" | "wont_fix">(
    "confirmed_fixed",
  );
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fallback = `${resolutionLabel(resolution)}: tension ${tension.id} reviewed; entities ${tension.entities.slice(0, 3).join(", ")}.`;

  async function submit() {
    setErr(null);
    setSubmitting(true);
    try {
      const r = await applyMutation({
        intent: "tension.resolve",
        instanceUuid,
        etag,
        reason: reason.trim(),
        body: {
          tension_id: tension.id,
          resolution_type: resolution,
        },
      });
      onApplied(r.affected ?? [tension.id]);
    } catch (e) {
      if (e instanceof MutationConflictError) onConflict();
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`muts-row${open ? " open" : ""}`}>
      <button className="muts-row-head" onClick={onToggle}>
        <span className="muts-badge muts-badge-tension">tension</span>
        <span className="muts-row-title">{tension.description || tension.id}</span>
        <span className="muts-row-meta">
          urgency {tension.urgency.toFixed(2)} · ×{tension.occurrences}
        </span>
      </button>
      {open ? (
        <div className="muts-row-body">
          <div className="muts-meta">
            <code>{tension.id}</code>
            <span>· first {tension.first_seen.slice(0, 10)}</span>
          </div>
          <div className="muts-field">
            <span className="muts-field-label">Entities ({tension.entities.length})</span>
            <div className="muts-endpoints muts-endpoints-wrap">
              {tension.entities.map((id) => (
                <button
                  key={id}
                  className="muts-endpoint"
                  onClick={() => onInspect(id)}
                  title={`Inspect ${id}`}
                >
                  <code>{id}</code>
                </button>
              ))}
            </div>
          </div>
          <label className="muts-field">
            <span className="muts-field-label">Resolution</span>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as typeof resolution)}
              disabled={submitting}
            >
              <option value="confirmed_fixed">Confirmed fixed</option>
              <option value="false_positive">False positive</option>
              <option value="wont_fix">Won't fix</option>
            </select>
          </label>
          <ReasonField
            intent="tension.resolve"
            subject={{
              id: tension.id,
              description: tension.description,
              entities: tension.entities,
              urgency: tension.urgency,
              occurrences: tension.occurrences,
            }}
            context={{ resolution_type: resolution }}
            fallback={fallback}
            value={reason}
            onChange={setReason}
            disabled={submitting}
          />
          {err ? <div className="panel-error">{err}</div> : null}
          <div className="muts-actions">
            <button className="btn-ghost" onClick={onToggle} disabled={submitting}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={() => void submit()}
              disabled={submitting || reason.trim().length === 0}
            >
              {submitting ? "Resolving…" : "Resolve tension"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function resolutionLabel(kind: string): string {
  switch (kind) {
    case "confirmed_fixed":
      return "Confirmed fixed";
    case "false_positive":
      return "False positive";
    case "wont_fix":
      return "Won't fix";
    default:
      return kind;
  }
}
