/**
 * Strategy 1 — Gap Detection.
 *
 * Find entity pairs that share domain, keywords, description tokens, or
 * source files but have no direct edge. These are "nearby but unconnected"
 * — potential hidden relationships.
 *
 * Resilient to sparse data: works even when domain/keywords are empty
 * by falling back to description token overlap and shared source files.
 *
 * Extracted from `dreamer.ts` (F-06).
 */

import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, type FactSnapshot } from "./_shared.js";

export function gapDetection(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const entityList = Array.from(snapshot.entities.values());
  const now = new Date().toISOString();

  for (let i = 0; i < entityList.length && edges.length < max; i++) {
    for (let j = i + 1; j < entityList.length && edges.length < max; j++) {
      const a = entityList[i];
      const b = entityList[j];

      // Skip if edge already exists in either direction
      if (
        snapshot.edgeSet.has(`${a.id}|${b.id}`) ||
        snapshot.edgeSet.has(`${b.id}|${a.id}`)
      ) {
        continue;
      }

      // ---- Affinity signals (any can trigger a dream edge) ----
      const sameDomain = !!(a.domain && b.domain && a.domain === b.domain);
      const sharedKeywords = a.keywords.filter((k) => b.keywords.includes(k));
      const sameRepo = !!(a.source_repo && b.source_repo && a.source_repo === b.source_repo);

      // Description token overlap (semantic affinity from descriptions)
      let descOverlap = 0;
      if (a.descriptionTokens.size > 0 && b.descriptionTokens.size > 0) {
        for (const token of a.descriptionTokens) {
          if (b.descriptionTokens.has(token)) descOverlap++;
        }
      }

      // Shared source files (structural coupling)
      let sharedFiles = 0;
      for (const file of a.source_files) {
        if (b.source_files.includes(file)) sharedFiles++;
      }
      // Also check if any source files are co-indexed (different entities in same file)
      let coIndexedFiles = 0;
      for (const file of a.source_files) {
        const indexed = snapshot.sourceFileIndex.get(file);
        if (indexed && indexed.includes(b.id)) coIndexedFiles++;
      }

      // ---- Threshold: need at least one meaningful signal ----
      const hasSignal =
        sameDomain ||
        sharedKeywords.length >= 2 ||
        descOverlap >= 3 ||
        sharedFiles > 0 ||
        coIndexedFiles > 0 ||
        (sameRepo && (descOverlap >= 2 || sharedKeywords.length >= 1));

      if (!hasSignal) continue;

      // ---- Build confidence from all signals ----
      const confidence =
        (sameDomain ? 0.25 : 0) +
        Math.min(sharedKeywords.length * 0.1, 0.3) +
        (sameRepo ? 0.1 : 0) +
        Math.min(descOverlap * 0.04, 0.25) +
        Math.min(sharedFiles * 0.15, 0.3) +
        Math.min(coIndexedFiles * 0.1, 0.2);

      // Build reason listing all detected signals
      const reasons: string[] = [];
      if (sameDomain) reasons.push(`domain "${a.domain}"`);
      if (sharedKeywords.length > 0) reasons.push(`keywords [${sharedKeywords.join(", ")}]`);
      if (descOverlap > 0) reasons.push(`${descOverlap} shared description terms`);
      if (sharedFiles > 0) reasons.push(`${sharedFiles} shared source files`);
      if (coIndexedFiles > 0) reasons.push(`${coIndexedFiles} co-indexed files`);
      if (sameRepo) reasons.push(`same repo "${a.source_repo}"`);

      edges.push({
        id: dreamId("gap"),
        from: a.id,
        to: b.id,
        type: a.type === b.type ? a.type : "hypothetical",
        relation: `potential_${a.type}_${b.type}_connection`,
        reason: `Entities "${a.name}" and "${b.name}" share ${reasons.join(", ")} but have no direct edge`,
        confidence: Math.round(Math.min(confidence, 0.95) * 100) / 100,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "gap_detection",
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
