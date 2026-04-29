/**
 * Strategy — Orphan Bridging.
 *
 * Locate degree-0 (and very low degree) fact-graph entities and propose
 * weak edges to their nearest plausible neighbor. Other strategies
 * (gap-detection, cross-domain) require pre-existing affinity signals
 * (multiple shared keywords, several description-token overlaps, shared
 * source files). Entities with sparse metadata never satisfy those gates
 * and remain isolated indefinitely, producing the long tail of orphan
 * nodes visible in the Explorer graph view.
 *
 * This strategy uses RELAXED signals so that every node has a chance of
 * being attached to the rest of the graph:
 *   - same source_repo + ANY single keyword/desc-token overlap
 *   - same domain
 *   - sibling source-file directory (e.g. both in `src/cognitive/`)
 *   - name-token Jaccard overlap (handles cases with no description)
 *
 * The normalizer still gates promotion (confidence + evidence + count),
 * so weak proposals that lack downstream evidence will fall to "latent"
 * or "rejected" rather than polluting the validated edge set.
 */

import type { DreamEdge } from "../types.js";
import { DEFAULT_DECAY } from "../types.js";
import { dreamId, tokenize, type FactEntity, type FactSnapshot } from "./_shared.js";

interface Candidate {
  target: FactEntity;
  score: number;
  signals: string[];
}

const MAX_PROPOSALS_PER_ORPHAN = 2;
const MIN_SCORE = 0.18;

/** Strip filename, lower-case the parent directory of a source-file path. */
function dirOf(path: string): string {
  if (!path) return "";
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx).toLowerCase() : "";
}

/** Tokenize an entity name (split on snake_case, kebab, camelCase, dots). */
function nameTokens(name: string): Set<string> {
  if (!name) return new Set();
  const split = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._\-/\\]+/g, " ");
  return tokenize(split);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export function orphanBridging(
  snapshot: FactSnapshot,
  cycle: number,
  max: number,
): DreamEdge[] {
  const edges: DreamEdge[] = [];
  const now = new Date().toISOString();
  const all = Array.from(snapshot.entities.values());
  if (all.length < 2) return edges;

  // Pre-compute name tokens and source dirs once per entity.
  const nameTokenCache = new Map<string, Set<string>>();
  const dirCache = new Map<string, Set<string>>();
  for (const e of all) {
    nameTokenCache.set(e.id, nameTokens(e.name));
    const dirs = new Set<string>();
    for (const f of e.source_files) {
      const d = dirOf(f);
      if (d) dirs.add(d);
    }
    dirCache.set(e.id, dirs);
  }

  // Collect orphans (degree 0). Process lowest-id-first for determinism.
  const orphans = all
    .filter((e) => (snapshot.degree.get(e.id) ?? 0) === 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const orphan of orphans) {
    if (edges.length >= max) break;

    const orphanNames = nameTokenCache.get(orphan.id) ?? new Set<string>();
    const orphanDirs = dirCache.get(orphan.id) ?? new Set<string>();
    const orphanKeywords = new Set(orphan.keywords);

    const candidates: Candidate[] = [];

    for (const other of all) {
      if (other.id === orphan.id) continue;

      const signals: string[] = [];
      let score = 0;

      // ---- Repo affinity (necessary baseline for most signals) ----
      const sameRepo =
        !!orphan.source_repo &&
        !!other.source_repo &&
        orphan.source_repo === other.source_repo;

      // ---- Domain match ----
      if (orphan.domain && other.domain && orphan.domain === other.domain) {
        score += 0.25;
        signals.push(`domain "${orphan.domain}"`);
      }

      // ---- Keyword overlap (single match counts) ----
      const sharedKeywords: string[] = [];
      for (const k of orphan.keywords) {
        if (other.keywords.includes(k)) sharedKeywords.push(k);
      }
      if (sharedKeywords.length > 0) {
        score += Math.min(sharedKeywords.length * 0.12, 0.3);
        signals.push(`keyword${sharedKeywords.length > 1 ? "s" : ""} [${sharedKeywords.join(", ")}]`);
      }

      // ---- Description token overlap (1+ counts) ----
      let descOverlap = 0;
      if (orphan.descriptionTokens.size > 0 && other.descriptionTokens.size > 0) {
        for (const t of orphan.descriptionTokens) {
          if (other.descriptionTokens.has(t)) descOverlap++;
        }
        if (descOverlap > 0) {
          score += Math.min(descOverlap * 0.04, 0.18);
          signals.push(`${descOverlap} desc terms`);
        }
      }

      // ---- Sibling source-file directory ----
      const otherDirs = dirCache.get(other.id) ?? new Set<string>();
      let sharedDirs = 0;
      for (const d of orphanDirs) if (otherDirs.has(d)) sharedDirs++;
      if (sharedDirs > 0) {
        score += Math.min(sharedDirs * 0.18, 0.3);
        signals.push(`${sharedDirs} sibling director${sharedDirs > 1 ? "ies" : "y"}`);
      }

      // ---- Name-token Jaccard (only useful when ≥0.25 to avoid noise) ----
      const otherNames = nameTokenCache.get(other.id) ?? new Set<string>();
      const nameJ = jaccard(orphanNames, otherNames);
      if (nameJ >= 0.25) {
        score += Math.min(nameJ * 0.4, 0.25);
        signals.push(`name overlap ${nameJ.toFixed(2)}`);
      }

      // ---- Repo bonus (only when at least one other signal fired) ----
      if (sameRepo && signals.length > 0) {
        score += 0.05;
      }

      // Skip if both endpoints are orphans with no real signals beyond
      // repo membership — would create chains of weakly-bound orphans.
      const otherDeg = snapshot.degree.get(other.id) ?? 0;
      if (otherDeg === 0 && score < 0.35) continue;

      // Skip if edge already exists either direction.
      if (
        snapshot.edgeSet.has(`${orphan.id}|${other.id}`) ||
        snapshot.edgeSet.has(`${other.id}|${orphan.id}`)
      ) {
        continue;
      }

      if (score < MIN_SCORE) continue;
      candidates.push({ target: other, score, signals });
    }

    if (candidates.length === 0) continue;

    candidates.sort((a, b) => b.score - a.score);
    const picks = candidates.slice(0, MAX_PROPOSALS_PER_ORPHAN);

    for (const pick of picks) {
      if (edges.length >= max) break;
      const confidence = Math.min(0.3 + pick.score, 0.55);
      const relation =
        orphan.type === pick.target.type
          ? `related_${orphan.type}`
          : `related_${orphan.type}_${pick.target.type}`;

      edges.push({
        id: dreamId("orph"),
        from: orphan.id,
        to: pick.target.id,
        type: orphan.type === pick.target.type ? orphan.type : "hypothetical",
        relation,
        reason: `Orphan bridging: "${orphan.name}" has no edges; nearest neighbor "${pick.target.name}" via ${pick.signals.join(", ")}.`,
        confidence: Math.round(confidence * 100) / 100,
        origin: "rem",
        created_at: now,
        dream_cycle: cycle,
        strategy: "orphan_bridging",
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

      // Mark provisional edge so subsequent orphans don't re-pick the same target.
      snapshot.edgeSet.add(`${orphan.id}|${pick.target.id}`);
    }
  }

  return edges;
}
