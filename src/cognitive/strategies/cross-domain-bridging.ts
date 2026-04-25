/**
 * Strategy 3 — Cross-Domain Bridging.
 *
 * Connect entities from different domains that share keywords or
 * description tokens. When explicit domains are missing, infers
 * pseudo-domains from entity type + source repo.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactEntity, type FactSnapshot } from "./_shared.js";

export function crossDomainBridging(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();

  // Infer domain: explicit domain > type+repo > type
  const inferDomain = (e: FactEntity): string => {
    if (e.domain) return e.domain;
    if (e.source_repo) return `${e.type}:${e.source_repo}`;
    return e.type;
  };

  // Group entities by inferred domain
  const byDomain = new Map<string, FactEntity[]>();
  for (const entity of snapshot.entities.values()) {
    const d = inferDomain(entity);
    const list = byDomain.get(d) ?? [];
    list.push(entity);
    byDomain.set(d, list);
  }

  // Need at least 2 distinct domains to bridge
  if (byDomain.size < 2) return edges;

  const domainPairs = Array.from(byDomain.keys());

  for (let i = 0; i < domainPairs.length && edges.length < max; i++) {
    for (
      let j = i + 1;
      j < domainPairs.length && edges.length < max;
      j++
    ) {
      const domainA = domainPairs[i];
      const domainB = domainPairs[j];
      const entitiesA = byDomain.get(domainA) ?? [];
      const entitiesB = byDomain.get(domainB) ?? [];

      for (const a of entitiesA) {
        if (edges.length >= max) break;
        for (const b of entitiesB) {
          if (edges.length >= max) break;

          // Skip existing edges
          if (
            snapshot.edgeSet.has(`${a.id}|${b.id}`) ||
            snapshot.edgeSet.has(`${b.id}|${a.id}`)
          ) {
            continue;
          }

          const sharedKeywords = a.keywords.filter((k) =>
            b.keywords.includes(k)
          );

          // Description token overlap as fallback when keywords are sparse
          let descOverlap = 0;
          if (a.descriptionTokens.size > 0 && b.descriptionTokens.size > 0) {
            for (const token of a.descriptionTokens) {
              if (b.descriptionTokens.has(token)) descOverlap++;
            }
          }

          // Need either keyword overlap OR strong description token overlap
          if (sharedKeywords.length < 2 && descOverlap < 3) continue;

          const confidence =
            0.2 +
            Math.min(sharedKeywords.length * 0.12, 0.4) +
            Math.min(descOverlap * 0.03, 0.2);

          const reasons: string[] = [];
          if (sharedKeywords.length > 0) reasons.push(`keywords [${sharedKeywords.join(", ")}]`);
          if (descOverlap > 0) reasons.push(`${descOverlap} shared description terms`);

          edges.push({
            id: dreamId("bridge"),
            from: a.id,
            to: b.id,
            type: "hypothetical",
            relation: `cross_domain_bridge_${domainA}_${domainB}`,
            reason: `Cross-domain connection: "${a.name}" (${domainA}) and "${b.name}" (${domainB}) share ${reasons.join(" and ")}`,
            confidence: Math.round(Math.min(confidence, 0.85) * 100) / 100,
            origin: "rem",
            created_at: now,
            dream_cycle: cycle,
            strategy: "cross_domain",
            meta: {
              domain_a: domainA,
              domain_b: domainB,
              shared_keywords: sharedKeywords,
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
  }

  return edges;
}
