/**
 * Strategy 6 — Tension-Directed Dreaming.
 *
 * Use unresolved tension signals to focus dream generation on entities
 * the system is struggling with — goal-directed REM.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import type { DreamEdge, TensionSignal } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactSnapshot } from "./_shared.js";

export function tensionDirected(
  snapshot: FactSnapshot,
  tensions: TensionSignal[],
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  const sorted = [...tensions].sort((a, b) => b.urgency - a.urgency);

  for (const tension of sorted) {
    if (edges.length >= max) break;

    for (let i = 0; i < tension.entities.length && edges.length < max; i++) {
      const entityId = tension.entities[i];
      const entity = snapshot.entities.get(entityId);
      if (!entity) continue;

      for (const candidate of snapshot.entities.values()) {
        if (edges.length >= max) break;
        if (candidate.id === entityId) continue;
        if (
          snapshot.edgeSet.has(`${entityId}|${candidate.id}`) ||
          snapshot.edgeSet.has(`${candidate.id}|${entityId}`)
        ) {
          continue;
        }

        const sameDomain =
          entity.domain &&
          candidate.domain &&
          entity.domain === candidate.domain;
        const sharedKw = entity.keywords.filter((k) =>
          candidate.keywords.includes(k),
        );

        if (!sameDomain && sharedKw.length < 1) continue;

        const confidence =
          0.3 +
          (sameDomain ? 0.15 : 0) +
          Math.min(sharedKw.length * 0.1, 0.3) +
          tension.urgency * 0.15;

        edges.push({
          id: dreamId("tension"),
          from: entityId,
          to: candidate.id,
          type: entity.type === candidate.type ? entity.type : "hypothetical",
          relation: `tension_resolution_${tension.type}`,
          reason: `Tension-directed: resolving ${tension.type} for "${entity.name}" — "${candidate.name}" shares ${sameDomain ? `domain "${entity.domain}"` : ""}${sharedKw.length > 0 ? ` keywords [${sharedKw.join(", ")}]` : ""}. Tension urgency: ${tension.urgency}`,
          confidence: Math.round(Math.min(confidence, 1.0) * 100) / 100,
          origin: "rem",
          created_at: now,
          dream_cycle: cycle,
          strategy: "tension_directed",
          meta: {
            tension_id: tension.id,
            tension_type: tension.type,
            tension_urgency: tension.urgency,
          },
          ttl: DEFAULT_DECAY.ttl,
          decay_rate: DEFAULT_DECAY.decay_rate,
          reinforcement_count: 0,
          last_reinforced_cycle: cycle,
          status: "candidate",
          activation_score: 0,
          plausibility: 0,
          evidence_score: 0,
          contradiction_score: 0,
        });
      }
    }
  }

  return edges;
}
