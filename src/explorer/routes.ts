/**
 * DreamGraph Explorer — Phase 0 + Phase 2 routes.
 *
 * Surface (per plans/DREAMGRAPH_EXPLORER.md §4):
 *   GET  /explorer/api/graph-snapshot
 *   GET  /explorer/api/metrics
 *   POST /explorer/api/metrics/client
 *   GET  /explorer/api/node/:id
 *   GET  /explorer/api/neighborhood/:id?depth=N&limit=M
 *   GET  /explorer/api/search?q=...&types=...&limit=
 *   GET  /explorer/api/edges?kind=...&min_conf=&limit=
 *   GET  /explorer/api/tensions[?status=active|resolved]
 *   GET  /explorer/api/stats
 *
 * Read-only. Loopback-only auth inherits from the daemon. No SSE, no
 * mutations yet — Phase 3+.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getGraphSnapshot } from "../graph/snapshot.js";
import {
  getMetricsView,
  recordClientMetrics,
  timeRoute,
} from "../graph/metrics.js";
import { handleSpaRequest } from "./static.js";
import { handleEventsStream } from "./events.js";
import { graphMutationService } from "./mutations.js";
import { handleReasonSuggest } from "./reason-suggest.js";
import {
  getNeighborhood,
  getNodeRecord,
  getStats,
  getTensionView,
  listEdges,
  parseEdgeKindSet,
  parseNodeTypeSet,
  search,
} from "./queries.js";
import { logger } from "../utils/logger.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function jsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  json(res, status, { ok: false, error: code, message });
}

async function readJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : ({} as T));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/*  Handlers                                                          */
/* ------------------------------------------------------------------ */

async function handleSnapshot(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const snapshot = await timeRoute("snapshot", () => getGraphSnapshot());

  // ETag conditional GET — saves a re-render on the client.
  const incoming = req.headers["if-none-match"];
  if (typeof incoming === "string" && incoming === snapshot.etag) {
    res.writeHead(304, { ETag: snapshot.etag });
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Type": "application/json",
    ETag: snapshot.etag,
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(snapshot));
}

function handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  json(res, 200, getMetricsView());
}

async function handleClientMetrics(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const result = recordClientMetrics(body);
    json(res, 202, { ok: true, ...result });
  } catch (err) {
    jsonError(res, 400, "bad_request", (err as Error).message);
  }
}

/* ------------------------------------------------------------------ */
/*  Phase 2 query handlers                                            */
/* ------------------------------------------------------------------ */

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

function parseInt32(value: string | null, fallback: number, max: number): number {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function parseFloat01(value: string | null, fallback: number): number {
  if (value == null) return fallback;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

async function handleNode(
  res: ServerResponse,
  id: string,
): Promise<void> {
  const record = await timeRoute("node", () => getNodeRecord(id));
  if (!record) {
    jsonError(res, 404, "not_found", `No node with id: ${id}`);
    return;
  }
  json(res, 200, record);
}

async function handleNeighborhood(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const depth = parseInt32(qs.get("depth"), 1, 4);
  const limit = parseInt32(qs.get("limit"), 200, 2000);
  const result = await timeRoute("neighborhood", () =>
    getNeighborhood(id, depth, limit),
  );
  if (!result) {
    jsonError(res, 404, "not_found", `No node with id: ${id}`);
    return;
  }
  json(res, 200, result);
}

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const q = qs.get("q") ?? "";
  const types = parseNodeTypeSet(qs.get("types") ?? undefined);
  const limit = parseInt32(qs.get("limit"), 25, 200);
  const result = await timeRoute("search", () => search(q, types, limit));
  json(res, 200, result);
}

async function handleEdgesQuery(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const kinds = parseEdgeKindSet(qs.get("kind") ?? undefined);
  const minConf = parseFloat01(qs.get("min_conf"), 0);
  const limit = parseInt32(qs.get("limit"), 500, 5000);
  const result = await timeRoute("edges", () =>
    listEdges(kinds, minConf, limit),
  );
  json(res, 200, result);
}

async function handleTensions(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const qs = parseQuery(req.url ?? "");
  const status = qs.get("status");
  const filter: "active" | "resolved" | "all" =
    status === "resolved" ? "resolved"
    : status === "all" ? "all"
    : "active";
  const view = await timeRoute("tensions", () => getTensionView(filter));
  json(res, 200, view);
}

async function handleStatsRoute(res: ServerResponse): Promise<void> {
  const stats = await timeRoute("stats", () => getStats());
  json(res, 200, stats);
}

async function handleCandidates(res: ServerResponse): Promise<void> {
  // Slim wrapper around the cognitive engine's candidate file. We only
  // expose entries the user can act on (latent — neither auto-validated
  // nor auto-rejected). The mutation endpoints find the entry by
  // dream_id, so we surface that as the row key.
  //
  // We also enrich each row with the underlying dream node/edge so the
  // Explorer Candidates panel can show meaningful endpoints (from → to,
  // relation, name) and let the user inspect either side. Without this
  // the UI only had `dream_id`, which is opaque.
  const { engine } = await import("../cognitive/engine.js");
  const file = await timeRoute("candidates", () => engine.loadCandidateEdges());
  const dreamGraph = await engine.loadDreamGraph();
  const dreamNodes = new Map(dreamGraph.nodes.map((n) => [n.id, n]));
  const dreamEdges = new Map(dreamGraph.edges.map((e) => [e.id, e]));
  // Orphaned candidates (their underlying dream node/edge has been pruned
  // from dream_graph.json) cannot be acted on meaningfully — promote/reject
  // would either fail or operate on missing data, and the row would render
  // as "? → ?". Surface them in a separate count so the operator knows the
  // pool isn't lying, but exclude them from the actionable list.
  const allLatent = file.results.filter((r) => r.status === "latent");
  const latent = allLatent.filter((r) =>
    r.dream_type === "edge" ? dreamEdges.has(r.dream_id) : dreamNodes.has(r.dream_id),
  );
  const orphaned = allLatent.length - latent.length;
  json(res, 200, {
    total: file.results.length,
    pending: latent.length,
    orphaned,
    last_normalization: file.metadata.last_normalization,
    candidates: latent.map((r) => {
      const base = {
        dream_id: r.dream_id,
        dream_type: r.dream_type,
        confidence: r.confidence,
        plausibility: r.plausibility,
        evidence_score: r.evidence_score,
        contradiction_score: r.contradiction_score,
        evidence_count: r.evidence_count,
        reason_code: r.reason_code,
        reason: r.reason,
        validated_at: r.validated_at,
      };
      if (r.dream_type === "edge") {
        const e = dreamEdges.get(r.dream_id);
        if (e) {
          return {
            ...base,
            from: e.from,
            to: e.to,
            relation: e.relation,
            edge_kind: e.type,
            strategy: e.strategy,
            dream_cycle: e.dream_cycle,
            dream_reason: e.reason,
          };
        }
      } else {
        const n = dreamNodes.get(r.dream_id);
        if (n) {
          return {
            ...base,
            name: n.name,
            description: n.description,
            entity_type: n.type,
            inspiration: n.inspiration,
            dream_cycle: n.dream_cycle,
            intent: n.intent,
          };
        }
      }
      return base;
    }),
  });
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                        */
/* ------------------------------------------------------------------ */

/**
 * Returns true if the request was handled (response sent).
 *
 * Caller in src/index.ts is expected to test
 * `pathname.startsWith("/explorer/")` before dispatching.
 */
export async function handleExplorerRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  try {
    if (req.method === "GET" && pathname === "/explorer/api/graph-snapshot") {
      await handleSnapshot(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/metrics") {
      handleMetrics(req, res);
      return true;
    }

    if (req.method === "POST" && pathname === "/explorer/api/metrics/client") {
      await handleClientMetrics(req, res);
      return true;
    }

    // Phase 2 read-only queries.
    if (req.method === "GET" && pathname.startsWith("/explorer/api/node/")) {
      const id = decodeURIComponent(pathname.slice("/explorer/api/node/".length));
      if (!id) {
        jsonError(res, 400, "bad_request", "Missing node id");
        return true;
      }
      await handleNode(res, id);
      return true;
    }

    if (
      req.method === "GET" &&
      pathname.startsWith("/explorer/api/neighborhood/")
    ) {
      const id = decodeURIComponent(
        pathname.slice("/explorer/api/neighborhood/".length).split("?")[0],
      );
      if (!id) {
        jsonError(res, 400, "bad_request", "Missing node id");
        return true;
      }
      await handleNeighborhood(req, res, id);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/search") {
      await handleSearch(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/edges") {
      await handleEdgesQuery(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/tensions") {
      await handleTensions(req, res);
      return true;
    }

    if (req.method === "GET" && pathname === "/explorer/api/stats") {
      await handleStatsRoute(res);
      return true;
    }

    // Phase 4 / Slice 1 (frontend): list candidate edges awaiting a
    // promote/reject decision. Returns the latent (= not-yet-decided)
    // entries from candidate_edges.json.
    if (req.method === "GET" && pathname === "/explorer/api/candidates") {
      await handleCandidates(res);
      return true;
    }

    // Phase 4 / Slice 1 (frontend): LLM-backed reason suggester for
    // curated mutations. Read-only from the graph perspective.
    if (req.method === "POST" && pathname === "/explorer/api/reason-suggest") {
      await handleReasonSuggest(req, res);
      return true;
    }

    // Phase 3 / Slice 1: live event stream.
    if (req.method === "GET" && pathname === "/explorer/events") {
      handleEventsStream(req, res);
      return true;
    }

    // Phase 4 / Slice 1: curated mutation pipeline. Only the `ping`
    // intent is registered today — real intents land in Slice 2.
    if (req.method === "POST" && pathname.startsWith("/explorer/mutations/")) {
      const intent = pathname.slice("/explorer/mutations/".length);
      if (!intent) {
        jsonError(res, 400, "bad_request", "Missing mutation intent");
        return true;
      }
      await graphMutationService.execute(req, res, intent);
      return true;
    }

    // Anything else under /explorer/api/* is a 404.
    if (pathname.startsWith("/explorer/api/")) {
      jsonError(res, 404, "not_found", `No Explorer endpoint: ${pathname}`);
      return true;
    }

    // Phase 1: SPA shell + static assets at /explorer/ and /explorer/assets/*.
    // Returns false when the SPA bundle is missing so the outer router can
    // emit its standard 404.
    return handleSpaRequest(req, res, pathname);
  } catch (err) {
    logger.error(`/explorer route error (${pathname}):`, err);
    jsonError(res, 500, "internal_error", (err as Error).message);
    return true;
  }
}
