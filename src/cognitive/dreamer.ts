/**
 * DreamGraph Cognitive Dreamer — REM dream router.
 *
 * The dreamer analyzes the Fact Graph and generates speculative nodes
 * and edges via a portfolio of strategies. ALL output goes to
 * `dream_graph.json` via the cognitive engine; the dreamer NEVER
 * modifies the Fact Graph and NEVER produces user-facing output.
 *
 * After F-06 split, individual strategies live under `./strategies/`
 * and this file owns:
 *  - The adaptive strategy selection (skip benched strategies, probe
 *    them periodically)
 *  - Per-strategy yield tracking
 *  - The public `dream()` router that orchestrates strategies, applies
 *    budget allocation, and persists with deduplication
 *
 * Strategies (one file each under `./strategies/`):
 *  1. gap-detection
 *  2. weak-reinforcement
 *  3. cross-domain-bridging
 *  4. missing-abstraction
 *  5. symmetry-completion
 *  6. tension-directed
 *  7. causal-replay (lives in `./causal.ts`)
 *  8. pgo-wave
 *  9. llm-dream
 */

import { logger } from "../utils/logger.js";
import { engine } from "./engine.js";
import { causalReplayDream } from "./causal.js";
import type { DreamNode, DreamEdge, DreamStrategy } from "./types.js";

import { buildFactSnapshot } from "./strategies/_shared.js";
import { gapDetection } from "./strategies/gap-detection.js";
import { weakReinforcement } from "./strategies/weak-reinforcement.js";
import { crossDomainBridging } from "./strategies/cross-domain-bridging.js";
import { missingAbstraction } from "./strategies/missing-abstraction.js";
import { symmetryCompletion } from "./strategies/symmetry-completion.js";
import { tensionDirected } from "./strategies/tension-directed.js";
import { pgoWaveDream } from "./strategies/pgo-wave.js";
import { llmDream } from "./strategies/llm-dream.js";
import { orphanBridging } from "./strategies/orphan-bridging.js";

// ---------------------------------------------------------------------------
// Public API — Dream Cycle
// ---------------------------------------------------------------------------

export interface DreamResult {
  nodes: DreamNode[];
  edges: DreamEdge[];
  duplicates_merged: number;
  /** Per-strategy yield for this cycle (adaptive selection tracking) */
  strategy_yields: Record<string, number>;
  /** Strategies that were skipped this cycle due to adaptive selection */
  skipped_strategies: string[];
}

// ---------------------------------------------------------------------------
// Adaptive Strategy Selection — skip unproductive strategies
// ---------------------------------------------------------------------------

/** Per-strategy history: how many new edges it produced in recent cycles */
const strategyHistory = new Map<DreamStrategy, number[]>();

/** Number of consecutive 0-yield cycles before a strategy gets skipped */
const SKIP_AFTER_BARREN_CYCLES = Number(process.env.DG_BARREN_THRESHOLD) || 3;

/**
 * Record strategy yield and return whether the strategy should run.
 * Has a cooldown: after SKIP_AFTER_BARREN_CYCLES consecutive zeros,
 * the strategy is benched. Every Nth cycle it gets a "probe" run
 * to check if conditions have changed.
 */
function shouldRunStrategy(strategy: DreamStrategy, currentCycle: number): boolean {
  const history = strategyHistory.get(strategy) ?? [];

  if (history.length < SKIP_AFTER_BARREN_CYCLES) return true;

  const recentRuns = history.slice(-SKIP_AFTER_BARREN_CYCLES);
  const allBarren = recentRuns.every((y) => y === 0);

  if (!allBarren) return true;

  const probeInterval = Number(process.env.DG_PROBE_INTERVAL) || 6;
  if (currentCycle % probeInterval === 0) {
    logger.debug(`Adaptive probe: re-enabling "${strategy}" for probe cycle ${currentCycle}`);
    return true;
  }

  logger.debug(`Adaptive skip: "${strategy}" benched (${SKIP_AFTER_BARREN_CYCLES} consecutive 0-yield cycles)`);
  return false;
}

function recordStrategyYield(strategy: DreamStrategy, newEdges: number): void {
  const history = strategyHistory.get(strategy) ?? [];
  history.push(newEdges);
  const maxHistory = Number(process.env.DG_STRATEGY_HISTORY) || 12;
  if (history.length > maxHistory) history.splice(0, history.length - maxHistory);
  strategyHistory.set(strategy, history);
}

/**
 * Execute a dream cycle using the specified strategy.
 *
 * PRECONDITION: Engine must be in REM state.
 * The caller (cognitive register) handles state transitions.
 *
 * Enhanced with:
 * - Deduplication (duplicate suppression) instead of raw append
 * - Adaptive strategy selection: skip strategies that have produced
 *   0 new edges for 3+ consecutive cycles, redistributing their
 *   budget to productive strategies.
 */
export async function dream(
  strategy: DreamStrategy = "all",
  maxDreams: number = 100,
): Promise<DreamResult> {
  engine.assertState("rem", "dream");

  const cycle = engine.nextDreamCycle();
  logger.info(
    `REM dream cycle #${cycle} starting (strategy: ${strategy}, max: ${maxDreams})`,
  );

  const snapshot = await buildFactSnapshot();
  logger.debug(
    `Fact snapshot: ${snapshot.entities.size} entities, ${snapshot.edgeSet.size} edges, ${snapshot.domains.size} domains`,
  );

  let allNodes: DreamNode[] = [];
  let allEdges: DreamEdge[] = [];
  const strategyYields: Record<string, number> = {};
  const skippedStrategies: string[] = [];

  // LLM dream and PGO wave are always included when running "all"
  const allStrategies: DreamStrategy[] = [
    "llm_dream",
    "pgo_wave",
    "gap_detection",
    "weak_reinforcement",
    "cross_domain",
    "missing_abstraction",
    "symmetry_completion",
    "tension_directed",
    "causal_replay",
    "orphan_bridging",
  ];

  const strategiesToRun: DreamStrategy[] =
    strategy === "all"
      ? allStrategies.filter((s) => {
          if (s === "llm_dream" || s === "pgo_wave") return true;
          if (shouldRunStrategy(s, cycle)) return true;
          skippedStrategies.push(s);
          return false;
        })
      : [strategy];

  // Budget allocation: LLM gets 35%, PGO wave gets 15%, rest split evenly
  const hasLlm = strategiesToRun.includes("llm_dream");
  const hasPgo = strategiesToRun.includes("pgo_wave");
  const structuralCount = strategiesToRun.length - (hasLlm ? 1 : 0) - (hasPgo ? 1 : 0);
  const llmFrac = Number(process.env.DG_LLM_BUDGET) || 0.35;
  const pgoFrac = Number(process.env.DG_PGO_BUDGET) || 0.15;
  const llmBudget = hasLlm ? Math.ceil(maxDreams * llmFrac) : 0;
  const pgoBudget = hasPgo ? Math.ceil(maxDreams * pgoFrac) : 0;
  const structuralBudget = maxDreams - llmBudget - pgoBudget;
  const perStrategy = structuralCount > 0 ? Math.ceil(structuralBudget / structuralCount) : maxDreams;

  if (skippedStrategies.length > 0) {
    logger.info(
      `Adaptive selection: running ${strategiesToRun.length} strategies, skipped [${skippedStrategies.join(", ")}] — LLM: ${llmBudget}, PGO: ${pgoBudget}, structural: ${perStrategy}/each`,
    );
  }

  // --------------- LLM Dream — the creative core -------------------
  if (strategiesToRun.includes("llm_dream")) {
    try {
      const llmResult = await llmDream(snapshot, cycle, llmBudget || perStrategy);
      allNodes.push(...llmResult.nodes);
      allEdges.push(...llmResult.edges);
      strategyYields["llm_dream"] = llmResult.edges.length + llmResult.nodes.length;
      logger.debug(`LLM dream: ${llmResult.edges.length} edges, ${llmResult.nodes.length} nodes`);
    } catch (err) {
      strategyYields["llm_dream"] = 0;
      logger.warn(`LLM dream: failed (${err instanceof Error ? err.message : "error"})`);
    }
  }

  // --------------- Structural strategies ---------------------------
  if (strategiesToRun.includes("gap_detection")) {
    const gaps = gapDetection(snapshot, cycle, perStrategy);
    allEdges.push(...gaps);
    strategyYields["gap_detection"] = gaps.length;
    logger.debug(`Gap detection: ${gaps.length} dream edges`);
  }

  if (strategiesToRun.includes("weak_reinforcement")) {
    const weak = weakReinforcement(snapshot, cycle, perStrategy);
    allEdges.push(...weak);
    strategyYields["weak_reinforcement"] = weak.length;
    logger.debug(`Weak reinforcement: ${weak.length} dream edges`);
  }

  if (strategiesToRun.includes("cross_domain")) {
    const bridges = crossDomainBridging(snapshot, cycle, perStrategy);
    allEdges.push(...bridges);
    strategyYields["cross_domain"] = bridges.length;
    logger.debug(`Cross-domain bridging: ${bridges.length} dream edges`);
  }

  if (strategiesToRun.includes("missing_abstraction")) {
    const abstractions = missingAbstraction(snapshot, cycle, perStrategy);
    allNodes.push(...abstractions.nodes);
    allEdges.push(...abstractions.edges);
    strategyYields["missing_abstraction"] = abstractions.nodes.length + abstractions.edges.length;
    logger.debug(
      `Missing abstraction: ${abstractions.nodes.length} nodes, ${abstractions.edges.length} edges`,
    );
  }

  if (strategiesToRun.includes("symmetry_completion")) {
    const symmetry = symmetryCompletion(snapshot, cycle, perStrategy);
    allEdges.push(...symmetry);
    strategyYields["symmetry_completion"] = symmetry.length;
    logger.debug(`Symmetry completion: ${symmetry.length} dream edges`);
  }

  // Tension-directed dreaming — uses unresolved tensions from the engine
  if (strategiesToRun.includes("tension_directed")) {
    const tensions = await engine.getUnresolvedTensions();
    if (tensions.length > 0) {
      const tensionEdges = tensionDirected(snapshot, tensions, cycle, perStrategy);
      allEdges.push(...tensionEdges);
      strategyYields["tension_directed"] = tensionEdges.length;
      logger.debug(`Tension-directed: ${tensionEdges.length} dream edges from ${tensions.length} tensions`);

      for (const t of tensions) {
        t.attempted = true;
      }
    } else {
      strategyYields["tension_directed"] = 0;
      logger.debug("Tension-directed: no unresolved tensions");
    }
  }

  // Causal replay dreaming — mines history for cause-effect patterns
  if (strategiesToRun.includes("causal_replay")) {
    try {
      const causalEdges = await causalReplayDream(cycle, perStrategy);
      allEdges.push(...causalEdges);
      strategyYields["causal_replay"] = causalEdges.length;
      logger.debug(`Causal replay: ${causalEdges.length} dream edges`);
    } catch (err) {
      strategyYields["causal_replay"] = 0;
      logger.debug(`Causal replay: skipped (${err instanceof Error ? err.message : "error"})`);
    }
  }

  // PGO wave — stochastic divergence (Lévy flight + stochastic resonance)
  if (strategiesToRun.includes("pgo_wave")) {
    const pgoEdges = pgoWaveDream(snapshot, cycle, pgoBudget || perStrategy);
    allEdges.push(...pgoEdges);
    strategyYields["pgo_wave"] = pgoEdges.length;
  }

  // Orphan bridging — attach degree-0 fact-graph entities to nearest neighbor
  if (strategiesToRun.includes("orphan_bridging")) {
    const orphanCap = Number(process.env.DG_ORPHAN_BUDGET) || 20;
    const orphanBudget = Math.min(perStrategy, orphanCap);
    const orphanEdges = orphanBridging(snapshot, cycle, orphanBudget);
    allEdges.push(...orphanEdges);
    strategyYields["orphan_bridging"] = orphanEdges.length;
    logger.debug(`Orphan bridging: ${orphanEdges.length} dream edges (budget ${orphanBudget})`);
  }

  // Record yields for adaptive selection (only when running "all")
  if (strategy === "all") {
    for (const s of allStrategies) {
      recordStrategyYield(s, strategyYields[s] ?? 0);
    }
  }

  // Cap total output
  allNodes = allNodes.slice(0, maxDreams);
  allEdges = allEdges.slice(0, maxDreams);

  // Persist to dream graph with DEDUPLICATION
  let totalMerged = 0;

  if (allNodes.length > 0) {
    const nodeResult = await engine.deduplicateAndAppendNodes(allNodes);
    allNodes = nodeResult.appended;
    totalMerged += nodeResult.merged;
  }
  if (allEdges.length > 0) {
    const edgeResult = await engine.deduplicateAndAppendEdges(allEdges);
    allEdges = edgeResult.appended;
    totalMerged += edgeResult.merged;
  }

  logger.info(
    `REM dream cycle #${cycle} complete: ${allNodes.length} nodes, ${allEdges.length} edges ` +
      `(${totalMerged} duplicates merged — ideas become beliefs)` +
      (skippedStrategies.length > 0 ? ` [skipped: ${skippedStrategies.join(", ")}]` : ""),
  );

  return {
    nodes: allNodes,
    edges: allEdges,
    duplicates_merged: totalMerged,
    strategy_yields: strategyYields,
    skipped_strategies: skippedStrategies,
  };
}
