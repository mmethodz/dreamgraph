/**
 * DreamGraph REST API Routes — Extension-facing HTTP endpoints.
 *
 * These endpoints are NOT MCP tools — they are traditional REST routes
 * that the VS Code extension (and other HTTP clients) call directly.
 *
 * Endpoints:
 *   GET  /api/instance                  — Instance identity and state
 *   POST /api/graph-context             — Graph-side enrichment for a file / feature set
 *   POST /api/validate                  — Combined validation (ADR + UI + API surface)
 *   GET  /api/orchestrate/capabilities  — Capability negotiation (v1 stub: available=false)
 *   POST /api/orchestrate               — Daemon-side Architect (v1 stub: 501)
 *
 * Boundary principle: the extension owns editor context; the daemon owns
 * graph and operational reasoning. These endpoints return graph facts only.
 *
 * @see TDD_VSCODE_EXTENSION.md §8.1
 */

import type { IncomingMessage, ServerResponse } from "node:http";

import { config } from "../config/config.js";
import { engine } from "../cognitive/engine.js";
import {
  getDreamerLlmConfig,
  getNormalizerLlmConfig,
} from "../cognitive/llm.js";
import { loadJsonData, loadJsonArray } from "../utils/cache.js";
import {
  loadJsonValidated,
  isMissingFileError,
  MissingFileError,
} from "../utils/json-store.js";
import { z } from "zod";
import {
  getActiveScope,
  isInstanceMode,
  getToolCallCount,
} from "../instance/index.js";
import { logger } from "../utils/logger.js";

import type {
  Feature,
  Workflow,
  ADRLogFile,
  UIRegistryFile,
  ApiSurface,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Minimal load-time validation schemas (F-01)
//
// We don't re-declare every nested ADR / UI / ApiSurface field in zod —
// the existing TS interfaces are the source of truth. These schemas only
// assert the *structural* shape (top-level fields that downstream code
// depends on), then pass through the rest. That gives us:
//   * a clear `ValidationError` instead of a runtime TypeError when a file
//     is corrupt / version-drifted,
//   * no maintenance burden when ADR / UI fields evolve.
// ---------------------------------------------------------------------------

const AdrLogFileSchema = z
  .object({
    metadata: z
      .object({
        description: z.string().default(""),
        schema_version: z.string().default(""),
        total_decisions: z.number().default(0),
        last_updated: z.string().nullable().default(null),
      })
      .passthrough(),
    decisions: z.array(z.unknown()).default([]),
  })
  .passthrough();

const UiRegistryFileSchema = z
  .object({
    metadata: z
      .object({
        description: z.string().default(""),
        schema_version: z.string().default(""),
        total_elements: z.number().default(0),
        total_categories: z.number().default(0),
        last_updated: z.string().nullable().default(null),
      })
      .passthrough(),
    elements: z.array(z.unknown()).default([]),
  })
  .passthrough();

const EMPTY_ADR_LOG: ADRLogFile = {
  metadata: {
    description: "",
    schema_version: "",
    total_decisions: 0,
    last_updated: null,
  },
  decisions: [],
};

const EMPTY_UI_REGISTRY: UIRegistryFile = {
  metadata: {
    description: "",
    schema_version: "",
    total_elements: 0,
    total_categories: 0,
    last_updated: null,
  },
  elements: [],
};

/** Wrap `loadJsonValidated` so missing files map to a typed empty default. */
async function loadOrEmpty<T>(
  loader: () => Promise<T>,
  empty: T,
  context: string,
): Promise<T> {
  try {
    return await loader();
  } catch (err) {
    if (isMissingFileError(err) || err instanceof MissingFileError) {
      return empty;
    }
    // Validation failures (and unexpected errors) propagate — the route
    // handler turns them into HTTP 500. Silently substituting empty would
    // mask data corruption.
    logger.warn(`[api] ${context} load failed: ${(err as Error).message}`);
    throw err;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Parse JSON body from an incoming request. */
async function parseJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw.length > 0 ? JSON.parse(raw) : ({} as T));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Send a JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Send a JSON error response. */
function jsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  json(res, status, { ok: false, error: code, message });
}

// ─── GET /api/instance ──────────────────────────────────────────────────────

/**
 * Return full instance identity and state for the extension sidebar.
 *
 * @see TDD §8.1 — InstanceResponse
 */
async function handleGetInstance(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const scope = getActiveScope();
    const status = await engine.getStatus();

    // LLM model info — wrapped in try/catch since config may not be set
    let dreamerModel: { provider: string; model: string } | null = null;
    let normalizerModel: { provider: string; model: string } | null = null;
    try {
      const dc = getDreamerLlmConfig();
      dreamerModel = {
        provider: config.llm.provider,
        model: dc.model,
      };
    } catch {
      /* LLM not configured */
    }
    try {
      const nc = getNormalizerLlmConfig();
      normalizerModel = {
        provider: config.llm.provider,
        model: nc.model,
      };
    } catch {
      /* LLM not configured */
    }

    json(res, 200, {
      uuid: scope?.uuid ?? config.instance.uuid ?? "legacy",
      name: scope ? scope.name ?? scope.uuid.slice(0, 8) : "legacy",
      project_root: scope?.projectRoot ?? null,
      mode: isInstanceMode() ? "instance" : "legacy",
      policy_profile: "balanced",
      version: config.server.version,
      transport: { type: "http", port: undefined },
      daemon: {
        pid: process.pid,
        uptime_seconds: Math.round(process.uptime()),
        total_dream_cycles: status.total_dream_cycles,
        total_tool_calls: getToolCallCount(),
      },
      cognitive: {
        state: status.current_state,
        active_tensions: status.tension_stats.total - (status.tension_stats.total - status.tension_stats.unresolved),
        validated_edges: status.validated_stats.validated,
        last_dream_cycle: status.last_dream_cycle,
      },
      models: {
        dreamer: dreamerModel,
        normalizer: normalizerModel,
      },
    });
  } catch (err) {
    logger.error("GET /api/instance error:", err);
    jsonError(res, 500, "internal_error", "Failed to retrieve instance info");
  }
}

// ─── POST /api/graph-context ────────────────────────────────────────────────

/**
 * Given a file path or feature set, return relevant graph-side enrichment
 * (features, workflows, ADRs, UI elements, API surface, tensions) in one call.
 *
 * This is NOT an editor-context service. The daemon has no knowledge of
 * editor state. It returns graph facts only.
 *
 * @see TDD §8.1 — GraphContextRequest / GraphContextResponse
 */
interface GraphContextRequest {
  file_path?: string;
  feature_ids?: string[];
  include_adrs?: boolean;
  include_ui?: boolean;
  include_api_surface?: boolean;
  include_tensions?: boolean;
}

async function handlePostGraphContext(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await parseJsonBody<GraphContextRequest>(req);
    const filePath = body.file_path ?? null;
    const featureIds = body.feature_ids ?? [];
    const includeAdrs = body.include_adrs ?? true;
    const includeUi = body.include_ui ?? true;
    const includeApiSurface = body.include_api_surface ?? true;
    const includeTensions = body.include_tensions ?? true;

    // Load all data sources in parallel
    const [features, workflows, adrLog, uiRegistry, tensionFile, apiSurface, cogStatus] =
      await Promise.all([
        loadJsonArray<Feature>("features.json"),
        loadJsonArray<Workflow>("workflows.json"),
        includeAdrs
          ? loadOrEmpty(
              () => loadJsonValidated("adr_log.json", AdrLogFileSchema) as Promise<ADRLogFile>,
              EMPTY_ADR_LOG,
              "adr_log.json",
            )
          : Promise.resolve(EMPTY_ADR_LOG),
        includeUi
          ? loadOrEmpty(
              () => loadJsonValidated("ui_registry.json", UiRegistryFileSchema) as Promise<UIRegistryFile>,
              EMPTY_UI_REGISTRY,
              "ui_registry.json",
            )
          : Promise.resolve(EMPTY_UI_REGISTRY),
        includeTensions
          ? engine.loadTensions().catch(() => ({ signals: [], resolved_tensions: [] }))
          : Promise.resolve({ signals: [], resolved_tensions: [] }),
        includeApiSurface
          ? loadJsonData<ApiSurface>("api_surface.json").catch(() => null)
          : Promise.resolve(null),
        engine.getStatus(),
      ]);

    // Match features by file path or explicit IDs
    const matchedFeatures = features.filter((f) => {
      if (featureIds.length > 0 && featureIds.includes(f.id)) return true;
      if (filePath && f.source_files) {
        const files = Array.isArray(f.source_files) ? f.source_files : [];
        return files.some((sf: unknown) => {
          const path = typeof sf === "string" ? sf : (sf as Record<string, unknown>)?.path;
          return typeof path === "string" && path.includes(filePath);
        });
      }
      return featureIds.length === 0 && !filePath; // if no filters, return all
    });

    const featureIdSet = new Set(matchedFeatures.map((f) => f.id));

    // Match workflows linked to matched features
    const matchedWorkflows = workflows.filter((w) => {
      if (filePath && w.source_files) {
        const files = Array.isArray(w.source_files) ? w.source_files : [];
        if (
          files.some((sf: unknown) => {
            const path = typeof sf === "string" ? sf : (sf as Record<string, unknown>)?.path;
            return typeof path === "string" && path.includes(filePath);
          })
        ) {
          return true;
        }
      }
      // Check workflow links for feature references
      if (w.links) {
        const links = Array.isArray(w.links) ? w.links : [];
        return links.some((l: unknown) => {
          const to = typeof l === "string" ? l : (l as Record<string, unknown>)?.to;
          return typeof to === "string" && featureIdSet.has(to);
        });
      }
      return false;
    });

    // Match ADRs by affected entities
    const matchedAdrs = includeAdrs
      ? (adrLog.decisions as unknown as Array<Record<string, unknown>> ?? []).filter((adr) => {
          const ctx = adr.context as Record<string, unknown> | undefined;
          if (!ctx) return true; // include all if no context to filter by
          const affected = ctx.affected_entities as string[] | undefined;
          if (!affected) return true;
          return affected.some(
            (e) => featureIdSet.has(e) || (filePath && e.includes(filePath)),
          );
        })
      : [];

    // Match UI elements by source file
    const matchedUiElements = includeUi
      ? (uiRegistry.elements as unknown as Array<Record<string, unknown>> ?? []).filter(
          (el) => {
            if (!filePath) return true;
            const src = el.source_file as string | undefined;
            return src ? src.includes(filePath) : false;
          },
        )
      : [];

    // Match API symbols by file path
    const matchedApiSymbols: Array<Record<string, unknown>> = [];
    if (includeApiSurface && apiSurface) {
      const modules = (apiSurface as unknown as Record<string, unknown>).modules as Array<Record<string, unknown>> | undefined;
      if (modules) {
        for (const mod of modules) {
          const modFile = mod.file as string ?? "";
          if (!filePath || modFile.includes(filePath)) {
            // Extract classes + functions from this module
            const classes = (mod.classes as Array<Record<string, unknown>>) ?? [];
            for (const cls of classes) {
              const methods = (cls.methods as Array<Record<string, unknown>>) ?? [];
              for (const m of methods) {
                matchedApiSymbols.push({
                  name: `${cls.name}.${m.name}`,
                  kind: "method",
                  file: modFile,
                  signature: m.signature ?? `${m.name}()`,
                });
              }
            }
            const fns = (mod.free_functions as Array<Record<string, unknown>>) ?? [];
            for (const fn of fns) {
              matchedApiSymbols.push({
                name: fn.name,
                kind: "function",
                file: modFile,
                signature: fn.signature ?? `${fn.name}()`,
              });
            }
          }
        }
      }
    }

    // Match tensions by entity overlap
    const matchedTensions = includeTensions
      ? (tensionFile as Record<string, unknown>).signals
        ? ((tensionFile as Record<string, unknown>).signals as Array<Record<string, unknown>>).filter(
            (t) => {
              if (!t.resolved) {
                const entities = t.entities as string[] | undefined;
                if (!entities) return true;
                return entities.some(
                  (e) =>
                    featureIdSet.has(e) ||
                    (filePath && e.includes(filePath)),
                );
              }
              return false;
            },
          )
        : []
      : [];

    // ── Relevance scoring ──────────────────────────────────────────────────────
    // Score each matched entity so the extension can propagate real graph-distance
    // values instead of hardcoded constants. Scores are in [0, 1].
    //
    //  features:   direct feature_id hit → 1.0; file-path match → 0.85
    //  workflows:  linked to a matched feature → 0.8; file-path match → 0.75
    //  adrs:       accepted + all affected entities matched → 1.0;
    //              partial / status-other → 0.85
    //  ui_elements: source-file match → 0.85; no source info → 0.7
    //  tensions:   urgency already numeric (0–1) — use directly; missing → 0.75

    json(res, 200, {
      ok: true,
      file_path: filePath,
      features: matchedFeatures.map((f) => ({
        id: f.id,
        name: f.name,
        relevance: featureIds.includes(f.id) ? 1.0 : 0.85,
      })),
      workflows: matchedWorkflows.map((w) => {
        // Prefer file-path match over link-match — file match is more direct
        const isFilePath =
          filePath &&
          Array.isArray(w.source_files) &&
          (w.source_files as unknown[]).some((sf: unknown) => {
            const p = typeof sf === "string" ? sf : (sf as Record<string, unknown>)?.path;
            return typeof p === "string" && p.includes(filePath);
          });
        return {
          id: w.id,
          name: w.name,
          relevance: isFilePath ? 0.8 : 0.75,
        };
      }),
      adrs: matchedAdrs.map((a) => {
        const isAccepted =
          typeof a.status === "string" && a.status.toLowerCase() === "accepted";
        const affected = ((a.context as Record<string, unknown>)?.affected_entities as string[]) ?? [];
        const fullyMatched =
          affected.length > 0 && affected.every((e) => featureIdSet.has(e));
        return {
          id: a.id,
          title: a.title,
          status: a.status,
          summary: (a.decision as Record<string, unknown>)?.chosen ?? "",
          relevance: isAccepted && fullyMatched ? 1.0 : 0.85,
        };
      }),
      ui_elements: matchedUiElements.map((el) => ({
        id: el.id,
        element_type: el.element_type ?? el.type,
        name: el.name,
        relevance: el.source_file ? 0.85 : 0.7,
      })),
      api_symbols: matchedApiSymbols,
      tensions: matchedTensions.map((t) => {
        const urgency = typeof t.urgency === "number" ? t.urgency : 0.75;
        return {
          id: t.id,
          domain: t.domain,
          description: t.description,
          severity: t.severity,
          urgency,
          relevance: urgency, // urgency IS the relevance signal for tensions
        };
      }),
      cognitive_state: cogStatus.current_state,
    });
  } catch (err) {
    logger.error("POST /api/graph-context error:", err);
    if (err instanceof Error && err.message === "Invalid JSON body") {
      jsonError(res, 400, "invalid_json", "Request body is not valid JSON");
      return;
    }
    jsonError(res, 500, "internal_error", "Failed to assemble graph context");
  }
}

// ─── POST /api/validate ─────────────────────────────────────────────────────

/**
 * Validate a file against all applicable rules in one call
 * (ADRs, UI registry, API surface).
 *
 * @see TDD §8.1 — ValidateRequest / ValidateResponse
 */
interface ValidateRequest {
  file_path: string;
  content?: string;
  checks: ("adr" | "ui" | "api_surface" | "scope")[];
}

interface Violation {
  check: string;
  severity: "error" | "warning" | "info";
  line?: number;
  message: string;
  rule_id: string;
  suggestion?: string;
}

async function handlePostValidate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await parseJsonBody<ValidateRequest>(req);

    if (!body.file_path) {
      jsonError(res, 400, "missing_field", "file_path is required");
      return;
    }
    if (!body.checks || !Array.isArray(body.checks) || body.checks.length === 0) {
      jsonError(
        res,
        400,
        "missing_field",
        'checks array is required (e.g. ["adr", "ui", "api_surface"])',
      );
      return;
    }

    const violations: Violation[] = [];
    const passed: string[] = [];
    const filePath = body.file_path;

    // ── ADR check ──────────────────────────────────────────────────────
    if (body.checks.includes("adr")) {
      try {
        const adrLog = await loadJsonData<ADRLogFile>("adr_log.json");
        const decisions = (adrLog.decisions ?? []) as unknown as Array<Record<string, unknown>>;
        let adrViolations = 0;

        for (const adr of decisions) {
          if (adr.status !== "accepted") continue;
          const guardRails = adr.guard_rails as string[] | undefined;
          if (!guardRails) continue;

          // Check if this ADR's affected entities are relevant to the file
          const ctx = adr.context as Record<string, unknown> | undefined;
          const affected = ctx?.affected_entities as string[] | undefined;
          const isRelevant =
            !affected ||
            affected.some((e) => filePath.includes(e) || e.includes(filePath));

          if (isRelevant) {
            for (const rail of guardRails) {
              // Surface guard rails as informational hints 
              violations.push({
                check: "adr",
                severity: "info",
                message: `ADR ${adr.id}: ${rail}`,
                rule_id: adr.id as string,
                suggestion: `Review guard rail from "${adr.title}"`,
              });
              adrViolations++;
            }
          }
        }

        if (adrViolations === 0) passed.push("adr");
      } catch {
        passed.push("adr"); // no ADR log = nothing to violate
      }
    }

    // ── UI registry check ──────────────────────────────────────────────
    if (body.checks.includes("ui")) {
      try {
        const uiRegistry = await loadJsonData<UIRegistryFile>("ui_registry.json");
        const elements = (uiRegistry.elements ?? []) as unknown as Array<Record<string, unknown>>;
        let uiViolations = 0;

        // Check if file has registered UI elements
        const fileElements = elements.filter((el) => {
          const src = el.source_file as string | undefined;
          return src ? src.includes(filePath) : false;
        });

        if (fileElements.length > 0) {
          for (const el of fileElements) {
            // Report registered elements so the extension can verify they still exist
            violations.push({
              check: "ui",
              severity: "info",
              message: `UI element "${el.name}" (${el.element_type ?? el.type}) registered from this file`,
              rule_id: el.id as string,
              suggestion: "Verify this element still exists in the source",
            });
            uiViolations++;
          }
        }

        if (uiViolations === 0) passed.push("ui");
      } catch {
        passed.push("ui");
      }
    }

    // ── API surface check ──────────────────────────────────────────────
    if (body.checks.includes("api_surface")) {
      try {
        const apiSurface = await loadJsonData<ApiSurface>("api_surface.json");
          const modules = (apiSurface as unknown as Record<string, unknown>).modules as Array<Record<string, unknown>> | undefined;
        let apiViolations = 0;

        if (modules) {
          const fileModules = modules.filter((m) => {
            const f = m.file as string | undefined;
            return f ? f.includes(filePath) : false;
          });

          for (const mod of fileModules) {
            const classes = (mod.classes as Array<Record<string, unknown>>) ?? [];
            const fns = (mod.free_functions as Array<Record<string, unknown>>) ?? [];
            const symbolCount = classes.length + fns.length;
            if (symbolCount > 0) {
              violations.push({
                check: "api_surface",
                severity: "info",
                message: `${symbolCount} API symbols registered from this file (${classes.length} classes, ${fns.length} functions)`,
                rule_id: `api_surface:${mod.file}`,
                suggestion:
                  "Run extract_api_surface to refresh if exports have changed",
              });
              apiViolations++;
            }
          }
        }

        if (apiViolations === 0) passed.push("api_surface");
      } catch {
        passed.push("api_surface");
      }
    }

    // ── Scope check ────────────────────────────────────────────────────
    if (body.checks.includes("scope")) {
      const scope = getActiveScope();
      if (scope) {
        const projectRoot = scope.projectRoot;
        if (projectRoot && !filePath.startsWith(projectRoot) && !filePath.startsWith("/")) {
          violations.push({
            check: "scope",
            severity: "warning",
            message: `File path "${filePath}" appears to be outside the project root "${projectRoot}"`,
            rule_id: "scope:out_of_project",
            suggestion: "Use paths relative to the project root",
          });
        } else {
          passed.push("scope");
        }
      } else {
        passed.push("scope"); // no scope = no violation
      }
    }

    json(res, 200, {
      ok: violations.length === 0,
      violations,
      passed,
    });
  } catch (err) {
    logger.error("POST /api/validate error:", err);
    if (err instanceof Error && err.message === "Invalid JSON body") {
      jsonError(res, 400, "invalid_json", "Request body is not valid JSON");
      return;
    }
    jsonError(res, 500, "internal_error", "Failed to run validation");
  }
}

// ─── GET /api/orchestrate/capabilities ──────────────────────────────────────

/**
 * Capability negotiation stub.
 * v1: returns { available: false } so the extension falls back to
 * direct Architect calls.
 *
 * @see TDD §8.1 — OrchestrateCapabilities
 */
function handleGetOrchestrateCapabilities(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  json(res, 200, {
    available: false,
    version: "1.0",
    supported_overrides: [],
    models: [],
    max_history_messages: 0,
    max_context_tokens: 0,
  });
}

// ─── POST /api/orchestrate ──────────────────────────────────────────────────

/**
 * Daemon-side Architect stub.
 * v1: returns 501 Not Implemented with a structured error body.
 *
 * @see TDD §8.1 — OrchestrateRequest / OrchestrateResponse
 */
function handlePostOrchestrate(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  json(res, 501, {
    ok: false,
    error: "orchestrate_not_available",
    message:
      "Upgrade to v2 for daemon-side Architect. Use GET /api/orchestrate/capabilities to check availability.",
  });
}

// ─── Router ─────────────────────────────────────────────────────────────────

/**
 * Handle an API route request.
 * Returns `true` if the route was handled, `false` if it doesn't match
 * any /api/* pattern (caller should continue to other handlers).
 */
export async function handleApiRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  // Only handle /api/* routes
  if (!pathname.startsWith("/api/")) return false;

  const method = req.method ?? "GET";

  // GET /api/instance
  if (method === "GET" && pathname === "/api/instance") {
    await handleGetInstance(req, res);
    return true;
  }

  // POST /api/graph-context
  if (method === "POST" && pathname === "/api/graph-context") {
    await handlePostGraphContext(req, res);
    return true;
  }

  // POST /api/validate
  if (method === "POST" && pathname === "/api/validate") {
    await handlePostValidate(req, res);
    return true;
  }

  // GET /api/orchestrate/capabilities
  if (method === "GET" && pathname === "/api/orchestrate/capabilities") {
    handleGetOrchestrateCapabilities(req, res);
    return true;
  }

  // POST /api/orchestrate
  if (method === "POST" && pathname === "/api/orchestrate") {
    handlePostOrchestrate(req, res);
    return true;
  }

  // Unknown /api/* route
  jsonError(res, 404, "not_found", `Unknown API route: ${method} ${pathname}`);
  return true;
}
