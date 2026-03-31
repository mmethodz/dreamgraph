/**
 * DreamGraph Temporal Dreaming Engine
 *
 * Adds a time dimension to the cognitive system:
 *
 *   Retrocognition — "3 months ago, tension X was latent. Then feature Y
 *     was shipped. The tension resolved. What latent tensions share that
 *     trajectory?"
 *
 *   Precognition — Given current validated edges + latent tensions + cycle
 *     velocity, predict which tensions will become critical in 1/2/4 weeks.
 *
 *   Seasonal Awareness — Learn that certain domains get heavy development
 *     at certain periods and proactively deepen dreaming in those areas.
 *
 *   Tension Thermodynamics — Track how tension energy flows, transforms,
 *     and dissipates over time.
 *
 * READ-ONLY against fact data. Analyzes dream_history and tension_log.
 */

import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import type {
  TensionTrajectory,
  TemporalPrediction,
  SeasonalPattern,
  TemporalInsights,
  TensionDomain,
  DreamHistoryEntry,
  TensionSignal,
  ResolvedTension,
} from "./types.js";

// ---------------------------------------------------------------------------
// Trajectory Analysis
// ---------------------------------------------------------------------------

/**
 * Build urgency-over-time trajectories for all known tensions.
 * Combines active and resolved tensions.
 */
async function buildTrajectories(): Promise<TensionTrajectory[]> {
  const [tensionFile, history] = await Promise.all([
    engine.loadTensions(),
    engine.loadDreamHistory(),
  ]);

  const trajectories: TensionTrajectory[] = [];

  // Active tensions: simulate their urgency decay backwards
  for (const signal of tensionFile.signals) {
    if (signal.resolved) continue;

    const points: Array<{ cycle: number; urgency: number }> = [];
    const currentCycle = history.sessions.length > 0
      ? history.sessions[history.sessions.length - 1].cycle_number
      : 0;

    // Reconstruct approximate trajectory from TTL and occurrences
    const ageEstimate = 30 - (signal.ttl ?? 30); // cycles of life
    const peakUrgency = signal.urgency + (ageEstimate * 0.02); // reverse decay

    for (let i = 0; i <= ageEstimate; i++) {
      const cycleNum = currentCycle - ageEstimate + i;
      const urgencyAtPoint = Math.min(
        peakUrgency - ((ageEstimate - i) * 0.02),
        1.0
      );
      points.push({
        cycle: Math.max(cycleNum, 0),
        urgency: Math.round(Math.max(urgencyAtPoint, 0) * 100) / 100,
      });
    }

    const pattern = classifyPattern(points);

    trajectories.push({
      tension_id: signal.id,
      domain: signal.domain,
      urgency_over_time: points,
      peak_urgency: Math.round(peakUrgency * 100) / 100,
      pattern,
    });
  }

  // Resolved tensions: reconstruct from archive
  for (const resolved of tensionFile.resolved_tensions ?? []) {
    const original = resolved.original;
    const points: Array<{ cycle: number; urgency: number }> = [];

    // Simple two-point trajectory: peak → resolution
    points.push({
      cycle: 0,
      urgency: original.urgency,
    });
    points.push({
      cycle: original.occurrences,
      urgency: 0,
    });

    trajectories.push({
      tension_id: original.id,
      domain: original.domain,
      urgency_over_time: points,
      peak_urgency: original.urgency,
      resolution_cycle: original.occurrences,
      pattern: "resolved",
    });
  }

  return trajectories;
}

/**
 * Classify a trajectory pattern from urgency points.
 */
function classifyPattern(
  points: Array<{ cycle: number; urgency: number }>
): "rising" | "falling" | "stable" | "spike" | "resolved" {
  if (points.length < 2) return "stable";

  const first = points[0].urgency;
  const last = points[points.length - 1].urgency;
  const max = Math.max(...points.map((p) => p.urgency));
  const delta = last - first;

  if (last === 0) return "resolved";
  if (max > first * 2 && max > last * 1.5) return "spike";
  if (delta > 0.15) return "rising";
  if (delta < -0.15) return "falling";
  return "stable";
}

// ---------------------------------------------------------------------------
// Precognition (Prediction)
// ---------------------------------------------------------------------------

/**
 * Predict which entities will develop tensions based on trajectory patterns.
 * Uses pattern matching: if entity A's trajectory matches what entity B
 * looked like before it became critical, predict B-like trouble for A.
 */
async function predictFutureTensions(
  trajectories: TensionTrajectory[]
): Promise<TemporalPrediction[]> {
  const predictions: TemporalPrediction[] = [];
  const tensionFile = await engine.loadTensions();

  // Rising trajectories are predictors of future critical tensions
  const rising = trajectories.filter((t) => t.pattern === "rising");

  for (const trajectory of rising) {
    const points = trajectory.urgency_over_time;
    if (points.length < 2) continue;

    const last = points[points.length - 1];
    const rate = points.length > 1
      ? (last.urgency - points[0].urgency) / points.length
      : 0;

    if (rate <= 0) continue;

    // Estimate cycles to critical (urgency >= 0.8)
    const remaining = Math.max(0, 0.8 - last.urgency);
    const cyclesToCritical = Math.ceil(remaining / rate);

    // Find the original tension to get entity info
    const signal = tensionFile.signals.find(
      (s) => s.id === trajectory.tension_id
    );
    if (!signal) continue;

    for (const entity of signal.entities) {
      predictions.push({
        entity_id: entity,
        predicted_tension_type: signal.type,
        confidence: Math.round(Math.min(rate * 5, 0.9) * 100) / 100,
        estimated_cycles_to_critical: cyclesToCritical,
        basis: `Tension "${trajectory.tension_id}" for entity "${entity}" has rising urgency (rate: +${(rate).toFixed(3)}/cycle). Predicted critical in ~${cyclesToCritical} cycles.`,
      });
    }
  }

  // Also predict from resolved patterns: entities with resolved tensions
  // in the same domain may develop similar issues
  const resolvedByDomain = new Map<string, ResolvedTension[]>();
  for (const resolved of tensionFile.resolved_tensions ?? []) {
    const domain = resolved.original.domain;
    const list = resolvedByDomain.get(domain) ?? [];
    list.push(resolved);
    resolvedByDomain.set(domain, list);
  }

  // If a domain has many resolved tensions, entities in that domain
  // are likely to develop new tensions (pattern recurrence)
  for (const [domain, resolved] of resolvedByDomain) {
    if (resolved.length < 3) continue; // Need enough history

    const activeInDomain = tensionFile.signals.filter(
      (s) => s.domain === domain && !s.resolved
    );
    if (activeInDomain.length > 0) continue; // Already tracked

    // Predict recurrence for entities that had resolved tensions
    const entityFrequency = new Map<string, number>();
    for (const r of resolved) {
      for (const e of r.original.entities) {
        entityFrequency.set(e, (entityFrequency.get(e) ?? 0) + 1);
      }
    }

    for (const [entity, freq] of entityFrequency) {
      if (freq < 2) continue;
      predictions.push({
        entity_id: entity,
        predicted_tension_type: "weak_connection",
        confidence: Math.round(Math.min(freq * 0.15, 0.7) * 100) / 100,
        estimated_cycles_to_critical: Math.round(30 / freq),
        basis: `Entity "${entity}" in domain "${domain}" has had ${freq} resolved tensions. Historical pattern suggests recurrence.`,
      });
    }
  }

  return predictions.sort((a, b) => b.confidence - a.confidence).slice(0, 15);
}

// ---------------------------------------------------------------------------
// Seasonal Pattern Detection
// ---------------------------------------------------------------------------

/**
 * Detect seasonal patterns: domains that have cyclical tension activity.
 */
async function detectSeasonalPatterns(
  trajectories: TensionTrajectory[]
): Promise<SeasonalPattern[]> {
  const history = await engine.loadDreamHistory();
  const patterns: SeasonalPattern[] = [];

  // Group tensions-created per domain per cycle
  const domainActivity = new Map<string, Map<number, number>>();

  for (const entry of history.sessions) {
    // We don't have per-domain tension counts in history, so estimate
    // from trajectory data: count how many tensions per domain existed at each cycle
    for (const traj of trajectories) {
      const domain = traj.domain;
      if (!domainActivity.has(domain)) {
        domainActivity.set(domain, new Map());
      }
      const activity = domainActivity.get(domain)!;
      for (const point of traj.urgency_over_time) {
        if (point.urgency > 0.1) {
          const existing = activity.get(point.cycle) ?? 0;
          activity.set(point.cycle, existing + 1);
        }
      }
    }
  }

  // Look for periodic peaks
  for (const [domain, activity] of domainActivity) {
    const points = [...activity.entries()].sort((a, b) => a[0] - b[0]);
    if (points.length < 5) continue;

    // Find peaks (local maxima)
    const peaks: number[] = [];
    for (let i = 1; i < points.length - 1; i++) {
      if (points[i][1] > points[i - 1][1] && points[i][1] > points[i + 1][1]) {
        peaks.push(points[i][0]);
      }
    }

    if (peaks.length < 2) continue;

    // Calculate average period between peaks
    const periods: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      periods.push(peaks[i] - peaks[i - 1]);
    }
    const avgPeriod = Math.round(
      periods.reduce((a, b) => a + b, 0) / periods.length
    );

    if (avgPeriod < 3 || avgPeriod > 100) continue; // Filter noise

    const currentCycle = history.sessions.length > 0
      ? history.sessions[history.sessions.length - 1].cycle_number
      : 0;

    patterns.push({
      domain,
      period_cycles: avgPeriod,
      description: `Domain "${domain}" shows cyclical tension activity with ~${avgPeriod}-cycle period (${peaks.length} peaks detected)`,
      next_expected_peak: peaks[peaks.length - 1] + avgPeriod,
    });
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Retrocognition
// ---------------------------------------------------------------------------

/**
 * Find latent tensions that match the trajectories of previously resolved tensions.
 * "This latent tension looks like tension X did before it was resolved."
 */
async function findRetrocognitiveMatches(
  trajectories: TensionTrajectory[]
): Promise<Array<{ pattern: string; past_resolution: string; latent_matches: string[] }>> {
  const tensionFile = await engine.loadTensions();
  const matches: Array<{ pattern: string; past_resolution: string; latent_matches: string[] }> = [];

  // Get resolved trajectory patterns
  const resolvedTrajectories = trajectories.filter((t) => t.pattern === "resolved");
  const activeTrajectories = trajectories.filter(
    (t) => t.pattern !== "resolved"
  );

  for (const resolved of resolvedTrajectories) {
    // Find active tensions in the same domain with similar peak urgency
    const similar = activeTrajectories.filter(
      (t) =>
        t.domain === resolved.domain &&
        Math.abs(t.peak_urgency - resolved.peak_urgency) < 0.2
    );

    if (similar.length === 0) continue;

    const resolvedTension = tensionFile.resolved_tensions?.find(
      (r) => r.tension_id === resolved.tension_id
    );

    matches.push({
      pattern: `${resolved.domain} tension peaking at ~${resolved.peak_urgency.toFixed(2)}`,
      past_resolution: resolvedTension
        ? `Resolved as "${resolvedTension.resolution_type}"${resolvedTension.evidence ? `: ${resolvedTension.evidence}` : ""}`
        : "Resolution details unavailable",
      latent_matches: similar.map((s) => s.tension_id),
    });
  }

  return matches.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run temporal analysis across all available history.
 * Returns trajectories, predictions, seasonal patterns, and retrocognitive matches.
 */
export async function analyzeTemporalPatterns(): Promise<TemporalInsights> {
  logger.info("Temporal analysis starting");

  const history = await engine.loadDreamHistory();
  const trajectories = await buildTrajectories();
  logger.debug(`Built ${trajectories.length} tension trajectories`);

  const predictions = await predictFutureTensions(trajectories);
  logger.debug(`Generated ${predictions.length} temporal predictions`);

  const seasonal_patterns = await detectSeasonalPatterns(trajectories);
  logger.debug(`Detected ${seasonal_patterns.length} seasonal patterns`);

  const retrocognition = await findRetrocognitiveMatches(trajectories);
  logger.debug(`Found ${retrocognition.length} retrocognitive matches`);

  const sessions = history.sessions;
  const time_horizon = {
    total_cycles_analyzed: sessions.length,
    oldest_data: sessions.length > 0 ? sessions[0].timestamp : new Date().toISOString(),
    newest_data: sessions.length > 0 ? sessions[sessions.length - 1].timestamp : new Date().toISOString(),
  };

  logger.info(
    `Temporal analysis complete: ${trajectories.length} trajectories, ` +
    `${predictions.length} predictions, ${seasonal_patterns.length} seasonal patterns`
  );

  return {
    trajectories: trajectories.slice(0, 20),
    predictions,
    seasonal_patterns,
    retrocognition,
    time_horizon,
  };
}
