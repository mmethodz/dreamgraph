/**
 * DreamGraph Cognitive Normalizer — Three-outcome classifier.
 *
 * The normalizer is a strict critic that validates dream artifacts
 * against the Fact Graph. It acts as a firewall between imagination
 * and production truth.
 *
 * Three-outcome classification (speculative memory):
 * - validated:  Strong evidence, structurally grounded, no contradictions → promote
 * - latent:     Plausible, structurally valid, but evidence too weak → keep in dream space
 * - rejected:   Contradicted, malformed, or low-value noise → discard
 *
 * Split scoring:
 * - plausibility: structural/semantic fit (domain, keyword, repo coherence)
 * - evidence:     grounding in actual graph data (entity existence, shared connections)
 * - contradiction: severity of conflicts (0 = none, 1 = fatal)
 * - confidence:   combined score = plausibility × 0.45 + evidence × 0.45 + bonus − penalty
 *
 * Two-threshold promotion:
 * - confidence >= 0.62 AND plausibility >= 0.45 AND evidence >= 0.4 AND evidence_count >= 2
 *   → validated (promoted to fact-adjacent space)
 * - plausibility >= 0.35 AND not contradicted → latent (kept in speculative memory)
 * - everything else → rejected
 *
 * NORMALIZING state is REQUIRED. Engine enforces this.
 */

import { loadJsonData } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import { engine } from "./engine.js";
import type { Feature, Workflow, DataModelEntity } from "../types/index.js";
import type {
  DreamEdge,
  DreamNode,
  ValidationResult,
  ValidationEvidence,
  ValidatedEdge,
  NormalizationOutcome,
  NormalizationReasonCode,
} from "./types.js";
import { countEvidence, computeConfidence, DEFAULT_PROMOTION } from "./types.js";

// ---------------------------------------------------------------------------
// Fact Graph lookup structures
// ---------------------------------------------------------------------------

interface FactLookup {
  /** All entity IDs that exist in the fact graph */
  entityIds: Set<string>;
  /** Entity → domain mapping */
  domains: Map<string, string>;
  /** Entity → keywords mapping */
  keywords: Map<string, string[]>;
  /** Entity → source_repo mapping */
  repos: Map<string, string>;
  /** Entity → type mapping */
  types: Map<string, "feature" | "workflow" | "data_model">;
  /** Set of "from|to" for existing edges */
  edgeSet: Set<string>;
  /** Workflow step orderings for consistency checks */
  workflowSteps: Map<string, string[]>;
}

async function buildFactLookup(): Promise<FactLookup> {
  const [features, workflows, dataModel] = await Promise.all([
    loadJsonData<Feature[]>("features.json"),
    loadJsonData<Workflow[]>("workflows.json"),
    loadJsonData<DataModelEntity[]>("data_model.json"),
  ]);

  const lookup: FactLookup = {
    entityIds: new Set(),
    domains: new Map(),
    keywords: new Map(),
    repos: new Map(),
    types: new Map(),
    edgeSet: new Set(),
    workflowSteps: new Map(),
  };

  for (const f of features) {
    lookup.entityIds.add(f.id);
    lookup.domains.set(f.id, f.domain ?? "");
    lookup.keywords.set(f.id, f.keywords ?? []);
    lookup.repos.set(f.id, f.source_repo);
    lookup.types.set(f.id, "feature");
    for (const link of f.links ?? []) {
      lookup.edgeSet.add(`${f.id}|${link.target}`);
    }
  }

  for (const w of workflows) {
    lookup.entityIds.add(w.id);
    lookup.domains.set(w.id, w.domain ?? "");
    lookup.keywords.set(w.id, w.keywords ?? []);
    lookup.repos.set(w.id, w.source_repo);
    lookup.types.set(w.id, "workflow");
    // Store step ordering for consistency checks
    lookup.workflowSteps.set(
      w.id,
      (w.steps ?? []).map((s) => s.name)
    );
    for (const link of w.links ?? []) {
      lookup.edgeSet.add(`${w.id}|${link.target}`);
    }
  }

  for (const e of dataModel) {
    lookup.entityIds.add(e.id);
    lookup.domains.set(e.id, e.domain ?? "");
    lookup.keywords.set(e.id, e.keywords ?? []);
    lookup.repos.set(e.id, e.source_repo);
    lookup.types.set(e.id, "data_model");
    for (const link of e.links ?? []) {
      lookup.edgeSet.add(`${e.id}|${link.target}`);
    }
  }

  return lookup;
}

// ---------------------------------------------------------------------------
// Validation checks
// ---------------------------------------------------------------------------

function checkEntityGrounding(
  edge: DreamEdge,
  lookup: FactLookup
): { fromExists: boolean; toExists: boolean } {
  return {
    fromExists: lookup.entityIds.has(edge.from),
    toExists: lookup.entityIds.has(edge.to),
  };
}

function checkDomainCoherence(
  edge: DreamEdge,
  lookup: FactLookup
): string[] {
  const domainA = lookup.domains.get(edge.from) ?? "";
  const domainB = lookup.domains.get(edge.to) ?? "";
  const overlap: string[] = [];
  if (domainA && domainB && domainA === domainB) {
    overlap.push(domainA);
  }
  return overlap;
}

function checkKeywordOverlap(
  edge: DreamEdge,
  lookup: FactLookup
): string[] {
  const kwA = lookup.keywords.get(edge.from) ?? [];
  const kwB = lookup.keywords.get(edge.to) ?? [];
  return kwA.filter((k) => kwB.includes(k));
}

function checkRepoCoherence(
  edge: DreamEdge,
  lookup: FactLookup
): boolean {
  const repoA = lookup.repos.get(edge.from) ?? "";
  const repoB = lookup.repos.get(edge.to) ?? "";
  if (!repoA || !repoB) return false;
  return repoA === repoB || repoA === "both" || repoB === "both";
}

function checkDuplicate(
  edge: DreamEdge,
  lookup: FactLookup
): boolean {
  return (
    lookup.edgeSet.has(`${edge.from}|${edge.to}`) ||
    lookup.edgeSet.has(`${edge.to}|${edge.from}`)
  );
}

function findContradictions(
  edge: DreamEdge,
  lookup: FactLookup
): string[] {
  const contradictions: string[] = [];

  // Check if the edge's from/to types conflict with the claimed type
  const fromType = lookup.types.get(edge.from);
  const toType = lookup.types.get(edge.to);

  if (
    edge.type !== "hypothetical" &&
    fromType &&
    toType &&
    edge.type !== fromType &&
    edge.type !== toType
  ) {
    contradictions.push(
      `Edge type "${edge.type}" doesn't match entity types: ${edge.from} is ${fromType}, ${edge.to} is ${toType}`
    );
  }

  return contradictions;
}

// ---------------------------------------------------------------------------
// Score calculation — split scoring (plausibility / evidence / contradiction)
// ---------------------------------------------------------------------------

interface SplitScore {
  plausibility: number;    // structural/semantic fit (0–1)
  evidence: number;        // grounding in actual graph (0–1)
  contradiction: number;   // conflict severity (0–1)
  confidence: number;      // combined score
  outcome: NormalizationOutcome;
  reason_code: NormalizationReasonCode;
}

function calculateSplitScore(
  grounding: { fromExists: boolean; toExists: boolean },
  domainOverlap: string[],
  keywordOverlap: string[],
  repoMatch: boolean,
  isDuplicate: boolean,
  contradictions: string[],
  originalConfidence: number,
  reinforcementCount: number
): SplitScore {
  // --- Contradiction Score (0–1) ---
  let contradictionScore = 0;
  if (!grounding.fromExists && !grounding.toExists) {
    contradictionScore = 0.9; // both endpoints missing = almost fatal
  } else if (!grounding.fromExists || !grounding.toExists) {
    // One endpoint missing ≠ contradiction — it may not exist *yet*
    // This is "insufficient evidence", not "bad evidence"
    contradictionScore = 0;
  }
  if (isDuplicate) {
    contradictionScore = Math.max(contradictionScore, 0.8); // hard duplicate
  }
  if (contradictions.length > 0) {
    contradictionScore = Math.max(
      contradictionScore,
      Math.min(contradictions.length * 0.4, 1.0)
    );
  }

  // --- Plausibility Score (0–1): structural/semantic fit ---
  let plausibility = 0;
  // Domain coherence contributes strongly to plausibility
  if (domainOverlap.length > 0) plausibility += 0.35;
  // Keyword overlap is structural fit
  plausibility += Math.min(keywordOverlap.length * 0.1, 0.35);
  // Repo coherence implies architectural relatedness
  if (repoMatch) plausibility += 0.15;
  // Original dreamer confidence reflects pattern quality
  plausibility += originalConfidence * 0.15;
  plausibility = Math.round(Math.min(Math.max(plausibility, 0), 1) * 100) / 100;

  // --- Evidence Score (0–1): grounding in actual data ---
  let evidenceScore = 0;
  // Entity grounding is the strongest evidence signal
  if (grounding.fromExists) evidenceScore += 0.25;
  if (grounding.toExists) evidenceScore += 0.25;
  // Domain overlap also counts as evidence of factual alignment
  if (domainOverlap.length > 0) evidenceScore += 0.2;
  // Keyword matches are evidence of semantic grounding
  evidenceScore += Math.min(keywordOverlap.length * 0.05, 0.15);
  // Repo match is factual evidence
  if (repoMatch) evidenceScore += 0.15;
  evidenceScore = Math.round(Math.min(Math.max(evidenceScore, 0), 1) * 100) / 100;

  // --- Combined Confidence ---
  const confidence = computeConfidence(
    plausibility,
    evidenceScore,
    reinforcementCount,
    contradictionScore
  );

  // --- Three-outcome classification ---
  let outcome: NormalizationOutcome;
  let reason_code: NormalizationReasonCode;

  if (contradictionScore >= DEFAULT_PROMOTION.max_contradiction) {
    // High contradiction = reject
    outcome = "rejected";
    reason_code = isDuplicate ? "low_signal" :
      (!grounding.fromExists && !grounding.toExists) ? "invalid_endpoints" :
      "contradicted";
  } else if (
    confidence >= DEFAULT_PROMOTION.promotion_confidence &&
    plausibility >= DEFAULT_PROMOTION.promotion_plausibility &&
    evidenceScore >= DEFAULT_PROMOTION.promotion_evidence
  ) {
    // Strong on all axes = validate
    outcome = "validated";
    reason_code = "strong_evidence";
  } else if (plausibility >= DEFAULT_PROMOTION.retention_plausibility) {
    // Plausible but not proven = latent (speculative memory)
    outcome = "latent";
    reason_code = "insufficient_evidence";
  } else {
    // Low plausibility = reject (noise)
    outcome = "rejected";
    reason_code = "low_signal";
  }

  return {
    plausibility,
    evidence: evidenceScore,
    contradiction: contradictionScore,
    confidence,
    outcome,
    reason_code,
  };
}

// ---------------------------------------------------------------------------
// Validate a single edge
// ---------------------------------------------------------------------------

function validateEdge(
  edge: DreamEdge,
  lookup: FactLookup,
  cycle: number
): ValidationResult {
  const grounding = checkEntityGrounding(edge, lookup);
  const domainOverlap = checkDomainCoherence(edge, lookup);
  const keywordOverlap = checkKeywordOverlap(edge, lookup);
  const repoMatch = checkRepoCoherence(edge, lookup);
  const isDuplicate = checkDuplicate(edge, lookup);
  const contradictions = findContradictions(edge, lookup);

  // Find shared entities (entities connected to both from and to)
  const sharedEntities: string[] = [];
  for (const entityId of lookup.entityIds) {
    if (entityId === edge.from || entityId === edge.to) continue;
    const forwardA = lookup.edgeSet.has(`${edge.from}|${entityId}`);
    const forwardB = lookup.edgeSet.has(`${edge.to}|${entityId}`);
    if (forwardA && forwardB) {
      sharedEntities.push(entityId);
    }
  }

  // Find shared workflows
  const sharedWorkflows: string[] = [];
  for (const [wfId, _steps] of lookup.workflowSteps) {
    const wfLinksFrom = lookup.edgeSet.has(`${wfId}|${edge.from}`);
    const wfLinksTo = lookup.edgeSet.has(`${wfId}|${edge.to}`);
    if (wfLinksFrom && wfLinksTo) {
      sharedWorkflows.push(wfId);
    }
  }

  const { plausibility, evidence, contradiction, confidence, outcome, reason_code } = calculateSplitScore(
    grounding,
    domainOverlap,
    keywordOverlap,
    repoMatch,
    isDuplicate,
    contradictions,
    edge.confidence,
    edge.reinforcement_count ?? 0
  );

  const evidenceObj: ValidationEvidence = {
    shared_entities: sharedEntities.slice(0, 10),
    shared_workflows: sharedWorkflows,
    domain_overlap: domainOverlap,
    keyword_overlap: keywordOverlap,
    source_repo_match: repoMatch,
    contradictions,
  };

  // Build reason
  const parts: string[] = [];
  if (!grounding.fromExists) parts.push(`"${edge.from}" not in fact graph`);
  if (!grounding.toExists) parts.push(`"${edge.to}" not in fact graph`);
  if (isDuplicate) parts.push("duplicate of existing edge");
  if (contradictions.length > 0)
    parts.push(`contradictions: ${contradictions.join("; ")}`);
  if (domainOverlap.length > 0)
    parts.push(`shared domain: ${domainOverlap.join(", ")}`);
  if (keywordOverlap.length > 0)
    parts.push(`shared keywords: ${keywordOverlap.join(", ")}`);
  if (sharedEntities.length > 0)
    parts.push(`${sharedEntities.length} shared connections`);
  if (sharedWorkflows.length > 0)
    parts.push(`${sharedWorkflows.length} shared workflows`);

  const reason =
    parts.length > 0 ? parts.join(". ") + "." : "Insufficient evidence.";

  const evidenceCount = countEvidence(evidenceObj);

  return {
    dream_id: edge.id,
    dream_type: "edge",
    status: outcome,
    confidence,
    plausibility,
    evidence_score: evidence,
    contradiction_score: contradiction,
    evidence: evidenceObj,
    evidence_count: evidenceCount,
    reason_code,
    reason,
    validated_at: new Date().toISOString(),
    normalization_cycle: cycle,
  };
}

// ---------------------------------------------------------------------------
// Validate a single node
// ---------------------------------------------------------------------------

function validateNode(
  node: DreamNode,
  lookup: FactLookup,
  cycle: number
): ValidationResult {
  // Check if inspiration entities exist
  const existingInspirations = node.inspiration.filter((id) =>
    lookup.entityIds.has(id)
  );
  const groundingRatio =
    node.inspiration.length > 0
      ? existingInspirations.length / node.inspiration.length
      : 0;

  // Check domain/keyword coherence across inspirations
  const inspirationDomains = existingInspirations
    .map((id) => lookup.domains.get(id) ?? "")
    .filter(Boolean);
  const uniqueDomains = [...new Set(inspirationDomains)];

  const allKeywords = existingInspirations.flatMap(
    (id) => lookup.keywords.get(id) ?? []
  );
  const keywordCounts = new Map<string, number>();
  for (const kw of allKeywords) {
    keywordCounts.set(kw, (keywordCounts.get(kw) ?? 0) + 1);
  }
  const sharedKeywords = [...keywordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([kw]) => kw);

  // Split scoring for nodes
  let plausibility =
    (uniqueDomains.length === 1 ? 0.35 : uniqueDomains.length <= 2 ? 0.2 : 0.05) +
    Math.min(sharedKeywords.length * 0.1, 0.35) +
    node.confidence * 0.15;
  plausibility = Math.round(Math.min(Math.max(plausibility, 0), 1) * 100) / 100;

  let evidenceScore = groundingRatio * 0.5 +
    (uniqueDomains.length > 0 ? 0.2 : 0) +
    Math.min(sharedKeywords.length * 0.05, 0.15);
  evidenceScore = Math.round(Math.min(Math.max(evidenceScore, 0), 1) * 100) / 100;

  const contradictionScore = 0; // nodes don't have structural contradictions

  const confidence = computeConfidence(
    plausibility,
    evidenceScore,
    node.reinforcement_count ?? 0,
    contradictionScore
  );

  let outcome: NormalizationOutcome;
  let reason_code: NormalizationReasonCode;
  if (
    confidence >= DEFAULT_PROMOTION.promotion_confidence &&
    plausibility >= DEFAULT_PROMOTION.promotion_plausibility &&
    groundingRatio >= 0.5
  ) {
    outcome = "validated";
    reason_code = "strong_evidence";
  } else if (plausibility >= DEFAULT_PROMOTION.retention_plausibility) {
    outcome = "latent";
    reason_code = "insufficient_evidence";
  } else {
    outcome = "rejected";
    reason_code = "low_signal";
  }

  const evidenceObj: ValidationEvidence = {
    shared_entities: existingInspirations,
    shared_workflows: [],
    domain_overlap: uniqueDomains,
    keyword_overlap: sharedKeywords,
    source_repo_match: false,
    contradictions: [],
  };

  const reason = `${existingInspirations.length}/${node.inspiration.length} inspirations grounded. ${uniqueDomains.length} domain(s). ${sharedKeywords.length} shared keywords.`;

  const evidenceCount = countEvidence(evidenceObj);

  return {
    dream_id: node.id,
    dream_type: "node",
    status: outcome,
    confidence,
    plausibility,
    evidence_score: evidenceScore,
    contradiction_score: contradictionScore,
    evidence: evidenceObj,
    evidence_count: evidenceCount,
    reason_code,
    reason,
    validated_at: new Date().toISOString(),
    normalization_cycle: cycle,
  };
}

// ---------------------------------------------------------------------------
// Edge promotion — three-outcome gate uses PromotionConfig thresholds
// ---------------------------------------------------------------------------

function promoteToValidatedEdge(
  edge: DreamEdge,
  result: ValidationResult
): ValidatedEdge | null {
  // Only "validated" outcome edges pass
  if (result.status !== "validated") return null;

  // Must have at least min_evidence_count distinct evidence signals
  if (result.evidence_count < DEFAULT_PROMOTION.promotion_evidence_count) return null;

  // Only edges between real fact graph entities can be promoted
  const validTypes = ["feature", "workflow", "data_model"] as const;
  const edgeType = validTypes.find((t) => t === edge.type);
  if (!edgeType && edge.type !== "hypothetical") return null;

  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    type: edgeType ?? "feature",
    relation: edge.relation,
    description: edge.reason,
    confidence: result.confidence,
    plausibility: result.plausibility,
    evidence_score: result.evidence_score,
    origin: "rem",
    status: "validated",
    evidence_summary: result.reason,
    evidence_count: result.evidence_count,
    reinforcement_count: edge.reinforcement_count ?? 0,
    dream_cycle: edge.dream_cycle,
    normalization_cycle: result.normalization_cycle,
    validated_at: result.validated_at,
  };
}

// ---------------------------------------------------------------------------
// Public API — Normalize
// ---------------------------------------------------------------------------

export interface NormalizationResult {
  cycle: number;
  processed: number;
  validated: number;
  latent: number;
  rejected: number;
  blockedByGate: number;
  promotedEdges: ValidatedEdge[];
}

/**
 * Run normalization on all unvalidated dream graph items.
 *
 * Three-outcome classifier (speculative memory):
 * - validated:  Strong evidence → promote to fact-adjacent space
 * - latent:     Plausible but insufficient evidence → keep in dream space
 * - rejected:   Contradicted, malformed, or noise → discard
 *
 * Latent edges remain in the dream graph as speculative memory.
 * They may be validated in future cycles when new evidence appears.
 *
 * PRECONDITION: Engine must be in NORMALIZING state.
 */
export async function normalize(
  threshold: number = DEFAULT_PROMOTION.promotion_confidence,
  strict: boolean = false
): Promise<NormalizationResult> {
  engine.assertState("normalizing", "normalize");

  const cycle = engine.nextNormalizationCycle();
  logger.info(
    `Normalization cycle #${cycle} starting (threshold: ${threshold}, strict: ${strict})`
  );

  // Load fact graph and dream graph
  const [lookup, dreamGraph, existingCandidates] = await Promise.all([
    buildFactLookup(),
    engine.loadDreamGraph(),
    engine.loadCandidateEdges(),
  ]);

  // Track which dream IDs have already been validated
  const alreadyValidated = new Set(existingCandidates.results.map((r) => r.dream_id));

  // Validate all unvalidated edges
  const newResults: ValidationResult[] = [];
  const promotedEdges: ValidatedEdge[] = [];
  let blockedByGate = 0;

  for (const edge of dreamGraph.edges) {
    if (alreadyValidated.has(edge.id)) continue;
    if (edge.interrupted) continue;

    const result = validateEdge(edge, lookup, cycle);

    // Apply custom threshold override
    if (result.status === "validated" && result.confidence < threshold) {
      result.status = "latent";
      result.reason_code = "insufficient_evidence";
    }

    // In strict mode, reject latent items too (only keep validated)
    if (strict && result.status === "latent") {
      result.status = "rejected";
      result.reason_code = "low_signal";
    }

    newResults.push(result);

    // Update edge status in dream graph to reflect normalization outcome
    edge.status = result.status === "validated" ? "validated" :
                  result.status === "latent" ? "latent" : "rejected";
    edge.plausibility = result.plausibility;
    edge.evidence_score = result.evidence_score;
    edge.contradiction_score = result.contradiction_score;
    edge.confidence = result.confidence;

    // PROMOTION GATE — only validated with sufficient evidence count
    if (result.status === "validated") {
      const promoted = promoteToValidatedEdge(edge, result);
      if (promoted) {
        promotedEdges.push(promoted);
      } else {
        // Validated but blocked by evidence count gate — downgrade to latent
        edge.status = "latent";
        blockedByGate++;
      }
    }
  }

  // Validate all unvalidated nodes
  for (const node of dreamGraph.nodes) {
    if (alreadyValidated.has(node.id)) continue;
    if (node.interrupted) continue;

    const result = validateNode(node, lookup, cycle);

    if (result.status === "validated" && result.confidence < threshold) {
      result.status = "latent";
      result.reason_code = "insufficient_evidence";
    }
    if (strict && result.status === "latent") {
      result.status = "rejected";
      result.reason_code = "low_signal";
    }

    newResults.push(result);

    // Update node status
    node.status = result.status === "validated" ? "validated" :
                  result.status === "latent" ? "latent" : "rejected";
    node.activation_score = result.status === "latent"
      ? Math.round(result.plausibility * 0.5 * 100) / 100
      : 0;
  }

  // Persist updated dream graph (with status/scores written back)
  await engine.saveDreamGraph(dreamGraph);

  // Persist normalization results
  if (newResults.length > 0) {
    await engine.appendValidationResults(newResults);
  }

  if (promotedEdges.length > 0) {
    await engine.promoteEdges(promotedEdges);
  }

  const counts = {
    validated: newResults.filter((r) => r.status === "validated").length,
    latent: newResults.filter((r) => r.status === "latent").length,
    rejected: newResults.filter((r) => r.status === "rejected").length,
  };

  logger.info(
    `Normalization cycle #${cycle} complete: ${newResults.length} processed ` +
      `(${counts.validated} validated, ${counts.latent} latent, ${counts.rejected} rejected), ` +
      `${promotedEdges.length} edges promoted, ${blockedByGate} blocked by gate`
  );

  return {
    cycle,
    processed: newResults.length,
    ...counts,
    blockedByGate,
    promotedEdges,
  };
}
