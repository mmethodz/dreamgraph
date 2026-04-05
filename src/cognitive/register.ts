/**
 * DreamGraph Cognitive System — MCP registration.
 *
 * Registers cognitive resources and tools on the MCP server.
 *
 * Resources (READ-ONLY views into cognitive state):
 *   dream://graph      — Raw dream graph (nodes + edges)
 *   dream://candidates — Normalization judgments
 *   dream://validated  — Promoted edges
 *   dream://status     — Cognitive state introspection
 *   dream://tensions   — Unresolved tension signals
 *   dream://history    — Audit trail of dream cycles
 *   dream://adrs       — Architecture Decision Records
 *   dream://ui-registry— Semantic UI element registry
 *   dream://threats    — Adversarial scan results (threat log)
 *   dream://archetypes — Federated dream archetypes
 *
 * Tools (cognitive operations):
 *   dream_cycle               — Full dream → normalize → wake cycle
 *   normalize_dreams           — Manual normalization pass
 *   cognitive_status            — Read current state
 *   query_dreams                — Search dream/validated data
 *   clear_dreams                — Reset dream data (safety valve)
 *   get_dream_insights          — Introspection: strongest hypotheses, clusters, tensions
 *   resolve_tension             — Close a tension with authority
 *   nightmare_cycle             — Adversarial security scan (NIGHTMARE state)
 *   get_causal_insights         — Causal reasoning analysis
 *   get_temporal_insights       — Temporal pattern analysis
 *   export_dream_archetypes     — Federation: export anonymized patterns
 *   import_dream_archetypes     — Federation: import patterns
 *   get_system_narrative        — Dream narrative / system autobiography
 *   get_remediation_plan        — Intervention: concrete fix plans
 */

import { z } from "zod";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dataPath } from "../utils/paths.js";
import { engine } from "./engine.js";
import { dream } from "./dreamer.js";
import { normalize } from "./normalizer.js";
import { analyzeCausality } from "./causal.js";
import { analyzeTemporalPatterns } from "./temporal.js";
import { exportArchetypes, importArchetypes, getArchetypes } from "./federation.js";
import { nightmare, getThreatLog, clearThreatLog } from "./adversarial.js";
import { generateNarrative, maybeAutoNarrate, generateDiffChapter, appendToStory, getSystemStory, generateWeeklyDigest } from "./narrator.js";
import { runMetacognitiveAnalysis, getMetaLog } from "./metacognition.js";
import { dispatchEvent, checkTensionThresholds, getEventLog } from "./event-router.js";
import { generateRemediationPlans } from "./intervention.js";
import {
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  getSchedules,
  getScheduleHistory,
  getScheduleFile,
  notifyCycleComplete,
  recordActivity,
} from "./scheduler.js";
import { logger } from "../utils/logger.js";
import { success, error, safeExecute } from "../utils/errors.js";
import type {
  DreamCycleOutput,
  NormalizeDreamsOutput,
  CognitiveState,
  QueryDreamsOutput,
  ClearDreamsOutput,
  DreamInsights,
  DreamHistoryEntry,
  ToolResponse,
  CausalInsights,
  TemporalInsights,
  ExportArchetypesOutput,
  ImportArchetypesOutput,
  NightmareResult,
  SystemNarrative,
  RemediationPlanOutput,
  MetaLogEntry,
  EventLogEntry,
  SystemStoryFile,
  DreamSchedule,
  ScheduleExecution,
  ScheduleFile,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Resource Registration
// ---------------------------------------------------------------------------

export function registerCognitiveResources(server: McpServer): void {
  // dream://graph — Raw dream graph
  server.resource(
    "dream-graph",
    "dream://graph",
    {
      description:
        "Dream Graph — REM-generated speculative nodes and edges. UNTRUSTED until validated. Contains all raw dream output with decay/TTL metadata.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await engine.loadDreamGraph();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://candidates — Normalization results
  server.resource(
    "dream-candidates",
    "dream://candidates",
    {
      description:
        "Normalization results — three-outcome classification (validated/latent/rejected) for each dream artifact, with plausibility, evidence, and contradiction scores.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await engine.loadCandidateEdges();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://validated — Promoted edges
  server.resource(
    "dream-validated",
    "dream://validated",
    {
      description:
        "Validated edges — dream-originated connections that passed the three-outcome classifier and strict promotion gate (PromotionConfig thresholds). Trusted.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await engine.loadValidatedEdges();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://status — Cognitive state
  server.resource(
    "dream-status",
    "dream://status",
    {
      description:
        "Cognitive system status — current state, cycle counts, dream graph stats (including decay/expiry info), validation metrics, tension stats, promotion gate config.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await engine.getStatus();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://tensions — Unresolved tension signals
  server.resource(
    "dream-tensions",
    "dream://tensions",
    {
      description:
        "Tension Log — unresolved signals that direct goal-oriented dreaming. Each tension tracks what the system struggles with and its urgency.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await engine.loadTensions();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://history — Audit trail
  server.resource(
    "dream-history",
    "dream://history",
    {
      description:
        "Dream History — audit trail of every cognitive cycle with generation, decay, deduplication, normalization, and tension statistics.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await engine.loadDreamHistory();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://adrs — Architecture Decision Records
  server.resource(
    "dream-adrs",
    "dream://adrs",
    {
      description:
        "Architecture Decision Records — append-only log of architectural decisions with context, alternatives, consequences, and guard rails.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadADRLogForResource();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://ui-registry — Semantic UI elements
  server.resource(
    "dream-ui-registry",
    "dream://ui-registry",
    {
      description:
        "Semantic UI Registry — platform-independent element definitions with purpose, data contracts, interaction models, and cross-platform implementation tracking.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadUIRegistryForResource();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://threats — Adversarial scan results (threat log)
  server.resource(
    "dream-threats",
    "dream://threats",
    {
      description:
        "Threat Log — adversarial scan results from NIGHTMARE state. Contains identified security threats, attack surfaces, and severity assessments.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadThreatLogForResource();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://archetypes — Federated dream archetypes
  server.resource(
    "dream-archetypes",
    "dream://archetypes",
    {
      description:
        "Dream Archetypes — anonymized, transferable patterns extracted from validated edges. Used for multi-system dream federation.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await getArchetypes();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // v5.1 Resources
  // -------------------------------------------------------------------------

  // dream://metacognition — Metacognitive analysis log
  server.resource(
    "dream-metacognition",
    "dream://metacognition",
    {
      description:
        "Metacognitive Analysis Log — self-tuning audit trail. Contains per-strategy performance metrics, promotion calibration buckets, threshold recommendations, and domain decay profiles.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await getMetaLog();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://events — Cognitive event log
  server.resource(
    "dream-events",
    "dream://events",
    {
      description:
        "Cognitive Event Log — audit trail of dispatched events (git webhooks, CI/CD signals, runtime anomalies, tension thresholds, manual triggers) and their cognitive responses.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await getEventLog();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://story — Persistent system autobiography
  server.resource(
    "dream-story",
    "dream://story",
    {
      description:
        "System Autobiography — persistent, auto-accumulated narrative of DreamGraph's evolving understanding. Contains diff chapters, weekly digests, and health trends.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await getSystemStory();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // v5.2 Resources
  // -------------------------------------------------------------------------

  // dream://schedules — Dream schedule registry
  server.resource(
    "dream-schedules",
    "dream://schedules",
    {
      description:
        "Dream Schedules — persistent schedule registry for policy-driven temporal orchestration of cognitive actions. Contains all active, paused, and exhausted schedules.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await getSchedules();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // dream://schedule-history — Schedule execution log
  server.resource(
    "dream-schedule-history",
    "dream://schedule-history",
    {
      description:
        "Schedule Execution History — audit trail of all scheduled action executions with timing, success/failure status, and result summaries.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await getScheduleHistory();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 15 cognitive resources");
}

// ---------------------------------------------------------------------------
// Helpers — load ADR / UI registry files for resources
// ---------------------------------------------------------------------------

async function loadADRLogForResource(): Promise<unknown> {
  const p = dataPath("adr_log.json");
  if (!existsSync(p)) return { metadata: { total_decisions: 0 }, decisions: [] };
  return JSON.parse(await readFile(p, "utf-8"));
}

async function loadUIRegistryForResource(): Promise<unknown> {
  const p = dataPath("ui_registry.json");
  if (!existsSync(p)) return { metadata: { total_elements: 0 }, elements: [] };
  return JSON.parse(await readFile(p, "utf-8"));
}

async function loadThreatLogForResource(): Promise<unknown> {
  const p = dataPath("threat_log.json");
  if (!existsSync(p)) return { metadata: { total_threats: 0 }, threats: [] };
  return JSON.parse(await readFile(p, "utf-8"));
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerCognitiveTools(server: McpServer): void {
  // =========================================================================
  // dream_cycle — Full AWAKE → REM → NORMALIZING → AWAKE cycle
  // =========================================================================
  server.tool(
    "dream_cycle",
    "Trigger a full cognitive dream cycle: AWAKE → REM (decay existing dreams, generate speculative connections with duplicate suppression) → NORMALIZING (three-outcome classifier: validated/latent/rejected with split scoring and promotion gate) → AWAKE. Latent edges remain as speculative memory. Records full history. Supports tension-directed dreaming.",
    {
      strategy: z
        .enum([
          "gap_detection",
          "weak_reinforcement",
          "cross_domain",
          "missing_abstraction",
          "symmetry_completion",
          "tension_directed",
          "causal_replay",
          "reflective",
          "all",
        ])
        .optional()
        .describe(
          'Dream strategy. "gap_detection": find unconnected related entities. "weak_reinforcement": strengthen weak edges. "cross_domain": bridge different domains. "missing_abstraction": propose unifying features. "symmetry_completion": add reverse edges. "tension_directed": focus on unresolved tensions. "causal_replay": mine history for cause→effect chains. "reflective": agent-directed insights from code reading. "all": run all strategies. Default: "all".'
        ),
      max_dreams: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum number of dream items to generate (default: 20)."),
      auto_normalize: z
        .boolean()
        .optional()
        .describe(
          "Whether to automatically run normalization after dreaming (default: true)."
        ),
    },
    async ({ strategy, max_dreams, auto_normalize }) => {
      recordActivity(); // v5.2 — track activity for idle triggers
      const startTime = Date.now();
      const strat = strategy ?? "all";
      const maxD = max_dreams ?? 20;
      const autoNorm = auto_normalize ?? true;

      logger.info(
        `dream_cycle tool called: strategy=${strat}, max=${maxD}, auto_normalize=${autoNorm}`
      );

      const result = await safeExecute<DreamCycleOutput>(
        async (): Promise<ToolResponse<DreamCycleOutput>> => {
          const transitions: string[] = [];

          // Ensure we're awake before starting
          if (engine.getState() !== "awake") {
            await engine.interrupt();
            transitions.push("interrupted → awake");
          }

          // AWAKE → REM
          engine.enterRem();
          transitions.push("awake → rem");

          // Step 1: Apply decay to existing dreams
          const decayResult = await engine.applyDecay();

          // Step 1b: Apply tension decay (urgency fades, TTL decrements)
          const tensionDecayResult = await engine.applyTensionDecay();

          // Step 2: Dream (with duplicate suppression built-in)
          const dreamResult = await dream(strat, maxD);

          let normResult = undefined;
          let promoted = 0;
          let blockedByGate = 0;
          let tensionsCreated = 0;
          let tensionsResolved = 0;

          if (autoNorm) {
            // REM → NORMALIZING
            engine.enterNormalizing();
            transitions.push("rem → normalizing");

            const normalization = await normalize();
            normResult = {
              validated: normalization.validated,
              latent: normalization.latent,
              rejected: normalization.rejected,
              blocked_by_gate: normalization.blockedByGate,
            };
            promoted = normalization.promotedEdges.length;
            blockedByGate = normalization.blockedByGate;

            // Create tension signals for rejected edges that had potential
            // BUG FIX: use actual entity IDs (from/to), not dream_id
            const dreamGraph = await engine.loadDreamGraph();
            const dreamEdgeMap = new Map(
              dreamGraph.edges.map((e) => [e.id, e])
            );

            for (const result of await (async () => {
              const candidates = await engine.loadCandidateEdges();
              return candidates.results.filter(
                (r) =>
                  r.normalization_cycle === normalization.cycle &&
                  r.status === "rejected" &&
                  r.confidence >= 0.3
              );
            })()) {
              const dreamEdge = dreamEdgeMap.get(result.dream_id);
              const entities = dreamEdge
                ? [dreamEdge.from, dreamEdge.to]
                : [result.dream_id];

              await engine.recordTension({
                type: "weak_connection",
                entities,
                description: `Dream "${result.dream_id}" rejected with confidence ${result.confidence}: ${result.reason}`,
                urgency: result.confidence,
              });
              tensionsCreated++;
            }

            // RESOLVE tensions when promoted edges address them
            if (normalization.promotedEdges.length > 0) {
              const unresolvedTensions = await engine.getUnresolvedTensions();
              for (const promoted of normalization.promotedEdges) {
                for (const tension of unresolvedTensions) {
                  if (tension.resolved) continue;
                  const addresses = tension.entities.some(
                    (e) => e === promoted.from || e === promoted.to
                  );
                  if (addresses) {
                    await engine.resolveTension(
                      tension.id,
                      "system",
                      "confirmed_fixed",
                      "Addressed by promoted edge " + promoted.from + " -> " + promoted.to
                    );
                    tension.resolved = true;
                    tensionsResolved++;
                    logger.info(
                      "Tension resolved: '" + tension.id + "' addressed by promoted edge " + promoted.from + " -> " + promoted.to
                    );
                  }
                }
              }
            }

            // NORMALIZING → AWAKE
            engine.wake();
            transitions.push("normalizing → awake");
          } else {
            // Skip normalization, go back to awake via interrupt
            await engine.interrupt();
            transitions.push("rem → awake (no normalization)");
          }

          const duration = Date.now() - startTime;

          // Record history entry
          const historyEntry: DreamHistoryEntry = {
            session_id: `session_${Date.now()}`,
            cycle_number: engine.getCurrentDreamCycle(),
            timestamp: new Date().toISOString(),
            strategy: strat,
            duration_ms: duration,
            generated_edges: dreamResult.edges.length,
            generated_nodes: dreamResult.nodes.length,
            duplicates_merged: dreamResult.duplicates_merged,
            decayed_edges: decayResult.decayedEdges,
            decayed_nodes: decayResult.decayedNodes,
            normalization: normResult
              ? {
                  validated: normResult.validated,
                  latent: normResult.latent,
                  rejected: normResult.rejected,
                  promoted,
                  blocked_by_gate: blockedByGate,
                }
              : undefined,
            tension_signals_created: tensionsCreated,
            tension_signals_resolved: tensionsResolved,
            tensions_expired: tensionDecayResult.expired,
            tensions_decayed: tensionDecayResult.decayed,
          };
          await engine.appendHistoryEntry(historyEntry);

          // v5.1 post-cycle hooks (fire-and-forget, errors logged but not propagated)
          try {
            await maybeAutoNarrate();
          } catch (e) {
            logger.warn(`Post-cycle narrator hook failed: ${e}`);
          }
          try {
            await checkTensionThresholds();
          } catch (e) {
            logger.warn(`Post-cycle tension threshold check failed: ${e}`);
          }
          // v5.2 — notify scheduler of cycle completion
          try {
            await notifyCycleComplete(engine.getCurrentDreamCycle());
          } catch (e) {
            logger.warn(`Post-cycle scheduler hook failed: ${e}`);
          }

          return success<DreamCycleOutput>({
            cycle_number: engine.getCurrentDreamCycle(),
            state_transitions: transitions,
            dreams_generated: {
              nodes: dreamResult.nodes.length,
              edges: dreamResult.edges.length,
            },
            duplicates_merged: dreamResult.duplicates_merged,
            decayed: {
              nodes: decayResult.decayedNodes,
              edges: decayResult.decayedEdges,
            },
            normalization: normResult,
            promoted_edges: promoted,
            tensions_created: tensionsCreated,
            tensions_resolved: tensionsResolved,
            tensions_expired: tensionDecayResult.expired,
            tensions_decayed: tensionDecayResult.decayed,
            duration_ms: duration,
          });
        }
      );

      // Safety: ensure we're awake after any error
      if (engine.getState() !== "awake") {
        await engine.interrupt();
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // normalize_dreams — Manual normalization pass
  // =========================================================================
  server.tool(
    "normalize_dreams",
    "Manually run normalization on existing dream graph contents. Three-outcome classifier: validated (promote), latent (speculative memory — keep for future evidence), rejected (discard). Latent edges never leak into default MCP queries.",
    {
      threshold: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe(
          "Minimum confidence score to validate an edge (default: 0.75 from PromotionConfig). Lower values allow more into validated status."
        ),
      strict: z
        .boolean()
        .optional()
        .describe(
          "If true, reject latent items too (only keep validated — no speculative memory). Default: false."
        ),
    },
    async ({ threshold, strict }) => {
      logger.info(
        `normalize_dreams tool called: threshold=${threshold ?? 0.7}, strict=${strict ?? false}`
      );

      const result = await safeExecute<NormalizeDreamsOutput>(
        async (): Promise<ToolResponse<NormalizeDreamsOutput>> => {
          // Must transition through states properly
          if (engine.getState() !== "awake") {
            await engine.interrupt();
          }

          // AWAKE → REM → NORMALIZING (fast pass through REM)
          engine.enterRem();
          engine.enterNormalizing();

          const normResult = await normalize(threshold ?? 0.7, strict ?? false);

          // NORMALIZING → AWAKE
          engine.wake();

          return success<NormalizeDreamsOutput>({
            cycle_number: normResult.cycle,
            processed: normResult.processed,
            validated: normResult.validated,
            latent: normResult.latent,
            rejected: normResult.rejected,
            blocked_by_gate: normResult.blockedByGate,
            promoted_edges: normResult.promotedEdges,
          });
        }
      );

      if (engine.getState() !== "awake") {
        await engine.interrupt();
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // cognitive_status — Introspection
  // =========================================================================
  server.tool(
    "cognitive_status",
    "Get current cognitive system status: current state, total cycles, dream graph statistics (including decay/expiry info), validation metrics, tension stats, and promotion gate configuration.",
    {},
    async () => {
      logger.debug("cognitive_status tool called");

      const result = await safeExecute<CognitiveState>(
        async (): Promise<ToolResponse<CognitiveState>> => {
          const status = await engine.getStatus();
          return success(status);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // query_dreams — Search dream data
  // =========================================================================
  server.tool(
    "query_dreams",
    "Search and filter dream graph data. Query dream nodes, edges, and validated edges by type, domain, minimum confidence, or validation status. Use this to explore what the system has dreamed and what passed validation.",
    {
      type: z
        .enum(["node", "edge", "all"])
        .optional()
        .describe('Filter by artifact type: "node", "edge", or "all" (default: "all").'),
      domain: z
        .string()
        .optional()
        .describe("Filter dream edges by domain (matches against dream metadata or entity domains)."),
      min_confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum confidence threshold for returned items (default: 0)."),
      status: z
        .enum(["candidate", "latent", "validated", "rejected", "expired", "raw"])
        .optional()
        .describe(
          'Filter by lifecycle status: "candidate" (unevaluated), "latent" (speculative memory), "validated" (proven), "rejected" (discarded), "expired" (decayed), or "raw" (unvalidated). Default: return all.'
        ),
    },
    async ({ type, domain, min_confidence, status }) => {
      logger.debug(
        `query_dreams tool called: type=${type}, domain=${domain}, min_confidence=${min_confidence}, status=${status}`
      );

      const result = await safeExecute<QueryDreamsOutput>(
        async (): Promise<ToolResponse<QueryDreamsOutput>> => {
          const [dreamGraph, candidates, validated] = await Promise.all([
            engine.loadDreamGraph(),
            engine.loadCandidateEdges(),
            engine.loadValidatedEdges(),
          ]);

          const validatedIds = new Set(candidates.results.map((r) => r.dream_id));

          // Filter nodes
          let nodes = type === "edge" ? [] : dreamGraph.nodes;
          let edges = type === "node" ? [] : dreamGraph.edges;
          let validatedEdges = validated.edges;

          // Apply confidence filter
          if (min_confidence !== undefined) {
            nodes = nodes.filter((n) => n.confidence >= min_confidence);
            edges = edges.filter((e) => e.confidence >= min_confidence);
            validatedEdges = validatedEdges.filter(
              (e) => e.confidence >= min_confidence
            );
          }

          // Apply status filter
          if (status) {
            if (status === "raw") {
              // Only unvalidated items (no normalization judgment yet)
              nodes = nodes.filter((n) => !validatedIds.has(n.id));
              edges = edges.filter((e) => !validatedIds.has(e.id));
              validatedEdges = [];
            } else if (status === "validated") {
              // Dream graph items with validated status + promoted edges
              nodes = nodes.filter((n) => n.status === "validated");
              edges = edges.filter((e) => e.status === "validated");
            } else {
              // Filter by lifecycle status on dream graph items
              nodes = nodes.filter((n) => n.status === status);
              edges = edges.filter((e) => e.status === status);
              validatedEdges = [];
            }
          }

          // Apply domain filter on edges via metadata
          if (domain) {
            edges = edges.filter((e) => {
              const meta = e.meta as Record<string, unknown> | undefined;
              if (!meta) return false;
              return (
                meta.domain_a === domain ||
                meta.domain_b === domain ||
                (Array.isArray(meta.shared_keywords) &&
                  meta.shared_keywords.includes(domain))
              );
            });
          }

          return success<QueryDreamsOutput>({
            nodes,
            edges,
            validated: validatedEdges,
          });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // clear_dreams — Safety valve
  // =========================================================================
  server.tool(
    "clear_dreams",
    "Reset dream data files. Use this to clear dream graph, candidate edges, validated edges, tensions, history, or all cognitive data. Requires explicit confirmation.",
    {
      target: z
        .enum(["dream_graph", "candidates", "validated", "tensions", "history", "all"])
        .describe(
          'What to clear: "dream_graph", "candidates", "validated", "tensions", "history", or "all".'
        ),
      confirm: z
        .boolean()
        .describe("Must be true to proceed. Safety gate to prevent accidental data loss."),
    },
    async ({ target, confirm }) => {
      logger.info(`clear_dreams tool called: target=${target}, confirm=${confirm}`);

      const result = await safeExecute<ClearDreamsOutput>(
        async (): Promise<ToolResponse<ClearDreamsOutput>> => {
          if (!confirm) {
            return error(
              "CONFIRMATION_REQUIRED",
              'Set confirm: true to proceed with clearing dream data.'
            );
          }

          const cleared: string[] = [];

          if (target === "dream_graph" || target === "all") {
            await engine.clearDreamGraph();
            cleared.push("dream_graph.json");
          }
          if (target === "candidates" || target === "all") {
            await engine.clearCandidateEdges();
            cleared.push("candidate_edges.json");
          }
          if (target === "validated" || target === "all") {
            await engine.clearValidatedEdges();
            cleared.push("validated_edges.json");
          }
          if (target === "tensions" || target === "all") {
            await engine.clearTensions();
            cleared.push("tension_log.json");
          }
          if (target === "history" || target === "all") {
            await engine.clearHistory();
            cleared.push("dream_history.json");
          }

          return success<ClearDreamsOutput>({
            cleared,
            timestamp: new Date().toISOString(),
          });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // get_dream_insights — Introspection tool
  // =========================================================================
  server.tool(
    "get_dream_insights",
    "Analyze the cognitive system's dream state: strongest hypotheses (confidence × reinforcement), entity clusters, expiring dreams, active tensions, and an overall health assessment. Use this to understand what the system is learning and where it's struggling.",
    {
      top_n: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Number of top hypotheses to return (default: 10)."),
    },
    async ({ top_n }) => {
      const n = top_n ?? 10;
      logger.debug(`get_dream_insights tool called: top_n=${n}`);

      const result = await safeExecute<DreamInsights>(
        async (): Promise<ToolResponse<DreamInsights>> => {
          const [dreamGraph, validated, tensions] = await Promise.all([
            engine.loadDreamGraph(),
            engine.loadValidatedEdges(),
            engine.loadTensions(),
          ]);

          const edges = dreamGraph.edges;
          const nodes = dreamGraph.nodes;

          // Recent edges (from latest cycle)
          const maxCycle = edges.length > 0
            ? Math.max(...edges.map((e) => e.dream_cycle))
            : 0;
          const recentEdges = edges
            .filter((e) => e.dream_cycle === maxCycle)
            .slice(0, n);

          // Strongest hypotheses: score = confidence × (1 + reinforcement_count * 0.5)
          const scoredEdges = edges.map((e) => ({
            edge: e,
            score: Math.round(
              e.confidence * (1 + (e.reinforcement_count ?? 0) * 0.5) * 100
            ) / 100,
            reinforcement_count: e.reinforcement_count ?? 0,
          }));
          scoredEdges.sort((a, b) => b.score - a.score);
          const strongestHypotheses = scoredEdges.slice(0, n);

          // Clusters: group edges by entity participation
          const entityEdgeCount = new Map<string, string[]>();
          for (const edge of edges) {
            for (const entityId of [edge.from, edge.to]) {
              const list = entityEdgeCount.get(entityId) ?? [];
              list.push(edge.id);
              entityEdgeCount.set(entityId, list);
            }
          }

          // Find entities that appear in many edges (cluster centers)
          const clusterCenters = [...entityEdgeCount.entries()]
            .filter(([, edgeIds]) => edgeIds.length >= 2)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, 5);

          const clusters = clusterCenters.map(([center, edgeIds]) => {
            const memberSet = new Set<string>();
            let totalConf = 0;
            let totalReinf = 0;
            for (const edgeId of edgeIds) {
              const edge = edges.find((e) => e.id === edgeId);
              if (edge) {
                memberSet.add(edge.from);
                memberSet.add(edge.to);
                totalConf += edge.confidence;
                totalReinf += edge.reinforcement_count ?? 0;
              }
            }
            return {
              center,
              members: [...memberSet],
              avg_confidence: edgeIds.length > 0
                ? Math.round((totalConf / edgeIds.length) * 100) / 100
                : 0,
              total_reinforcement: totalReinf,
            };
          });

          // Expiring soon: TTL <= 1
          const expiringSoon = edges
            .filter((e) => (e.ttl ?? 3) <= 1)
            .sort((a, b) => a.confidence - b.confidence)
            .slice(0, n);

          // Active tensions
          const activeTensions = tensions.signals
            .filter((s) => !s.resolved)
            .sort((a, b) => b.urgency - a.urgency)
            .slice(0, n);

          // Health assessment
          const totalDreams = edges.length + nodes.length;
          const totalValidated = validated.edges.length;
          const totalLatent = edges.filter((e) => e.status === "latent").length +
            nodes.filter((n) => n.status === "latent").length;
          const totalTensions = tensions.signals.filter((s) => !s.resolved).length;

          let dreamHealth: DreamInsights["summary"]["dream_health"];
          let recommendation: string;

          if (totalDreams === 0) {
            dreamHealth = "empty";
            recommendation = "Run dream_cycle to start generating speculative connections.";
          } else if (expiringSoon.length > edges.length * 0.5) {
            dreamHealth = "stale";
            recommendation = "Many dreams are expiring. Run dream_cycle to refresh with new ideas, or reinforcement will be lost.";
          } else if (edges.length > 200) {
            dreamHealth = "overloaded";
            recommendation = "Too many dream edges. Run normalize_dreams to validate, or clear_dreams to prune.";
          } else {
            dreamHealth = "healthy";
            recommendation = totalTensions > 0
              ? `${totalTensions} unresolved tensions. Consider running dream_cycle with strategy="tension_directed".`
              : "System is healthy. Continue with dream_cycle to explore more connections.";
          }

          return success<DreamInsights>({
            recent_edges: recentEdges,
            strongest_hypotheses: strongestHypotheses,
            clusters,
            active_tensions: activeTensions,
            expiring_soon: expiringSoon,
            summary: {
              total_dreams: totalDreams,
              total_validated: totalValidated,
              total_latent: totalLatent,
              total_tensions: totalTensions,
              dream_health: dreamHealth,
              recommendation,
            },
          });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
  // =========================================================================
  // resolve_tension — Human/system authority to close tensions
  // =========================================================================
  server.tool(
    "resolve_tension",
    "Resolve a tension signal with explicit authority and reason. " +
      "Use this when you have external evidence (e.g. from git blame, " +
      "DB schema query, or human confirmation) that a tension is no longer valid. " +
      "Resolved tensions are archived (not deleted) for institutional memory. " +
      "Supports: confirmed_fixed, false_positive, wont_fix.",
    {
      tension_id: z
        .string()
        .describe("The ID of the tension to resolve (e.g. 'tension_1234567890_42')."),
      resolved_by: z
        .enum(["human", "system"])
        .describe(
          "Who is resolving this: 'human' (external validation from user or git/db evidence) " +
          "or 'system' (auto-resolved by the cognitive engine)."
        ),
      resolution_type: z
        .enum(["confirmed_fixed", "false_positive", "wont_fix"])
        .describe(
          "Why: 'confirmed_fixed' = verified the issue is resolved, " +
          "'false_positive' = not a real problem, " +
          "'wont_fix' = acknowledged but intentionally left as-is."
        ),
      evidence: z
        .string()
        .optional()
        .describe(
          "Optional evidence or explanation. E.g. 'git blame shows this was intentional in commit abc123' " +
          "or 'DB schema query confirms CHECK constraint exists in production'."
        ),
      recheck_ttl: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe(
          "Optional re-check window in cycles. If set, the tension can be " +
          "reactivated if new contradictory evidence appears within this window."
        ),
    },
    async ({ tension_id, resolved_by, resolution_type, evidence, recheck_ttl }) => {
      logger.info(
        "resolve_tension tool called: id=" + tension_id +
        ", by=" + resolved_by +
        ", type=" + resolution_type
      );

      const result = await safeExecute<{ resolved: boolean; tension_id: string; resolution_type: string }>(async () => {
        const resolved = await engine.resolveTension(
          tension_id,
          resolved_by,
          resolution_type,
          evidence,
          recheck_ttl
        );

        if (!resolved) {
          return error(
            "NOT_FOUND",
            "Tension '" + tension_id + "' not found in active tensions."
          );
        }

        return success({
          resolved: true,
          tension_id,
          resolution_type,
        });
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // nightmare_cycle — Adversarial dream scan (AWAKE → NIGHTMARE → AWAKE)
  // =========================================================================
  server.tool(
    "nightmare_cycle",
    "Run an adversarial dream scan: AWAKE → NIGHTMARE → AWAKE. " +
      "Scans the fact graph for security vulnerabilities and anti-patterns. " +
      "Produces threat edges with severity, CWE IDs, and blast radius. " +
      "Results are persisted to the threat log.",
    {
      strategy: z
        .enum([
          "privilege_escalation",
          "data_leak_path",
          "injection_surface",
          "missing_validation",
          "broken_access_control",
          "all",
        ])
        .optional()
        .describe(
          'Adversarial strategy. "all" runs all five. Default: "all".'
        ),
    },
    async ({ strategy }) => {
      const strat = strategy ?? "all";
      logger.info(`nightmare_cycle tool called: strategy=${strat}`);

      const result = await safeExecute<NightmareResult>(
        async (): Promise<ToolResponse<NightmareResult>> => {
          // Ensure awake
          if (engine.getState() !== "awake") {
            await engine.interrupt();
          }

          // AWAKE → NIGHTMARE
          engine.enterNightmare();

          const nightmareResult = await nightmare(strat as any);

          // NIGHTMARE → AWAKE
          engine.wakeFromNightmare();

          return success(nightmareResult);
        }
      );

      // Safety: ensure awake
      if (engine.getState() !== "awake") {
        await engine.interrupt();
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // get_causal_insights — Causal reasoning analysis
  // =========================================================================
  server.tool(
    "get_causal_insights",
    "Analyze dream history for causal inference chains. Discovers cause→effect relationships " +
      "between entities, builds propagation chains, and identifies hotspots where changes cascade.",
    {},
    async () => {
      logger.debug("get_causal_insights tool called");

      const result = await safeExecute<CausalInsights>(
        async (): Promise<ToolResponse<CausalInsights>> => {
          const insights = await analyzeCausality();
          return success(insights);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // get_temporal_insights — Temporal dreaming analysis
  // =========================================================================
  server.tool(
    "get_temporal_insights",
    "Analyze temporal patterns in dream history: tension trajectories (rising/falling/spike), " +
      "future predictions (precognition), seasonal patterns, and retrocognitive matches " +
      "(past patterns recurring in new contexts).",
    {},
    async () => {
      logger.debug("get_temporal_insights tool called");

      const result = await safeExecute<TemporalInsights>(
        async (): Promise<ToolResponse<TemporalInsights>> => {
          const insights = await analyzeTemporalPatterns();
          return success(insights);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // export_dream_archetypes — Federation: export anonymized patterns
  // =========================================================================
  server.tool(
    "export_dream_archetypes",
    "Extract anonymized architectural patterns (archetypes) from validated edges " +
      "for sharing across DreamGraph instances. Patterns are abstracted beyond " +
      "system-specific names to enable cross-project learning.",
    {},
    async () => {
      logger.debug("export_dream_archetypes tool called");

      const result = await safeExecute<ExportArchetypesOutput>(
        async (): Promise<ToolResponse<ExportArchetypesOutput>> => {
          const output = await exportArchetypes();
          return success(output);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // import_dream_archetypes — Federation: import patterns from another instance
  // =========================================================================
  server.tool(
    "import_dream_archetypes",
    "Import dream archetypes from another DreamGraph instance. " +
      "Archetypes are deduped and merged into the local archetype store. " +
      "Imported patterns can inform future dream cycles.",
    {
      file_path: z
        .string()
        .describe("Path to the archetype exchange file (JSON) exported by another instance."),
    },
    async ({ file_path }) => {
      logger.info(`import_dream_archetypes tool called: path=${file_path}`);

      const result = await safeExecute<ImportArchetypesOutput>(
        async (): Promise<ToolResponse<ImportArchetypesOutput>> => {
          const output = await importArchetypes(file_path);
          return success(output);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // get_system_narrative — Dream narratives / system autobiography
  // =========================================================================
  server.tool(
    "get_system_narrative",
    "Generate a coherent narrative of the system's evolving understanding. " +
      "Not a log — a STORY of how discoveries developed, tensions formed, " +
      "and understanding deepened across dream cycles. Three depth levels available.",
    {
      depth: z
        .enum(["executive", "technical", "full"])
        .optional()
        .describe(
          '"executive": 1-page summary for stakeholders. ' +
          '"technical": detailed findings with entity references. ' +
          '"full": complete cycle-by-cycle narrative. Default: "technical".'
        ),
    },
    async ({ depth }) => {
      const d = depth ?? "technical";
      logger.info(`get_system_narrative tool called: depth=${d}`);

      const result = await safeExecute<SystemNarrative>(
        async (): Promise<ToolResponse<SystemNarrative>> => {
          const narrative = await generateNarrative(d);
          return success(narrative);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // get_remediation_plan — Intervention engine: insight → action
  // =========================================================================
  server.tool(
    "get_remediation_plan",
    "Generate concrete remediation plans from high-urgency unresolved tensions. " +
      "Each plan contains ordered steps, file-level change descriptions, " +
      "test suggestions, effort estimates, ADR conflict checks, and predicted new tensions.",
    {
      max_plans: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe("Maximum number of plans to generate (default: 5)."),
      min_urgency: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum tension urgency threshold (default: 0.3)."),
    },
    async ({ max_plans, min_urgency }) => {
      const maxP = max_plans ?? 5;
      const minU = min_urgency ?? 0.3;
      logger.info(`get_remediation_plan tool called: max=${maxP}, minUrgency=${minU}`);

      const result = await safeExecute<RemediationPlanOutput>(
        async (): Promise<ToolResponse<RemediationPlanOutput>> => {
          const output = await generateRemediationPlans(maxP, minU);
          return success(output);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // v5.1 — metacognitive_analysis
  // =========================================================================
  server.tool(
    "metacognitive_analysis",
    "Analyze DreamGraph's own performance: per-strategy precision/recall, " +
      "promotion threshold calibration (actual validation rates per confidence bucket), " +
      "and domain-specific decay profiles. Optionally auto-apply recommended thresholds (in-memory only).",
    {
      window_size: z
        .number()
        .min(5)
        .max(500)
        .optional()
        .describe("Number of recent dream cycles to analyze (default: 50)."),
      auto_apply: z
        .boolean()
        .optional()
        .describe(
          "If true, apply recommended thresholds to in-memory engine state. " +
          "Bounded by safety guards. Resets on restart. Default: false."
        ),
    },
    async ({ window_size, auto_apply }) => {
      const ws = window_size ?? 50;
      const aa = auto_apply ?? false;
      logger.info(`metacognitive_analysis tool called: window=${ws}, auto_apply=${aa}`);

      const result = await safeExecute<MetaLogEntry>(
        async (): Promise<ToolResponse<MetaLogEntry>> => {
          const entry = await runMetacognitiveAnalysis(ws, aa);
          return success(entry);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // v5.1 — dispatch_cognitive_event
  // =========================================================================
  server.tool(
    "dispatch_cognitive_event",
    "Dispatch a cognitive event that may trigger a reactive dream cycle. " +
      "Events are classified, entity-scoped, and logged. " +
      "Supports sources: git_webhook, ci_cd, runtime_anomaly, tension_threshold, federation_import, manual.",
    {
      source: z
        .enum([
          "git_webhook",
          "ci_cd",
          "runtime_anomaly",
          "tension_threshold",
          "federation_import",
          "manual",
        ])
        .describe("The event source type."),
      severity: z
        .enum(["critical", "high", "medium", "low", "info"])
        .describe("Event severity level."),
      description: z
        .string()
        .describe("Human-readable event description."),
      affected_entities: z
        .array(z.string())
        .optional()
        .describe("Entity IDs affected by this event (for scoping). Default: []."),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Arbitrary event payload data."),
    },
    async ({ source, severity, description: desc, affected_entities, payload }) => {
      logger.info(`dispatch_cognitive_event tool called: source=${source}, severity=${severity}`);

      const result = await safeExecute<EventLogEntry>(
        async (): Promise<ToolResponse<EventLogEntry>> => {
          const event = {
            id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            source,
            severity,
            timestamp: new Date().toISOString(),
            payload: payload ?? {},
            affected_entities: affected_entities ?? [],
            description: desc,
          };
          const entry = await dispatchEvent(event);
          return success(entry);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // v5.1 — get_system_story
  // =========================================================================
  server.tool(
    "get_system_story",
    "Read the persistent system autobiography — a living narrative that " +
      "auto-accumulates diff chapters after every N dream cycles. " +
      "Optionally return only recent chapters or weekly digests only.",
    {
      last_n_chapters: z
        .number()
        .min(1)
        .max(100)
        .optional()
        .describe("Return only the N most recent chapters. Default: all."),
      digest_only: z
        .boolean()
        .optional()
        .describe("If true, return only weekly digests (no chapters). Default: false."),
    },
    async ({ last_n_chapters, digest_only }) => {
      const digestOnly = digest_only ?? false;
      logger.info(
        `get_system_story tool called: last_n=${last_n_chapters ?? "all"}, digest_only=${digestOnly}`
      );

      const result = await safeExecute<SystemStoryFile>(
        async (): Promise<ToolResponse<SystemStoryFile>> => {
          const story = await getSystemStory();

          // Apply filters
          if (digestOnly) {
            return success({
              ...story,
              chapters: [],
            });
          }

          if (last_n_chapters !== undefined) {
            return success({
              ...story,
              chapters: story.chapters.slice(-last_n_chapters),
            });
          }

          return success(story);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // v5.2 — DREAM SCHEDULING TOOLS
  // =========================================================================

  // =========================================================================
  // schedule_dream — Create a new schedule
  // =========================================================================
  server.tool(
    "schedule_dream",
    "Create a new dream schedule for temporal orchestration of cognitive actions. " +
      "Supports interval (every N ms), cycle-based (every N dream cycles), " +
      "cron-like (hour/day patterns), and idle-time triggers. " +
      "Actions: dream_cycle, nightmare_cycle, metacognitive_analysis, " +
      "dispatch_cognitive_event, narrative_chapter, federation_export, graph_maintenance.",
    {
      name: z
        .string()
        .describe("Human-readable name for this schedule (e.g. 'Nightly nightmare scan')."),
      action: z
        .enum([
          "dream_cycle",
          "nightmare_cycle",
          "metacognitive_analysis",
          "dispatch_cognitive_event",
          "narrative_chapter",
          "federation_export",
          "graph_maintenance",
        ])
        .describe("The cognitive action to execute."),
      parameters: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Action-specific parameters. For dream_cycle: {strategy, max_dreams}. " +
          "For nightmare_cycle: {strategy}. For metacognitive_analysis: {window_size, auto_apply}. " +
          "For dispatch_cognitive_event: {source, severity, description, payload}."
        ),
      trigger_type: z
        .enum(["interval", "cron_like", "after_cycles", "on_idle"])
        .describe(
          "How the schedule is triggered: " +
          "'interval' = every N ms, 'cron_like' = cron pattern, " +
          "'after_cycles' = every N dream cycles, 'on_idle' = after N ms of inactivity."
        ),
      interval_ms: z
        .number()
        .min(60_000)
        .optional()
        .describe("For 'interval' trigger: milliseconds between runs (min 60000). Prefer interval_seconds."),
      interval_seconds: z
        .number()
        .min(60)
        .optional()
        .describe("For 'interval' trigger: seconds between runs (min 60). Preferred over interval_ms."),
      cron: z
        .string()
        .optional()
        .describe(
          "For 'cron_like' trigger: cron expression (min hour dom month dow). " +
          "Example: '0 6 * * *' = daily at 6am, '0 0 * * 1' = weekly on Monday midnight."
        ),
      cycle_interval: z
        .number()
        .min(1)
        .optional()
        .describe("For 'after_cycles' trigger: run every N dream cycles."),
      idle_ms: z
        .number()
        .min(60_000)
        .optional()
        .describe("For 'on_idle' trigger: milliseconds of inactivity before triggering (min 60000). Prefer idle_seconds."),
      idle_seconds: z
        .number()
        .min(60)
        .optional()
        .describe("For 'on_idle' trigger: seconds of inactivity before triggering (min 60). Preferred over idle_ms."),
      enabled: z
        .boolean()
        .optional()
        .describe("Whether the schedule starts enabled (default: true)."),
      max_runs: z
        .number()
        .min(1)
        .optional()
        .describe("Optional max execution count. Schedule pauses when reached. Default: unlimited."),
    },
    async ({ name, action, parameters, trigger_type, interval_ms, interval_seconds, cron, cycle_interval, idle_ms, idle_seconds, enabled, max_runs }) => {
      logger.info(`schedule_dream tool called: name="${name}", action=${action}, trigger=${trigger_type}`);

      // Convert seconds to ms if provided
      const resolvedIntervalMs = interval_seconds ? interval_seconds * 1000 : interval_ms;
      const resolvedIdleMs = idle_seconds ? idle_seconds * 1000 : idle_ms;

      // Validate trigger-specific required fields
      if (trigger_type === "interval" && !resolvedIntervalMs) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "interval trigger requires interval_seconds or interval_ms" }) }] };
      }
      if (trigger_type === "cron_like" && !cron) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "cron_like trigger requires cron expression" }) }] };
      }
      if (trigger_type === "after_cycles" && !cycle_interval) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "after_cycles trigger requires cycle_interval" }) }] };
      }
      if (trigger_type === "on_idle" && !resolvedIdleMs) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: "on_idle trigger requires idle_seconds or idle_ms" }) }] };
      }

      const result = await safeExecute<DreamSchedule>(
        async (): Promise<ToolResponse<DreamSchedule>> => {
          const schedule = await createSchedule({
            name,
            action,
            parameters: parameters ?? {},
            trigger_type,
            interval_ms: resolvedIntervalMs,
            cron,
            cycle_interval,
            idle_ms: resolvedIdleMs,
            enabled,
            max_runs: max_runs ?? null,
          });
          return success(schedule);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // list_schedules — List all schedules
  // =========================================================================
  server.tool(
    "list_schedules",
    "List all dream schedules with their status, next run time, last run time, " +
      "run count, and configuration. Optionally filter by action type or enabled status.",
    {
      action: z
        .enum([
          "dream_cycle",
          "nightmare_cycle",
          "metacognitive_analysis",
          "dispatch_cognitive_event",
          "narrative_chapter",
          "federation_export",
          "graph_maintenance",
        ])
        .optional()
        .describe("Filter by action type."),
      enabled_only: z
        .boolean()
        .optional()
        .describe("If true, only return enabled schedules. Default: false (all)."),
    },
    async ({ action, enabled_only }) => {
      logger.info(`list_schedules tool called: action=${action ?? "all"}, enabled_only=${enabled_only ?? false}`);

      const result = await safeExecute<{ schedules: DreamSchedule[]; total: number }>(
        async (): Promise<ToolResponse<{ schedules: DreamSchedule[]; total: number }>> => {
          let schedules = await getSchedules();
          if (action) {
            schedules = schedules.filter((s) => s.action === action);
          }
          if (enabled_only) {
            schedules = schedules.filter((s) => s.enabled);
          }
          return success({ schedules, total: schedules.length });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // update_schedule — Modify a schedule
  // =========================================================================
  server.tool(
    "update_schedule",
    "Update an existing dream schedule. Can enable/disable, change parameters, " +
      "modify trigger configuration, or set execution limits. " +
      "Re-enabling an error-paused schedule resets its error counter.",
    {
      schedule_id: z
        .string()
        .describe("The ID of the schedule to update."),
      name: z.string().optional().describe("New name."),
      enabled: z.boolean().optional().describe("Enable or disable the schedule."),
      parameters: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("New action parameters."),
      interval_ms: z.number().min(60_000).optional().describe("New interval in ms. Prefer interval_seconds."),
      interval_seconds: z.number().min(60).optional().describe("New interval in seconds. Preferred over interval_ms."),
      cron: z.string().optional().describe("New cron expression."),
      cycle_interval: z.number().min(1).optional().describe("New cycle interval."),
      idle_ms: z.number().min(60_000).optional().describe("New idle threshold in ms. Prefer idle_seconds."),
      idle_seconds: z.number().min(60).optional().describe("New idle threshold in seconds. Preferred over idle_ms."),
      max_runs: z.number().min(1).optional().describe("New max run count."),
    },
    async ({ schedule_id, name, enabled, parameters, interval_ms, interval_seconds, cron, cycle_interval, idle_ms, idle_seconds, max_runs }) => {
      logger.info(`update_schedule tool called: id=${schedule_id}`);

      // Convert seconds to ms if provided
      const resolvedIntervalMs = interval_seconds ? interval_seconds * 1000 : interval_ms;
      const resolvedIdleMs = idle_seconds ? idle_seconds * 1000 : idle_ms;

      const result = await safeExecute<DreamSchedule>(
        async (): Promise<ToolResponse<DreamSchedule>> => {
          const updated = await updateSchedule(schedule_id, {
            name,
            enabled,
            parameters,
            interval_ms: resolvedIntervalMs,
            cron,
            cycle_interval,
            idle_ms: resolvedIdleMs,
            max_runs,
          });
          if (!updated) {
            return error("NOT_FOUND", `Schedule not found: ${schedule_id}`);
          }
          return success(updated);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // run_schedule_now — Force immediate execution
  // =========================================================================
  server.tool(
    "run_schedule_now",
    "Force immediate execution of a schedule for testing or one-off triggers. " +
      "Bypasses timing checks but still respects safety guards (rate limits, cooldowns). " +
      "Records execution in schedule history.",
    {
      schedule_id: z
        .string()
        .describe("The ID of the schedule to execute immediately."),
    },
    async ({ schedule_id }) => {
      logger.info(`run_schedule_now tool called: id=${schedule_id}`);

      const result = await safeExecute<ScheduleExecution>(
        async (): Promise<ToolResponse<ScheduleExecution>> => {
          const execution = await runScheduleNow(schedule_id);
          return success(execution);
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // delete_schedule — Remove a schedule
  // =========================================================================
  server.tool(
    "delete_schedule",
    "Delete a dream schedule permanently. Execution history is retained " +
      "for audit purposes. Use update_schedule to disable instead of deleting.",
    {
      schedule_id: z
        .string()
        .describe("The ID of the schedule to delete."),
    },
    async ({ schedule_id }) => {
      logger.info(`delete_schedule tool called: id=${schedule_id}`);

      const result = await safeExecute<{ deleted: boolean; schedule_id: string }>(
        async (): Promise<ToolResponse<{ deleted: boolean; schedule_id: string }>> => {
          const deleted = await deleteSchedule(schedule_id);
          if (!deleted) {
            return error("NOT_FOUND", `Schedule not found: ${schedule_id}`);
          }
          return success({ deleted: true, schedule_id });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // =========================================================================
  // get_schedule_history — Execution audit trail
  // =========================================================================
  server.tool(
    "get_schedule_history",
    "Get the execution history of scheduled actions. " +
      "Returns timing, success/failure status, and result summaries. " +
      "Optionally filter by schedule ID or limit results.",
    {
      schedule_id: z
        .string()
        .optional()
        .describe("Filter by schedule ID. Default: all schedules."),
      limit: z
        .number()
        .min(1)
        .max(500)
        .optional()
        .describe("Maximum number of history entries to return (default: 50)."),
    },
    async ({ schedule_id, limit }) => {
      const lim = limit ?? 50;
      logger.info(`get_schedule_history tool called: id=${schedule_id ?? "all"}, limit=${lim}`);

      const result = await safeExecute<{ executions: ScheduleExecution[]; total: number }>(
        async (): Promise<ToolResponse<{ executions: ScheduleExecution[]; total: number }>> => {
          const executions = await getScheduleHistory(schedule_id, lim);
          return success({ executions, total: executions.length });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 17 cognitive tools + 6 scheduler tools");
}
