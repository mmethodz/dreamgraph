/**
 * Strategy 2 — Weak Link Reinforcement.
 *
 * Find existing edges with strength "weak" and propose why they
 * might actually be stronger based on broader context.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactSnapshot } from "./_shared.js";

export function weakReinforcement(
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
      if (link.strength !== "weak") continue;

      const target = snapshot.entities.get(link.target);
      if (!target) continue;

      // Look for indirect support: do they share connections to a third entity?
      const entityTargets = new Set(entity.links.map((l) => l.target));
      const targetTargets = new Set(target.links.map((l) => l.target));
      const sharedConnections = [...entityTargets].filter((t) =>
        targetTargets.has(t)
      );

      if (sharedConnections.length === 0) continue;

      const confidence =
        0.3 + Math.min(sharedConnections.length * 0.15, 0.5);

      edges.push({
        id: dreamId("weak"),
        from: entity.id,
        to: target.id,
        type: entity.type,
        relation: `strengthened_${link.relationship}`,
        reason: `Existing weak edge "${link.relationship}" may be stronger: ${entity.id} and ${target.id} share ${sharedConnections.length} common connections [${sharedConnections.slice(0, 3).join(", ")}${sharedConnections.length > 3 ? "..." : ""}]`,
        confidence: Math.round(confidence * 100) / 100,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "weak_reinforcement",
        meta: {
          original_strength: "weak",
          shared_connections: sharedConnections,
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
