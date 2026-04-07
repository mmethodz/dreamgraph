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

import { loadJsonArray } from "../utils/cache.js";
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
import { countEvidence, computeConfidence, DEFAULT_PROMOTION, type PromotionConfig } from "./types.js";
import { isLlmAvailable, getLlmProvider, getNormalizerLlmConfig } from "./llm.js";
import type { LlmMessage } from "./llm.js";
import { getActiveCognitiveTuning } from "../instance/index.js";

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
    loadJsonArray<Feature>("features.json"),
    loadJsonArray<Workflow>("workflows.json"),
    loadJsonArray<DataModelEntity>("data_model.json"),
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
  // Only flag as duplicate if the EXACT same direction exists in the fact graph.
  // Symmetry-completion edges propose B→A when A→B exists — that's the point,
  // not a duplicate.  The reverse direction is new information.
  if (edge.strategy === "symmetry_completion") {
    return lookup.edgeSet.has(`${edge.from}|${edge.to}`);
  }
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
  reinforcementCount: number,
  promo: PromotionConfig = DEFAULT_PROMOTION
): SplitScore {
  // --- Contradiction Score (0–1) ---
  let contradictionScore = 0;
  if (!grounding.fromExists && !grounding.toExists) {
    // Both endpoints missing — strong negative signal but not instant death.
    // After init_graph populates the fact graph, this case is rare; when it
    // does occur the edge likely references entities that don't exist *yet*
    // (e.g. dreamer-invented IDs).  A score of 0.5 is a heavy penalty but
    // still allows well-supported edges through on reinforcement.
    contradictionScore = 0.5;
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
  // Reinforcement bonus: persistent ideas are inherently more plausible
  plausibility += Math.min(reinforcementCount * 0.06, 0.15);
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
  // Reinforcement history: surviving multiple cycles IS evidence
  evidenceScore += Math.min(reinforcementCount * 0.04, 0.10);
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

  if (contradictionScore >= promo.max_contradiction) {
    // High contradiction = reject
    outcome = "rejected";
    reason_code = isDuplicate ? "low_signal" :
      (!grounding.fromExists && !grounding.toExists) ? "invalid_endpoints" :
      "contradicted";
  } else if (
    confidence >= promo.promotion_confidence &&
    plausibility >= promo.promotion_plausibility &&
    evidenceScore >= promo.promotion_evidence
  ) {
    // Strong on all axes = validate
    outcome = "validated";
    reason_code = "strong_evidence";
  } else if (plausibility >= promo.retention_plausibility) {
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
  cycle: number,
  promo: PromotionConfig = DEFAULT_PROMOTION
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
    edge.reinforcement_count ?? 0,
    promo
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
  cycle: number,
  promo: PromotionConfig = DEFAULT_PROMOTION
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
    confidence >= promo.promotion_confidence &&
    plausibility >= promo.promotion_plausibility &&
    groundingRatio >= 0.5
  ) {
    outcome = "validated";
    reason_code = "strong_evidence";
  } else if (plausibility >= promo.retention_plausibility) {
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
// LLM Semantic Validation — ask the LLM to evaluate abstract concept matches
// ---------------------------------------------------------------------------

/** Schema for LLM semantic validation responses (strict mode) */
const SEMANTIC_VALIDATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          edge_id:            { type: "string", description: "The dream edge ID being evaluated" },
          semantic_relevance: { type: "number", description: "0.0-1.0 how semantically meaningful is this connection" },
          reasoning:          { type: "string", description: "Brief explanation of the semantic judgment" },
        },
        required: ["edge_id", "semantic_relevance", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["evaluations"],
  additionalProperties: false,
};

interface SemanticEvaluation {
  edge_id: string;
  semantic_relevance: number;
  reasoning: string;
}

/**
 * Batch-evaluate latent/near-threshold edges using the LLM for semantic
 * understanding. Structural scoring cannot judge whether abstract concepts
 * like "caching_layer relates_to query_optimizer" make sense — only the LLM
 * can reason about intent and meaning.
 *
 * Cost control:
 * - Only evaluates edges with confidence > 0.4 (worth the LLM cost)
 * - Batches up to 10 edges per call (~500 tokens)
 * - Skips entirely if LLM is unavailable
 * - Uses low temperature (0.3) for consistent judgments
 *
 * Returns a map of edge_id → SemanticEvaluation for edges the LLM reviewed.
 */
async function llmSemanticValidation(
  edges: Array<{ edge: DreamEdge; result: ValidationResult }>,
  lookup: FactLookup,
): Promise<Map<string, SemanticEvaluation>> {
  const evaluations = new Map<string, SemanticEvaluation>();

  // Filter to candidates worth evaluating: latent or near-threshold
  const candidates = edges.filter(({ result }) =>
    result.status === "latent" && result.confidence >= 0.4
  );

  if (candidates.length === 0) return evaluations;

  // Check LLM availability
  const available = await isLlmAvailable();
  if (!available) {
    logger.debug("Semantic validation: LLM not available, skipping");
    return evaluations;
  }

  const llm = getLlmProvider();

  // Batch up to 10 edges per call
  const batch = candidates.slice(0, 10);

  // Build context: describe each edge and its endpoints
  const edgeDescriptions = batch.map(({ edge, result }) => {
    const fromDomain = lookup.domains.get(edge.from) ?? "unknown";
    const toDomain = lookup.domains.get(edge.to) ?? "unknown";
    const fromKw = (lookup.keywords.get(edge.from) ?? []).join(", ");
    const toKw = (lookup.keywords.get(edge.to) ?? []).join(", ");
    return [
      `ID: ${edge.id}`,
      `  ${edge.from} (domain: ${fromDomain}, keywords: ${fromKw || "none"})`,
      `  --[${edge.relation}]-->`,
      `  ${edge.to} (domain: ${toDomain}, keywords: ${toKw || "none"})`,
      `  Reason: ${edge.reason}`,
      `  Structural confidence: ${result.confidence}, plausibility: ${result.plausibility}`,
    ].join("\n");
  }).join("\n\n");

  const messages: LlmMessage[] = [
    {
      role: "system",
      content: `You are a strict semantic validator for a software knowledge graph. You evaluate proposed relationships between entities and judge whether they make genuine semantic sense — not just syntactic or structural similarity.

Score each edge's semantic_relevance from 0.0 to 1.0:
- 0.0-0.3: No meaningful semantic connection, coincidental overlap
- 0.3-0.5: Weak or indirect connection, not worth promoting
- 0.5-0.7: Reasonable connection with clear rationale
- 0.7-1.0: Strong, insightful connection that reveals real architectural meaning

Be a strict critic. Only score above 0.6 if the relationship genuinely reveals something meaningful about the software architecture.`,
    },
    {
      role: "user",
      content: `Evaluate the semantic validity of these proposed knowledge graph edges:\n\n${edgeDescriptions}\n\nRespond with a JSON object containing an "evaluations" array.`,
    },
  ];

  try {
    logger.debug(`Semantic validation: evaluating ${batch.length} edges via LLM`);

    const normCfg = getNormalizerLlmConfig();
    const response = await llm.complete(messages, {
      temperature: normCfg.temperature,
      maxTokens: normCfg.maxTokens,
      model: normCfg.model,
      jsonSchema: {
        name: "semantic_validation",
        schema: SEMANTIC_VALIDATION_SCHEMA,
      },
    });

    const parsed = JSON.parse(response.text) as { evaluations?: SemanticEvaluation[] };
    if (Array.isArray(parsed.evaluations)) {
      for (const ev of parsed.evaluations) {
        if (ev.edge_id && typeof ev.semantic_relevance === "number") {
          evaluations.set(ev.edge_id, {
            edge_id: ev.edge_id,
            semantic_relevance: Math.max(0, Math.min(1, ev.semantic_relevance)),
            reasoning: ev.reasoning ?? "",
          });
        }
      }
    }

    logger.info(
      `Semantic validation: ${evaluations.size}/${batch.length} edges evaluated ` +
      `(${response.tokensUsed ?? "?"} tokens)`
    );
  } catch (err) {
    logger.warn(
      `Semantic validation failed: ${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  return evaluations;
}

/**
 * Apply semantic validation results to edge assessments.
 * Edges with high semantic relevance get boosted:
 * - plausibility +0.15, evidence +0.10
 * - evidence_count +1 (semantic = distinct evidence type)
 * - reason_code → "semantic_boost"
 * - If the boosted scores cross thresholds → upgraded to "validated"
 */
function applySemanticBoost(
  result: ValidationResult,
  evaluation: SemanticEvaluation,
  promo: PromotionConfig,
): void {
  if (evaluation.semantic_relevance < 0.6) return;

  // Scale boost by semantic relevance (0.6→small, 1.0→full)
  const boostScale = (evaluation.semantic_relevance - 0.6) / 0.4; // 0→1

  const plausBoost = 0.15 * boostScale;
  const evidBoost = 0.10 * boostScale;

  result.plausibility = Math.round(Math.min(result.plausibility + plausBoost, 1) * 100) / 100;
  result.evidence_score = Math.round(Math.min(result.evidence_score + evidBoost, 1) * 100) / 100;
  result.evidence_count += 1; // semantic validation = distinct evidence signal

  // Recompute confidence with boosted scores
  result.confidence = computeConfidence(
    result.plausibility,
    result.evidence_score,
    0, // reinforcement already baked in
    result.contradiction_score,
  );

  // Append semantic reasoning
  result.reason = `${result.reason} LLM semantic: ${evaluation.reasoning} (relevance: ${evaluation.semantic_relevance.toFixed(2)})`;
  result.reason_code = "semantic_boost";

  // Re-classify with boosted scores
  if (
    result.confidence >= promo.promotion_confidence &&
    result.plausibility >= promo.promotion_plausibility &&
    result.evidence_score >= promo.promotion_evidence
  ) {
    result.status = "validated";
  }
}

// ---------------------------------------------------------------------------
// Edge promotion — three-outcome gate uses PromotionConfig thresholds
// ---------------------------------------------------------------------------

function promoteToValidatedEdge(
  edge: DreamEdge,
  result: ValidationResult,
  promo: PromotionConfig = DEFAULT_PROMOTION
): ValidatedEdge | null {
  // Only "validated" outcome edges pass
  if (result.status !== "validated") return null;

  // Reinforcement persistence counts as evidence: if independent dream cycles
  // keep re-generating the same connection, that IS a distinct evidence signal.
  // Threshold: 10+ reinforcements = 1 extra evidence count.
  const reinforcementBonus = (edge.reinforcement_count ?? 0) >= 10 ? 1 : 0;
  const effectiveEvidenceCount = result.evidence_count + reinforcementBonus;

  // Must have at least min_evidence_count distinct evidence signals
  if (effectiveEvidenceCount < promo.promotion_evidence_count) return null;

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
    evidence_count: effectiveEvidenceCount,
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
  /** Number of dream nodes promoted to the fact graph as entities */
  promotedNodes: number;
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
  threshold?: number,
  strict: boolean = false
): Promise<NormalizationResult> {
  engine.assertState("normalizing", "normalize");

  // Resolve promotion config from active policy profile
  const tuning = await getActiveCognitiveTuning();
  const promo: PromotionConfig = {
    promotion_confidence: tuning.promotion_confidence,
    promotion_plausibility: tuning.promotion_plausibility,
    promotion_evidence: tuning.promotion_evidence,
    promotion_evidence_count: tuning.promotion_evidence_count,
    retention_plausibility: tuning.retention_plausibility,
    max_contradiction: tuning.max_contradiction,
  };
  const effectiveThreshold = threshold ?? promo.promotion_confidence;

  const cycle = engine.nextNormalizationCycle();
  logger.info(
    `Normalization cycle #${cycle} starting (threshold: ${effectiveThreshold}, strict: ${strict}, profile tuning: confidence=${promo.promotion_confidence}, evidence_count=${promo.promotion_evidence_count})`
  );

  // Load fact graph and dream graph
  const [lookup, dreamGraph, existingCandidates] = await Promise.all([
    buildFactLookup(),
    engine.loadDreamGraph(),
    engine.loadCandidateEdges(),
  ]);

  // Build map of previous assessment results by dream ID.
  // Edges that were previously "validated" or "rejected" are final — skip them.
  // Edges that were "latent" AND have gained reinforcement since their last
  // assessment deserve re-evaluation (reinforcement = new evidence).
  const previousResults = new Map(
    existingCandidates.results.map((r) => [r.dream_id, r] as const)
  );

  // Validate all eligible edges — PASS 1: structural scoring
  const edgeAssessments: Array<{ edge: DreamEdge; result: ValidationResult }> = [];
  const newResults: ValidationResult[] = [];

  for (const edge of dreamGraph.edges) {
    if (edge.interrupted) continue;

    const prev = previousResults.get(edge.id);
    if (prev) {
      // Already validated or rejected — final, skip
      if (prev.status === "validated" || prev.status === "rejected") continue;
      // Latent: only re-evaluate if reinforced since last assessment
      if (prev.status === "latent" && (edge.reinforcement_count ?? 0) === 0) continue;
    }

    const result = validateEdge(edge, lookup, cycle, promo);

    // Apply custom threshold override
    if (result.status === "validated" && result.confidence < effectiveThreshold) {
      result.status = "latent";
      result.reason_code = "insufficient_evidence";
    }

    // In strict mode, reject latent items too (only keep validated)
    if (strict && result.status === "latent") {
      result.status = "rejected";
      result.reason_code = "low_signal";
    }

    edgeAssessments.push({ edge, result });
    newResults.push(result);
  }

  // PASS 2: LLM semantic validation on latent edges
  // The LLM evaluates abstract concept matches that structural scoring misses.
  // Only runs when LLM is available; gracefully degrades to structural-only.
  const semanticResults = await llmSemanticValidation(edgeAssessments, lookup);
  let semanticBoosts = 0;
  for (const { edge, result } of edgeAssessments) {
    const evaluation = semanticResults.get(edge.id);
    if (evaluation) {
      applySemanticBoost(result, evaluation, promo);
      if (result.reason_code === "semantic_boost") semanticBoosts++;
    }
  }
  if (semanticBoosts > 0) {
    logger.info(`Semantic validation boosted ${semanticBoosts} edges`);
  }

  // PASS 3: promotion gate — apply after semantic boosts
  const promotedEdges: ValidatedEdge[] = [];
  let blockedByGate = 0;

  for (const { edge, result } of edgeAssessments) {
    // Update edge status in dream graph to reflect normalization outcome
    edge.status = result.status === "validated" ? "validated" :
                  result.status === "latent" ? "latent" : "rejected";
    edge.plausibility = result.plausibility;
    edge.evidence_score = result.evidence_score;
    edge.contradiction_score = result.contradiction_score;
    edge.confidence = result.confidence;

    // PROMOTION GATE — only validated with sufficient evidence count
    if (result.status === "validated") {
      const promoted = promoteToValidatedEdge(edge, result, promo);
      if (promoted) {
        promotedEdges.push(promoted);
      } else {
        // Validated but blocked by evidence count gate — downgrade BOTH
        // dream graph edge AND candidate result to latent.  Without this,
        // the candidate stays "validated" and gets skipped forever.
        edge.status = "latent";
        result.status = "latent";
        result.reason_code = "insufficient_evidence";
        blockedByGate++;
      }
    }
  }

  // Validate all eligible nodes
  const promotableNodes: DreamNode[] = [];
  for (const node of dreamGraph.nodes) {
    if (node.interrupted) continue;
    if (node.promoted_at) continue; // Already promoted to fact graph

    const prev = previousResults.get(node.id);
    if (prev) {
      if (prev.status === "validated" || prev.status === "rejected") continue;
      if (prev.status === "latent" && (node.reinforcement_count ?? 0) === 0) continue;
    }

    const result = validateNode(node, lookup, cycle, promo);

    if (result.status === "validated" && result.confidence < effectiveThreshold) {
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

    // Collect validated nodes for entity promotion
    if (result.status === "validated") {
      promotableNodes.push(node);
    }
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

  // ENTITY PROMOTION — validated nodes become fact entities
  // Intent becomes factual when confidence is reached.
  let promotedNodeCount = 0;
  if (promotableNodes.length > 0) {
    const result = await engine.promoteNodesToFactGraph(promotableNodes);
    promotedNodeCount = result.promoted;
  }

  const counts = {
    validated: newResults.filter((r) => r.status === "validated").length,
    latent: newResults.filter((r) => r.status === "latent").length,
    rejected: newResults.filter((r) => r.status === "rejected").length,
  };

  logger.info(
    `Normalization cycle #${cycle} complete: ${newResults.length} processed ` +
      `(${counts.validated} validated, ${counts.latent} latent, ${counts.rejected} rejected), ` +
      `${promotedEdges.length} edges promoted, ${promotedNodeCount} entities promoted, ${blockedByGate} blocked by gate`
  );

  return {
    cycle,
    processed: newResults.length,
    ...counts,
    blockedByGate,
    promotedEdges,
    promotedNodes: promotedNodeCount,
  };
}
