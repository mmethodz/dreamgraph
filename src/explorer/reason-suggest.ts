/**
 * DreamGraph Explorer — Phase 4 / Slice 1 (frontend mutations):
 * `POST /explorer/api/reason-suggest`
 *
 * Generates a short rationale string the SPA pre-fills into a curated
 * mutation form (tension.resolve / candidate.promote / candidate.reject).
 * The user always sees the suggestion highlighted and can keep, edit, or
 * delete it before submitting — the LLM never auto-mutates anything.
 *
 * Strategy: try the LLM provider (general / dreamer / normalizer model
 * config, in that order — dreamer/normalizer just override the base
 * model name). If the provider is "none", unreachable, or errors, we
 * return `{ ok: true, suggestion: null, source: "fallback" }` and let
 * the SPA fall back to a smart template.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getLlmConfig,
  getLlmProvider,
  getDreamerLlmConfig,
  getNormalizerLlmConfig,
  type LlmCompletionOptions,
  type LlmMessage,
} from "../cognitive/llm.js";
import { logger } from "../utils/logger.js";

interface SuggestRequest {
  intent?: string;
  subject?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

interface SuggestResponse {
  ok: true;
  suggestion: string | null;
  source: "llm" | "fallback";
  model?: string;
}

/* ------------------------------------------------------------------ */
/*  Public handler                                                    */
/* ------------------------------------------------------------------ */

export async function handleReasonSuggest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: SuggestRequest;
  try {
    body = await readJsonBody<SuggestRequest>(req);
  } catch (err) {
    return respond(res, 400, { ok: false as const, error: "bad_body", message: (err as Error).message });
  }

  const intent = typeof body.intent === "string" ? body.intent.trim() : "";
  if (!intent) {
    return respond(res, 400, { ok: false as const, error: "bad_body", message: "intent is required" });
  }

  const cfg = getLlmConfig();
  if (cfg.provider === "none") {
    return respond(res, 200, { ok: true, suggestion: null, source: "fallback" });
  }

  const model = pickModel(intent);
  const messages = buildPrompt(intent, body.subject, body.context);

  try {
    const provider = getLlmProvider();
    const opts: LlmCompletionOptions = { model, temperature: 0.4, maxTokens: 220 };
    const result = await Promise.race([
      provider.complete(messages, opts),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("llm_timeout")), 8000)),
    ]);
    const suggestion = sanitize(result.text);
    return respond(res, 200, {
      ok: true,
      suggestion: suggestion || null,
      source: suggestion ? "llm" : "fallback",
      model: result.model || model,
    });
  } catch (err) {
    logger.warn(`reason-suggest LLM failed (${intent}): ${(err as Error).message}`);
    return respond(res, 200, { ok: true, suggestion: null, source: "fallback" });
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fallback chain per intent. Each intent maps to the most appropriate
 * specialist model name; if it is empty/unset we walk up to dreamer,
 * then to the base ("general") config.
 */
function pickModel(intent: string): string {
  const base = getLlmConfig().model;
  const dreamer = getDreamerLlmConfig().model;
  const normalizer = getNormalizerLlmConfig().model;

  // Order: general → normalizer → dreamer (per user direction).
  const order: string[] = [base, normalizer, dreamer].filter((m): m is string => typeof m === "string" && m.length > 0);

  if (intent === "candidate.promote" || intent === "candidate.reject") {
    // Validation-leaning intents prefer the normalizer first if present.
    return [normalizer, base, dreamer].find((m) => m && m.length > 0) ?? order[0] ?? "";
  }
  if (intent === "tension.resolve") {
    return [base, normalizer, dreamer].find((m) => m && m.length > 0) ?? order[0] ?? "";
  }
  return order[0] ?? "";
}

function buildPrompt(
  intent: string,
  subject: Record<string, unknown> | undefined,
  context: Record<string, unknown> | undefined,
): LlmMessage[] {
  const intentDescription: Record<string, string> = {
    "tension.resolve":
      "The user is about to resolve a knowledge-graph tension (a previously detected conflict between facts). Suggest a one or two sentence rationale capturing why this resolution is reasonable, in plain English.",
    "candidate.promote":
      "The user is about to promote a candidate edge (a speculative relationship proposed by the dream cycle) to a validated graph fact. Suggest a one or two sentence rationale grounded in the candidate's stated evidence.",
    "candidate.reject":
      "The user is about to reject a candidate edge as unsupported or incorrect. Suggest a one or two sentence rationale explaining why the candidate is not a graph fact.",
  };

  const lead =
    intentDescription[intent] ??
    `The user is about to apply mutation "${intent}". Suggest a one or two sentence rationale.`;

  const sys = [
    "You are DreamGraph's curation assistant. Produce a concise reason field for an audited graph mutation.",
    "Constraints:",
    "- 1–2 sentences, max ~280 characters.",
    "- Plain English, no markdown, no quotes around the answer, no preamble like 'Reason:'.",
    "- Be specific: cite the entity ids, edge endpoints, or evidence shown in the subject when present.",
    "- Never invent facts that are not in the subject/context payload.",
    "- If the subject is missing or sparse, write a brief honest note (e.g. 'Manually reviewed; no objections.').",
  ].join("\n");

  const user = [
    lead,
    "",
    "Subject (the entity being acted on):",
    "```json",
    JSON.stringify(subject ?? {}, null, 2),
    "```",
    "",
    "Additional context:",
    "```json",
    JSON.stringify(context ?? {}, null, 2),
    "```",
    "",
    "Write the reason now. Just the sentence(s), nothing else.",
  ].join("\n");

  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

function sanitize(text: string): string {
  let out = (text ?? "").trim();
  // Strip wrapping quotes the model loves to add.
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1).trim();
  }
  // Strip leading "Reason:" / "Rationale:" labels.
  out = out.replace(/^(reason|rationale)\s*[:\-]\s*/i, "").trim();
  // Collapse newlines into spaces.
  out = out.replace(/\s*\n+\s*/g, " ").trim();
  // Cap at ~400 chars defensively.
  if (out.length > 400) out = out.slice(0, 397).trimEnd() + "…";
  return out;
}

function respond(res: ServerResponse, status: number, body: SuggestResponse | { ok: false; error: string; message: string }): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (raw.trim().length === 0) return resolve({} as T);
        resolve(JSON.parse(raw) as T);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}
