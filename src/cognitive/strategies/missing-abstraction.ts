/**
 * Strategy 4 — Missing Abstraction.
 *
 * Find entities with multiple outgoing links of the same type whose
 * targets aren't well interconnected. Propose a hypothetical "hub"
 * entity that would unify the cluster.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import type { DreamEdge, DreamNode } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactSnapshot } from "./_shared.js";

export function missingAbstraction(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): { nodes: DreamNode[]; edges: DreamEdge[] } {
  const nodes: DreamNode[] = [];
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of snapshot.entities.values()) {
    if (nodes.length >= max) break;

    const byType = new Map<string, string[]>();
    for (const link of entity.links) {
      const list = byType.get(link.type) ?? [];
      list.push(link.target);
      byType.set(link.type, list);
    }

    for (const [linkType, targets] of byType) {
      if (nodes.length >= max) break;
      if (targets.length < 2) continue;

      let interconnections = 0;
      for (const t1 of targets) {
        for (const t2 of targets) {
          if (t1 !== t2 && snapshot.edgeSet.has(`${t1}|${t2}`)) {
            interconnections++;
          }
        }
      }

      const maxPossible = targets.length * (targets.length - 1);
      const density = maxPossible > 0 ? interconnections / maxPossible : 0;

      if (density > 0.3) continue;

      const targetNames = targets
        .map((t) => snapshot.entities.get(t)?.name ?? t)
        .slice(0, 4);

      const abstractionNode: DreamNode = {
        id: dreamId("abstraction"),
        type: "hypothetical_feature",
        name: `Unified ${entity.name} ${linkType} Hub`,
        description: `Hypothetical feature that would unify ${targets.length} ${linkType} entities connected to ${entity.name}: ${targetNames.join(", ")}${targets.length > 4 ? "..." : ""}. Currently these have low interconnection density (${Math.round(density * 100)}%).`,
        inspiration: [entity.id, ...targets.slice(0, 5)],
        confidence: 0.25 + (1 - density) * 0.3,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        ttl: DEFAULT_DECAY.ttl,
        decay_rate: DEFAULT_DECAY.decay_rate,
        reinforcement_count: 0,
        last_reinforced_cycle: cycle,
        status: "candidate",
        activation_score: 0,
      };

      nodes.push(abstractionNode);

      for (const target of targets.slice(0, 5)) {
        edges.push({
          id: dreamId("abs_edge"),
          from: abstractionNode.id,
          to: target,
          type: "hypothetical",
          relation: "would_unify",
          reason: `Hypothetical hub connecting currently sparse ${linkType} cluster around ${entity.name}`,
          confidence: abstractionNode.confidence * 0.8,
          origin: "rem",
          created_at: now,
          dream_cycle: cycle,
          strategy: "missing_abstraction",
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

  return { nodes, edges };
}
