/**
 * DreamGraph Causal Reasoning Engine
 *
 * Mines dream_history + tension_log to build causal inference chains.
 * Instead of just structural relationships (A connects to B), causal
 * reasoning identifies that *changing A causes B to fail*.
 *
 * Capabilities:
 *   - Build causal chains from historical tension/edge correlation
 *   - Identify propagation hotspots (entities that amplify failures)
 *   - Predict downstream impact of entity changes
 *   - Dream strategy: "causal_replay" — replay historical tensions
 *     forward to predict future breakage
 *
 * READ-ONLY against the Fact Graph. Writes only to dream space.
 */

import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import type {
  CausalLink,
  CausalChain,
  CausalInsights,
  DreamEdge,
  DreamHistoryEntry,
  TensionSignal,
  ResolvedTension,
} from "./types.js";
import { DEFAULT_DECAY } from "./types.js";

// ---------------------------------------------------------------------------
// Causal Link Discovery
// ---------------------------------------------------------------------------

interface TensionEvent {
  entity: string;
  cycle: number;
  urgency: number;
  type: string;
  domain: string;
  resolved: boolean;
}

/**
 * Extract a timeline of tension events from history + tension log.
 * Each event records: which entity was troubled, when, and how urgently.
 */
async function buildTensionTimeline(): Promise<TensionEvent[]> {
  const [tensionFile, history] = await Promise.all([
    engine.loadTensions(),
    engine.loadDreamHistory(),
  ]);

  const events: TensionEvent[] = [];

  // Active tensions
  for (const signal of tensionFile.signals) {
    for (const entity of signal.entities) {
      events.push({
        entity,
        cycle: history.sessions.length > 0
          ? history.sessions[history.sessions.length - 1].cycle_number
          : 0,
        urgency: signal.urgency,
        type: signal.type,
        domain: signal.domain,
        resolved: signal.resolved,
      });
    }
  }

  // Resolved tensions (historical)
  for (const resolved of tensionFile.resolved_tensions ?? []) {
    for (const entity of resolved.original.entities) {
      events.push({
        entity,
        cycle: resolved.original.ttl > 0
          ? history.sessions.length - resolved.original.ttl
          : 0,
        urgency: resolved.original.urgency,
        type: resolved.original.type,
        domain: resolved.original.domain,
        resolved: true,
      });
    }
  }

  return events.sort((a, b) => a.cycle - b.cycle);
}

/**
 * Find pairs of entities where tension in entity A consistently
 * precedes tension in entity B within a lag window.
 */
function discoverCausalLinks(
  events: TensionEvent[],
  maxLag: number = 5
): CausalLink[] {
  // Group events by entity
  const byEntity = new Map<string, TensionEvent[]>();
  for (const e of events) {
    const list = byEntity.get(e.entity) ?? [];
    list.push(e);
    byEntity.set(e.entity, list);
  }

  const links: CausalLink[] = [];
  const entities = [...byEntity.keys()];
  const now = new Date().toISOString();

  for (let i = 0; i < entities.length; i++) {
    for (let j = 0; j < entities.length; j++) {
      if (i === j) continue;

      const causeEvents = byEntity.get(entities[i])!;
      const effectEvents = byEntity.get(entities[j])!;

      let coOccurrences = 0;
      let totalLag = 0;

      for (const cause of causeEvents) {
        for (const effect of effectEvents) {
          const lag = effect.cycle - cause.cycle;
          if (lag > 0 && lag <= maxLag) {
            coOccurrences++;
            totalLag += lag;
          }
        }
      }

      // Require at least 2 co-occurrences for statistical significance
      if (coOccurrences < 2) continue;

      const avgLag = totalLag / coOccurrences;
      // Correlation strength: normalized by total possible co-occurrences
      const maxPossible = Math.min(causeEvents.length, effectEvents.length);
      const strength = Math.round(
        Math.min(coOccurrences / Math.max(maxPossible, 1), 1) * 100
      ) / 100;

      if (strength < 0.3) continue; // Filter weak correlations

      links.push({
        cause_entity: entities[i],
        effect_entity: entities[j],
        lag_cycles: Math.round(avgLag * 10) / 10,
        correlation_strength: strength,
        observed_count: coOccurrences,
        first_observed: causeEvents[0]?.cycle.toString() ?? now,
        last_observed: now,
        description: `Changes to "${entities[i]}" are followed by tensions in "${entities[j]}" within ~${Math.round(avgLag)} cycles (observed ${coOccurrences} times)`,
      });
    }
  }

  return links.sort((a, b) => b.correlation_strength - a.correlation_strength);
}

/**
 * Build multi-hop causal chains from individual links.
 * A → B → C where A→B and B→C are both causal links.
 */
function buildCausalChains(links: CausalLink[], maxDepth: number = 4): CausalChain[] {
  const chains: CausalChain[] = [];
  const linksBySource = new Map<string, CausalLink[]>();

  for (const link of links) {
    const list = linksBySource.get(link.cause_entity) ?? [];
    list.push(link);
    linksBySource.set(link.cause_entity, list);
  }

  // BFS from each root cause
  for (const rootLink of links) {
    const visited = new Set<string>([rootLink.cause_entity]);
    const queue: Array<{ path: CausalLink[]; current: string }> = [
      { path: [rootLink], current: rootLink.effect_entity },
    ];

    while (queue.length > 0) {
      const { path, current } = queue.shift()!;

      if (path.length >= maxDepth) continue;
      if (visited.has(current)) continue;
      visited.add(current);

      // Record chain if path > 1
      if (path.length >= 2) {
        const totalStrength = path.reduce(
          (acc, l) => acc * l.correlation_strength, 1
        );
        chains.push({
          id: `causal_chain_${chains.length + 1}`,
          links: [...path],
          total_strength: Math.round(totalStrength * 100) / 100,
          root_cause: path[0].cause_entity,
          terminal_effect: path[path.length - 1].effect_entity,
          discovered_at: new Date().toISOString(),
        });
      }

      // Continue BFS
      const nextLinks = linksBySource.get(current) ?? [];
      for (const next of nextLinks) {
        if (!visited.has(next.effect_entity)) {
          queue.push({
            path: [...path, next],
            current: next.effect_entity,
          });
        }
      }
    }
  }

  return chains.sort((a, b) => b.total_strength - a.total_strength).slice(0, 20);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze the system's history for causal patterns.
 * Returns chains, hotspots, and predicted impacts.
 */
export async function analyzeCausality(): Promise<CausalInsights> {
  logger.info("Causal analysis starting");

  const events = await buildTensionTimeline();
  logger.debug(`Built tension timeline: ${events.length} events`);

  const links = discoverCausalLinks(events);
  logger.debug(`Discovered ${links.length} causal links`);

  const chains = buildCausalChains(links);
  logger.debug(`Built ${chains.length} causal chains`);

  // Propagation hotspots: entities that appear as cause in many links
  const causeCount = new Map<string, { count: number; totalLag: number }>();
  for (const link of links) {
    const existing = causeCount.get(link.cause_entity) ?? { count: 0, totalLag: 0 };
    existing.count++;
    existing.totalLag += link.lag_cycles;
    causeCount.set(link.cause_entity, existing);
  }

  const propagation_hotspots = [...causeCount.entries()]
    .map(([entity, stats]) => ({
      entity,
      downstream_count: stats.count,
      avg_lag: Math.round((stats.totalLag / stats.count) * 10) / 10,
    }))
    .sort((a, b) => b.downstream_count - a.downstream_count)
    .slice(0, 10);

  // Predicted impacts: for each hotspot, list affected entities
  const predicted_impacts = propagation_hotspots.map((hotspot) => {
    const affected = links
      .filter((l) => l.cause_entity === hotspot.entity)
      .map((l) => l.effect_entity);
    return {
      if_changed: hotspot.entity,
      likely_affected: [...new Set(affected)],
      confidence: Math.round(
        (links
          .filter((l) => l.cause_entity === hotspot.entity)
          .reduce((sum, l) => sum + l.correlation_strength, 0) /
          Math.max(affected.length, 1)) * 100
      ) / 100,
    };
  });

  logger.info(
    `Causal analysis complete: ${chains.length} chains, ${propagation_hotspots.length} hotspots`
  );

  return { chains, propagation_hotspots, predicted_impacts };
}

/**
 * Causal Replay dream strategy.
 * Replays historical tension patterns forward to generate
 * speculative edges predicting future breakage.
 *
 * PRECONDITION: Engine must be in REM state.
 */
export async function causalReplayDream(
  cycle: number,
  max: number
): Promise<DreamEdge[]> {
  engine.assertState("rem", "causalReplayDream");

  const events = await buildTensionTimeline();
  const links = discoverCausalLinks(events);
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  // For each strong causal link, generate a predictive dream edge
  for (const link of links.slice(0, max)) {
    edges.push({
      id: `dream_causal_${Date.now()}_${edges.length}`,
      from: link.cause_entity,
      to: link.effect_entity,
      type: "hypothetical",
      relation: `causal_dependency`,
      reason: `Causal inference: ${link.description}. Strength: ${link.correlation_strength}, lag: ${link.lag_cycles} cycles`,
      confidence: Math.round(link.correlation_strength * 0.8 * 100) / 100,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      strategy: "causal_replay",
      meta: {
        causal_lag: link.lag_cycles,
        observed_count: link.observed_count,
        correlation_strength: link.correlation_strength,
      },
      ttl: DEFAULT_DECAY.ttl + 2, // Causal edges get longer TTL
      decay_rate: DEFAULT_DECAY.decay_rate,
      reinforcement_count: link.observed_count, // Pre-load from history
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      plausibility: 0,
      evidence_score: 0,
      contradiction_score: 0,
    });
  }

  logger.info(`Causal replay: generated ${edges.length} predictive dream edges`);
  return edges;
}
