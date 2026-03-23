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
 *
 * Tools (cognitive operations):
 *   dream_cycle        — Full dream → normalize → wake cycle (with decay + dedup + history)
 *   normalize_dreams   — Manual normalization pass
 *   cognitive_status   — Read current state
 *   query_dreams       — Search dream/validated data
 *   clear_dreams       — Reset dream data (safety valve)
 *   get_dream_insights — Introspection: strongest hypotheses, clusters, tensions
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { engine } from "./engine.js";
import { dream } from "./dreamer.js";
import { normalize } from "./normalizer.js";
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

  logger.info("Registered 6 cognitive resources");
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
          "reflective",
          "all",
        ])
        .optional()
        .describe(
          'Dream strategy. "gap_detection": find unconnected related entities. "weak_reinforcement": strengthen weak edges. "cross_domain": bridge different domains. "missing_abstraction": propose unifying features. "symmetry_completion": add reverse edges. "tension_directed": focus on unresolved tensions. "reflective": agent-directed insights from code reading. "all": run all strategies. Default: "all".'
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
  logger.info("Registered 7 cognitive tools");
}
