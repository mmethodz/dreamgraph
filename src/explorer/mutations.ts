/**
 * DreamGraph Explorer — Phase 4 / Slice 2: GraphMutationService.
 *
 * One funnel for every curated write the Explorer is allowed to perform.
 * Slice 2 ships three real intents:
 *
 *   - tension.resolve
 *   - candidate.promote
 *   - candidate.reject
 *
 * Per-request pipeline:
 *
 *   1. Generate `mutation_id` (returned to client + audited).
 *   2. `requireInstanceAuth` — header check, 401/403 on failure.
 *   3. Body parse — JSON object, optional `dry_run` flag.
 *   4. `requireReason` — body must carry a non-empty `reason` string.
 *   5. `requireEtag` — `If-Match` is mandatory; mismatched → 412.
 *   6. `before_hash` — handler-supplied subject snapshot (sha-256 hex).
 *   7. Run handler (skipped during dry-run if it has side effects).
 *   8. `after_hash` — same subject, post-mutation.
 *   9. Capture post-mutation snapshot etag for the audit row.
 *  10. Append audit row → bus emits `audit.appended` automatically.
 *  11. Respond.
 *
 * Errors thrown by the handler are caught, audited, and returned as
 * `{ ok: false, error, message }` — the daemon never crashes from a
 * bad mutation. Failure rows are appended too, so nothing is silent.
 */

import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logger } from "../utils/logger.js";
import { requireInstanceAuth, type AuthSuccess } from "./auth.js";
import { appendAuditRow, type AuditRow } from "./audit.js";
import { getGraphSnapshot } from "../graph/snapshot.js";
import { engine } from "../cognitive/engine.js";

export interface MutationContext {
  mutation_id: string;
  auth: AuthSuccess;
  dry_run: boolean;
  reason: string;
  /** Validated request body (already JSON-parsed; `{}` if empty). */
  body: Record<string, unknown>;
  /** Raw `If-Match` value (always present when `requireEtag: true`). */
  etag_in: string;
}

export interface MutationResult {
  /** Entity / edge / tension ids the mutation touched. */
  affected_ids: string[];
  /** Optional payload returned to the client. */
  data?: unknown;
}

export type MutationHandler = (ctx: MutationContext) => Promise<MutationResult>;

/**
 * Subject hash callback. Returns sha-256 hex of whatever the intent
 * considers the "before/after" surface (the resolved tension JSON, the
 * candidate result JSON, etc.). Returning null means "subject doesn't
 * exist at this phase" — typically used post-mutation when the entity
 * was deleted.
 */
export type SubjectHasher = (ctx: MutationContext, phase: "before" | "after") => Promise<string | null>;

export interface MutationDefinition {
  /** Stable wire name used in audit + telemetry. */
  intent: string;
  /** When true, an `If-Match` header is mandatory. */
  requireEtag: boolean;
  /** When true, body must include a non-empty `reason` string. */
  requireReason: boolean;
  /** Callback to compute before/after subject hash for audit. */
  hashSubject?: SubjectHasher;
  /** Handler body. Receives the parsed context, returns affected ids + data. */
  run: MutationHandler;
}

/* ------------------------------------------------------------------ */
/*  Service                                                           */
/* ------------------------------------------------------------------ */

class GraphMutationService {
  private readonly intents = new Map<string, MutationDefinition>();

  /** Register a mutation. Throws if the intent is already taken. */
  register(def: MutationDefinition): void {
    if (this.intents.has(def.intent)) {
      throw new Error(`GraphMutationService: intent "${def.intent}" already registered`);
    }
    this.intents.set(def.intent, def);
  }

  /** Look up a registered intent. Used by the route handler + tests. */
  get(intent: string): MutationDefinition | undefined {
    return this.intents.get(intent);
  }

  /** Test-only — clear all registrations and re-seed defaults. */
  _resetForTest(): void {
    this.intents.clear();
    registerDefaultIntents(this);
  }

  /**
   * Execute a mutation request end-to-end. Returns `true` when the
   * pipeline took ownership of the response.
   */
  async execute(req: IncomingMessage, res: ServerResponse, intent: string): Promise<boolean> {
    const def = this.get(intent);
    if (!def) {
      this.respondError(res, 404, "unknown_intent", `No mutation registered for intent "${intent}".`);
      return true;
    }

    const mutation_id = randomUUID();

    const auth = requireInstanceAuth(req, res);
    if (!auth) return true; // 401/403 already written

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      this.respondError(res, 400, "bad_body", err instanceof Error ? err.message : "Invalid JSON body");
      return true;
    }

    const ifMatch = req.headers["if-match"];
    const etag_in = typeof ifMatch === "string" && ifMatch.length > 0 ? ifMatch : null;
    const dryRunHeader = req.headers["x-dreamgraph-dry-run"];
    const dryRunFromHeader = typeof dryRunHeader === "string" && dryRunHeader === "1";
    const dryRunFromBody = body["dry_run"] === true;
    const dry_run = dryRunFromHeader || dryRunFromBody;

    const reasonRaw = body["reason"];
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";

    // -------- Hard preconditions --------
    if (def.requireReason && reason.length === 0) {
      this.respondError(
        res,
        400,
        "missing_reason",
        `Mutation "${def.intent}" requires a non-empty body.reason string.`,
      );
      return true;
    }

    if (def.requireEtag && !etag_in) {
      this.respondError(
        res,
        400,
        "missing_if_match",
        `Mutation "${def.intent}" requires an If-Match header carrying the snapshot etag you fetched.`,
      );
      return true;
    }

    if (etag_in) {
      const current = await getGraphSnapshot();
      if (current.etag !== etag_in) {
        await this.audit({
          mutation_id,
          actor: auth.actor_uuid,
          intent: def.intent,
          affected_ids: [],
          reason: reason || "(precondition failed)",
          before_hash: null,
          after_hash: null,
          etag: current.etag,
          dry_run,
          ok: false,
          error: "etag_mismatch",
          message: `If-Match ${etag_in} does not match current snapshot etag ${current.etag}.`,
        });
        this.respondError(res, 412, "etag_mismatch", "Snapshot has changed since you fetched it. Reload and retry.");
        return true;
      }
    }

    const ctx: MutationContext = {
      mutation_id,
      auth,
      dry_run,
      reason: reason || "(no reason)",
      body,
      etag_in: etag_in ?? "",
    };

    let before_hash: string | null = null;
    if (def.hashSubject) {
      try {
        before_hash = await def.hashSubject(ctx, "before");
      } catch (err) {
        logger.debug(
          `hashSubject(before) for "${def.intent}" failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    try {
      const result = dry_run
        ? await this.dryRunResult(def, ctx)
        : await def.run(ctx);

      let after_hash: string | null = null;
      if (def.hashSubject) {
        try {
          after_hash = await def.hashSubject(ctx, "after");
        } catch (err) {
          logger.debug(
            `hashSubject(after) for "${def.intent}" failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      // Dry-run never changes the subject — make that explicit on the row.
      if (dry_run) after_hash = before_hash;

      const after = await getGraphSnapshot().catch(() => null);
      const etag_out = after?.etag ?? null;

      await this.audit({
        mutation_id,
        actor: auth.actor_uuid,
        intent: def.intent,
        affected_ids: result.affected_ids,
        reason: ctx.reason,
        before_hash,
        after_hash,
        etag: etag_out,
        dry_run,
        ok: true,
      });

      this.respondOk(res, {
        ok: true,
        mutation_id,
        intent: def.intent,
        dry_run,
        actor: auth.actor_uuid,
        affected_ids: result.affected_ids,
        before_hash,
        after_hash,
        etag: etag_out,
        data: result.data ?? null,
      });
      return true;
    } catch (err) {
      const code = err instanceof MutationError ? err.code : "internal";
      const status = err instanceof MutationError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Mutation "${def.intent}" failed: ${message}`);
      await this.audit({
        mutation_id,
        actor: auth.actor_uuid,
        intent: def.intent,
        affected_ids: [],
        reason: ctx.reason,
        before_hash,
        after_hash: before_hash,
        etag: null,
        dry_run,
        ok: false,
        error: code,
        message,
      });
      this.respondError(res, status, code, message);
      return true;
    }
  }

  /**
   * Dry-run rehearsal — never invokes the real handler. We still want
   * to surface intent-specific affected ids, so we ask the handler
   * indirectly through a simulated probe: read the body's primary id
   * so the audit + EventDock entry is meaningful.
   */
  private async dryRunResult(def: MutationDefinition, ctx: MutationContext): Promise<MutationResult> {
    const id =
      (typeof ctx.body["tension_id"] === "string" && ctx.body["tension_id"]) ||
      (typeof ctx.body["dream_id"] === "string" && ctx.body["dream_id"]) ||
      "";
    return {
      affected_ids: id ? [id as string] : [],
      data: { rehearsed: true, intent: def.intent },
    };
  }

  private async audit(partial: Omit<AuditRow, "timestamp">): Promise<void> {
    await appendAuditRow({ timestamp: new Date().toISOString(), ...partial });
  }

  private respondOk(res: ServerResponse, body: unknown): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  private respondError(res: ServerResponse, status: number, code: string, message: string): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: code, message }));
  }
}

/* ------------------------------------------------------------------ */
/*  Errors handlers can throw to control HTTP status                  */
/* ------------------------------------------------------------------ */

export class MutationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number = 400) {
    super(message);
    this.name = "MutationError";
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (raw.trim().length === 0) return resolve({});
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reject(new Error("Body must be a JSON object"));
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/* ------------------------------------------------------------------ */
/*  Built-in intents                                                  */
/* ------------------------------------------------------------------ */

function registerDefaultIntents(svc: GraphMutationService): void {
  /* ---------------- tension.resolve ---------------- */
  svc.register({
    intent: "tension.resolve",
    requireEtag: true,
    requireReason: true,
    hashSubject: async (ctx) => {
      const id = ctx.body["tension_id"];
      if (typeof id !== "string") return null;
      const tensions = await engine.loadTensions();
      const active = tensions.signals.find((s) => s.id === id);
      if (active) return sha256(active);
      const archived = (tensions.resolved_tensions ?? []).find((r) => r.tension_id === id);
      return archived ? sha256(archived) : null;
    },
    run: async (ctx) => {
      const tension_id = requireString(ctx.body, "tension_id");
      const resolution_type = optionalString(ctx.body, "resolution_type");
      const evidence = optionalString(ctx.body, "evidence");

      const result = await engine.userResolveTension(tension_id, {
        resolution_type: resolution_type as ("confirmed_fixed" | "false_positive" | "wont_fix" | undefined),
        evidence: evidence ?? ctx.reason,
      });
      if (!result.resolved) {
        throw new MutationError("not_found", `Tension ${tension_id} is not active.`, 404);
      }
      return {
        affected_ids: result.affected_ids,
        data: {
          tension_id,
          resolution_type: result.resolved.resolution_type,
          resolved_at: result.resolved.resolved_at,
        },
      };
    },
  });

  /* ---------------- candidate.promote ---------------- */
  svc.register({
    intent: "candidate.promote",
    requireEtag: true,
    requireReason: true,
    hashSubject: async (ctx) => {
      const id = ctx.body["dream_id"];
      if (typeof id !== "string") return null;
      const candidates = await engine.loadCandidateEdges();
      const c = candidates.results.find((r) => r.dream_id === id);
      return c ? sha256(c) : null;
    },
    run: async (ctx) => {
      const dream_id = requireString(ctx.body, "dream_id");
      const result = await engine.userPromoteCandidate(dream_id);
      if (!result.edge) {
        throw new MutationError("not_found", `No candidate with dream_id ${dream_id}.`, 404);
      }
      return {
        affected_ids: result.affected_ids,
        data: {
          dream_id,
          validated_edge_id: result.edge.id,
          from: result.edge.from,
          to: result.edge.to,
          confidence: result.edge.confidence,
        },
      };
    },
  });

  /* ---------------- candidate.reject ---------------- */
  svc.register({
    intent: "candidate.reject",
    requireEtag: true,
    requireReason: true,
    hashSubject: async (ctx) => {
      const id = ctx.body["dream_id"];
      if (typeof id !== "string") return null;
      const candidates = await engine.loadCandidateEdges();
      const c = candidates.results.find((r) => r.dream_id === id);
      return c ? sha256(c) : null;
    },
    run: async (ctx) => {
      const dream_id = requireString(ctx.body, "dream_id");
      const result = await engine.userRejectCandidate(dream_id);
      if (!result.candidate) {
        throw new MutationError("not_found", `No candidate with dream_id ${dream_id}.`, 404);
      }
      return {
        affected_ids: result.affected_ids,
        data: { dream_id, status: result.candidate.status },
      };
    },
  });
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new MutationError("bad_body", `Body is missing required string field "${key}".`, 400);
  }
  return v;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const v = body[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

/* ------------------------------------------------------------------ */
/*  Singleton                                                         */
/* ------------------------------------------------------------------ */

export const graphMutationService = new GraphMutationService();
registerDefaultIntents(graphMutationService);
