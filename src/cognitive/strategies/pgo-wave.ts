/**
 * Strategy 8 — PGO Wave (stochastic divergence).
 *
 * Lévy-flight pairing across domains plus stochastic-resonance confidence
 * banding produces creative noise that the normalizer can occasionally
 * convert into validated insight.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import { logger } from "../../utils/logger.js";
import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactEntity, type FactSnapshot } from "./_shared.js";

export function pgoWaveDream(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();
  const entityList = Array.from(snapshot.entities.values());

  if (entityList.length < 4) return edges;

  // --- Burst amplitude (geometric distribution) ---
  const burstP = 0.3;
  let burstSize = 1;
  while (Math.random() > burstP && burstSize < max) burstSize++;
  burstSize = Math.max(2, Math.min(burstSize, max));

  logger.debug(`PGO wave: burst amplitude ${burstSize} (budget: ${max})`);

  // --- Domain distance matrix (for Lévy flight) ---
  const domainList = Array.from(snapshot.domains);
  const domainIndex = new Map<string, number>();
  for (let i = domainList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [domainList[i], domainList[j]] = [domainList[j], domainList[i]];
  }
  domainList.forEach((d, i) => domainIndex.set(d, i));

  function levyTarget(source: FactEntity): FactEntity | null {
    const alpha = 1.5;
    const u = Math.random();
    const step = Math.floor(1.0 / Math.pow(Math.max(u, 0.001), 1.0 / alpha));

    const sourceDomIdx = domainIndex.get(source.domain) ?? 0;
    const candidates = entityList.filter((e) => e.id !== source.id);
    if (candidates.length === 0) return null;

    const withDist = candidates.map((e) => {
      const eDomIdx = domainIndex.get(e.domain) ?? 0;
      const domainDist = Math.abs(eDomIdx - sourceDomIdx);
      const sharedKw = source.keywords.filter((k) => e.keywords.includes(k)).length;
      const kwPenalty = Math.max(0, sharedKw * 0.3);
      return { entity: e, distance: Math.max(1, domainDist + 1 - kwPenalty) };
    });

    withDist.sort((a, b) => a.distance - b.distance);
    const idx = Math.min(step, withDist.length - 1);
    return withDist[idx].entity;
  }

  const pgoRelations = [
    "emergent_pattern",
    "hidden_dependency",
    "conceptual_bridge",
    "phantom_coupling",
    "resonance_link",
    "convergent_evolution",
    "shadow_interaction",
    "latent_composition",
  ];

  const usedPairs = new Set<string>();

  for (let i = 0; i < burstSize && edges.length < max; i++) {
    const source = entityList[Math.floor(Math.random() * entityList.length)];
    const target = levyTarget(source);
    if (!target) continue;

    const pairKey = `${source.id}|${target.id}`;
    const reversePairKey = `${target.id}|${source.id}`;
    if (usedPairs.has(pairKey) || usedPairs.has(reversePairKey)) continue;
    usedPairs.add(pairKey);

    if (snapshot.edgeSet.has(pairKey) || snapshot.edgeSet.has(reversePairKey)) continue;

    const sourceDomIdx = domainIndex.get(source.domain) ?? 0;
    const targetDomIdx = domainIndex.get(target.domain) ?? 0;
    const domainDist = Math.abs(sourceDomIdx - targetDomIdx);
    const maxDomainDist = Math.max(1, domainList.length - 1);
    const distFactor = domainDist / maxDomainDist;

    const confidence = Math.min(
      0.50,
      0.25 + distFactor * 0.15 + Math.random() * 0.10,
    );

    const relation = pgoRelations[Math.floor(Math.random() * pgoRelations.length)];

    const sharedKw = source.keywords.filter((k) => target.keywords.includes(k));
    const reasonParts = [
      `PGO wave: Lévy flight (step=${Math.round(domainDist)}) from "${source.name}" (${source.domain}) to "${target.name}" (${target.domain}).`,
    ];
    if (sharedKw.length > 0) {
      reasonParts.push(`Resonance via shared keywords [${sharedKw.join(", ")}].`);
    }
    if (distFactor > 0.5) {
      reasonParts.push("Cross-domain divergence — creative leap.");
    }

    edges.push({
      id: dreamId("pgo"),
      from: source.id,
      to: target.id,
      type: "hypothetical",
      relation,
      reason: reasonParts.join(" "),
      confidence: Math.round(confidence * 100) / 100,
      origin: "rem",
      created_at: now,
      dream_cycle: cycle,
      strategy: "pgo_wave",
      meta: {
        pgo_burst_size: burstSize,
        levy_domain_distance: domainDist,
        stochastic_resonance_band: [0.25, 0.50],
        relation_type: relation,
      },
      ttl: DEFAULT_DECAY.ttl,
      decay_rate: DEFAULT_DECAY.decay_rate * 1.2,
      reinforcement_count: 0,
      last_reinforced_cycle: cycle,
      status: "candidate",
      activation_score: 0,
      plausibility: 0,
      evidence_score: 0,
      contradiction_score: 0,
    });
  }

  if (edges.length > 0) {
    const crossDomain = edges.filter((e) => {
      const fromDom = snapshot.entities.get(e.from)?.domain;
      const toDom = snapshot.entities.get(e.to)?.domain;
      return fromDom !== toDom;
    }).length;
    logger.info(
      `PGO wave: ${edges.length} stochastic edges (${crossDomain} cross-domain, burst=${burstSize})`,
    );
  }

  return edges;
}
