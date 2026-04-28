import { useEffect, useState } from "react";
import {
  applyMutation,
  fetchCandidates,
  MutationConflictError,
  type CandidateRow,
} from "./api";
import { ReasonField } from "./ReasonField";

interface Props {
  instanceUuid: string;
  etag: string;
  onConflict: () => void;
  onApplied: (affected: string[]) => void;
  onInspect: (id: string) => void;
}

/**
 * List of latent candidate edges with inline `Promote` / `Reject`
 * forms. Refetches whenever the snapshot etag advances.
 */
export function CandidatesPanel({ instanceUuid, etag, onConflict, onApplied, onInspect }: Props) {
  const [rows, setRows] = useState<CandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openKind, setOpenKind] = useState<"promote" | "reject" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchCandidates()
      .then((r) => {
        if (!cancelled) setRows(r.candidates);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [etag]);

  if (error) return <div className="panel-error">{error}</div>;
  if (!rows) return <div className="panel-empty">Loading candidates…</div>;
  if (rows.length === 0)
    return <div className="panel-empty">No candidate edges awaiting decision.</div>;

  return (
    <div className="muts-list">
      {rows.map((c) => (
        <CandidateRowView
          key={c.dream_id}
          row={c}
          openKind={openId === c.dream_id ? openKind : null}
          onToggle={(kind) => {
            if (openId === c.dream_id && openKind === kind) {
              setOpenId(null);
              setOpenKind(null);
            } else {
              setOpenId(c.dream_id);
              setOpenKind(kind);
            }
          }}
          instanceUuid={instanceUuid}
          etag={etag}
          onConflict={onConflict}
          onInspect={onInspect}
          onApplied={(affected) => {
            setOpenId(null);
            setOpenKind(null);
            onApplied(affected);
          }}
        />
      ))}
    </div>
  );
}

function CandidateRowView(props: {
  row: CandidateRow;
  openKind: "promote" | "reject" | null;
  onToggle: (kind: "promote" | "reject") => void;
  instanceUuid: string;
  etag: string;
  onConflict: () => void;
  onApplied: (affected: string[]) => void;
  onInspect: (id: string) => void;
}) {
  const { row, openKind, onToggle, instanceUuid, etag, onConflict, onApplied, onInspect } = props;
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const intent = openKind === "promote" ? "candidate.promote" : "candidate.reject";

  // Build a meaningful title and a primary inspect target so the user can
  // see WHAT the candidate proposes — not just its dream_id.
  const isEdge = row.dream_type === "edge";
  const title = isEdge
    ? `${labelOf(row.from)}  →  ${labelOf(row.to)}`
    : row.name || row.dream_id;
  const subtitle = isEdge
    ? row.relation || row.edge_kind || "edge"
    : row.entity_type || "node";
  const primaryInspectId = isEdge ? row.from : row.dream_id;

  const fallback =
    openKind === "promote"
      ? `Promoting ${describeRow(row)}: confidence ${row.confidence.toFixed(2)} with ${row.evidence_count} supporting signals.`
      : `Rejecting ${describeRow(row)}: ${row.reason || "evidence insufficient for promotion"}.`;

  async function submit() {
    if (!openKind) return;
    setErr(null);
    setSubmitting(true);
    try {
      const r = await applyMutation({
        intent,
        instanceUuid,
        etag,
        reason: reason.trim(),
        body: { dream_id: row.dream_id },
      });
      onApplied(r.affected ?? [row.dream_id]);
    } catch (e) {
      if (e instanceof MutationConflictError) onConflict();
      else setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`muts-row${openKind ? " open" : ""}`}>
      <div className="muts-row-head muts-row-head-static">
        <span className="muts-badge muts-badge-candidate">{isEdge ? "edge" : "node"}</span>
        <div className="muts-row-titleblock">
          <div className="muts-row-title" title={title}>{title}</div>
          <div className="muts-row-subtitle" title={row.dream_id}>
            <span className="muts-row-subtitle-rel">{subtitle}</span>
            <span className="muts-row-subtitle-id">{row.dream_id}</span>
          </div>
        </div>
        <span className="muts-row-meta">
          conf {row.confidence.toFixed(2)} · ev ×{row.evidence_count}
        </span>
        <div className="muts-row-actions">
          {primaryInspectId ? (
            <button
              className="btn-mini"
              onClick={() => onInspect(primaryInspectId)}
              title={`Inspect ${primaryInspectId}`}
            >
              Inspect
            </button>
          ) : null}
          {isEdge && row.to ? (
            <button
              className="btn-mini"
              onClick={() => onInspect(row.to as string)}
              title={`Inspect ${row.to}`}
            >
              Inspect →
            </button>
          ) : null}
          <button
            className={`btn-mini${openKind === "promote" ? " active" : ""}`}
            onClick={() => onToggle("promote")}
            disabled={submitting}
          >
            Promote
          </button>
          <button
            className={`btn-mini btn-warn${openKind === "reject" ? " active" : ""}`}
            onClick={() => onToggle("reject")}
            disabled={submitting}
          >
            Reject
          </button>
        </div>
      </div>
      {openKind ? (
        <div className="muts-row-body">
          <div className="muts-meta">
            <span>{row.dream_type}</span>
            {row.strategy ? <span>· {row.strategy}</span> : null}
            {row.dream_cycle ? <span>· cycle {row.dream_cycle}</span> : null}
            <span>· plaus {row.plausibility.toFixed(2)}</span>
            <span>· ev-score {row.evidence_score.toFixed(2)}</span>
            <span>· contra {row.contradiction_score.toFixed(2)}</span>
          </div>
          {isEdge ? (
            <div className="muts-endpoints">
              <button className="muts-endpoint" onClick={() => row.from && onInspect(row.from)}>
                <span className="muts-endpoint-label">from</span>
                <code>{row.from}</code>
              </button>
              <span className="muts-endpoint-arrow">→</span>
              <button className="muts-endpoint" onClick={() => row.to && onInspect(row.to)}>
                <span className="muts-endpoint-label">to</span>
                <code>{row.to}</code>
              </button>
            </div>
          ) : (
            <div className="muts-meta">
              {row.intent ? <span>intent: {row.intent}</span> : null}
            </div>
          )}
          {row.description ? <p className="muts-rationale">{row.description}</p> : null}
          {row.dream_reason ? <p className="muts-rationale">{row.dream_reason}</p> : null}
          {row.reason ? <p className="muts-rationale">{row.reason}</p> : null}
          <ReasonField
            intent={intent}
            subject={{
              id: row.dream_id,
              type: row.dream_type,
              from: row.from,
              to: row.to,
              relation: row.relation,
              name: row.name,
              description: row.description,
              confidence: row.confidence,
              plausibility: row.plausibility,
              evidence_score: row.evidence_score,
              contradiction_score: row.contradiction_score,
              evidence_count: row.evidence_count,
              reason_code: row.reason_code,
              reason: row.reason,
            }}
            context={{ decision: openKind }}
            fallback={fallback}
            value={reason}
            onChange={setReason}
            disabled={submitting}
          />
          {err ? <div className="panel-error">{err}</div> : null}
          <div className="muts-actions">
            <button className="btn-ghost" onClick={() => onToggle(openKind)} disabled={submitting}>
              Cancel
            </button>
            <button
              className={openKind === "promote" ? "btn-primary" : "btn-danger"}
              onClick={() => void submit()}
              disabled={submitting || reason.trim().length === 0}
            >
              {submitting
                ? openKind === "promote"
                  ? "Promoting…"
                  : "Rejecting…"
                : openKind === "promote"
                  ? "Promote candidate"
                  : "Reject candidate"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function labelOf(id: string | undefined): string {
  if (!id) return "?";
  // Drop the longest UUID-ish suffix so titles stay readable. Show last
  // segment for namespaced ids like "feature:explorer".
  if (id.includes(":")) return id;
  if (id.length > 32) return id.slice(0, 14) + "…" + id.slice(-6);
  return id;
}

function describeRow(row: CandidateRow): string {
  if (row.dream_type === "edge" && row.from && row.to) {
    return `${row.relation || "edge"} ${row.from} → ${row.to}`;
  }
  return row.name || row.dream_id;
}
