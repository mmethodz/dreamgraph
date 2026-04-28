import { useEffect, useRef, useState } from "react";
import { suggestReason, type ReasonSuggestion } from "./api";

export interface ReasonFieldProps {
  intent: string;
  subject: Record<string, unknown>;
  context?: Record<string, unknown>;
  /** Smart fallback used when LLM is unavailable / disabled. */
  fallback: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/**
 * Reason input for curated mutations.
 *
 * - Fires a POST /explorer/api/reason-suggest on mount (and when intent
 *   or subject id changes), pre-fills the textarea, and highlights it
 *   so the user can keep / edit / clear it without extra clicks.
 * - Falls back to the provided `fallback` template if the LLM is
 *   unavailable or returns nothing.
 * - Once the user types, we stop overwriting from the suggester.
 */
export function ReasonField(props: ReasonFieldProps) {
  const { intent, subject, context, fallback, value, onChange, disabled } = props;
  const [status, setStatus] = useState<"idle" | "loading" | "llm" | "fallback">("idle");
  const [model, setModel] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(false);
  const userEditedRef = useRef(false);

  // Stable signature so we only re-suggest when it actually changes.
  const subjectKey =
    typeof subject["id"] === "string"
      ? `${intent}:${subject["id"]}`
      : `${intent}:${JSON.stringify(Object.keys(subject).sort())}`;

  useEffect(() => {
    let cancelled = false;
    userEditedRef.current = false;
    setStatus("loading");
    setHighlight(false);
    suggestReason(intent, subject, context ?? {})
      .then((r: ReasonSuggestion) => {
        if (cancelled || userEditedRef.current) return;
        const text = r.suggestion ?? fallback;
        const src = r.source === "llm" && r.suggestion ? "llm" : "fallback";
        setStatus(src);
        setModel(r.model ?? null);
        onChange(text);
        setHighlight(true);
      })
      .catch(() => {
        if (cancelled || userEditedRef.current) return;
        setStatus("fallback");
        onChange(fallback);
        setHighlight(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectKey]);

  const charCount = value.length;
  const tooShort = value.trim().length === 0;

  return (
    <div className="reason-field">
      <div className="reason-label">
        <span>Reason</span>
        <span className={`reason-source reason-source-${status}`}>
          {status === "loading"
            ? "drafting…"
            : status === "llm"
              ? `LLM draft${model ? ` · ${model}` : ""}`
              : status === "fallback"
                ? "template"
                : "ready"}
        </span>
      </div>
      <textarea
        className={`reason-textarea${highlight ? " reason-highlight" : ""}${tooShort ? " reason-required" : ""}`}
        value={value}
        rows={3}
        disabled={disabled || status === "loading"}
        placeholder="Why is this mutation correct? (required, audited)"
        onChange={(e) => {
          userEditedRef.current = true;
          if (highlight) setHighlight(false);
          onChange(e.target.value);
        }}
        onFocus={() => {
          if (!highlight) return;
          // First focus: select the highlighted draft so the user can
          // type-to-replace or arrow-to-edit without manual selection.
          const ta = document.activeElement as HTMLTextAreaElement | null;
          if (ta && "select" in ta) ta.select();
        }}
      />
      <div className="reason-meta">
        <span className={charCount > 280 ? "reason-count over" : "reason-count"}>{charCount} chars</span>
        {tooShort ? <span className="reason-warn">Required.</span> : null}
      </div>
    </div>
  );
}
