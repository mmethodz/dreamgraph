/**
 * Strategy 5 — Symmetry Completion.
 *
 * Find directed edges A→B where the reverse B→A is missing and propose
 * the inverse with an inferred reverse-relationship name.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, inferReverseRelation, type FactSnapshot } from "./_shared.js";

export function symmetryCompletion(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of snapshot.entities.values()) {
    if (edges.length >= max) break;

    for (const link of entity.links) {
      if (edges.length >= max) break;

      if (snapshot.edgeSet.has(`${link.target}|${entity.id}`)) continue;

      const target = snapshot.entities.get(link.target);
      if (!target) continue;

      const reverseRelation = inferReverseRelation(link.relationship);

      edges.push({
        id: dreamId("sym"),
        from: link.target,
        to: entity.id,
        type: target.type,
        relation: reverseRelation,
        reason: `Symmetry: ${entity.id} → ${link.target} exists ("${link.relationship}") but reverse does not. Proposing "${reverseRelation}".`,
        confidence: 0.4,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "symmetry_completion",
        meta: {
          original_edge: `${entity.id} → ${link.target}`,
          original_relation: link.relationship,
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

  return edges;
}
