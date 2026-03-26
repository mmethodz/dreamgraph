/**
 * DreamGraph Cognitive Dreaming System — Type definitions.
 *
 * These types define the data structures for the three cognitive states
 * (AWAKE, REM, NORMALIZING) and the two knowledge spaces
 * (FACT GRAPH and DREAM GRAPH).
 *
 * Speculative Memory Model (5-state lifecycle):
 *   candidate → latent → validated → (promoted to fact graph)
 *                     → rejected
 *   latent    → expired (via decay without reinforcement)
 *
 * Enhanced with:
 * - Dream decay (TTL + confidence decay per cycle)
 * - Duplicate suppression (reinforcement counting)
 * - Unresolved tension tracking (goal-directed dreaming)
 * - Dream history (session audit trail)
 * - Three-outcome normalization (validated / latent / rejected)
 * - Split scoring: plausibility × evidence − contradiction
 * - Activation scoring for goal-directed REM revisitation
 * - Two-threshold promotion: promotionThreshold + retentionThreshold
 *
 * Design principle: "Dream freely. Wake critically. Remember selectively."
 */

// ---------------------------------------------------------------------------
// Cognitive States
// ---------------------------------------------------------------------------

/** The three cognitive states the system can occupy */
export type CognitiveStateName = "awake" | "rem" | "normalizing";

/** Dream generation strategies */
export type DreamStrategy =
  | "gap_detection"
  | "weak_reinforcement"
  | "cross_domain"
  | "missing_abstraction"
  | "symmetry_completion"
  | "tension_directed"
  | "reflective"
  | "all";

/** Three-outcome normalization classifier */
export type NormalizationOutcome = "validated" | "latent" | "rejected";

/**
 * Full lifecycle status for dream edges and nodes (speculative memory).
 *
 * - candidate: Fresh REM output, not yet normalized.
 * - latent:    Normalized, plausible, but insufficient evidence. Kept asleep.
 * - validated:  Passed thresholds. Promoted to fact-adjacent space.
 * - rejected:  Contradicted, malformed, or low-value noise.
 * - expired:   Latent idea that decayed without reinforcement.
 */
export type DreamEdgeStatus =
  | "candidate"
  | "latent"
  | "validated"
  | "rejected"
  | "expired";

/** Reason codes explaining normalization decisions */
export type NormalizationReasonCode =
  | "strong_evidence"
  | "insufficient_evidence"
  | "contradicted"
  | "invalid_endpoints"
  | "low_signal";

/** Entity types — includes hypothetical types for dream nodes */
export type DreamEntityType =
  | "feature"
  | "workflow"
  | "data_model"
  | "hypothetical_feature"
  | "hypothetical_workflow"
  | "hypothetical_entity";

/** Edge types — includes hypothetical */
export type DreamEdgeType =
  | "feature"
  | "workflow"
  | "data_model"
  | "hypothetical";

// ---------------------------------------------------------------------------
// Dream Decay — edges fade unless reinforced
// ---------------------------------------------------------------------------

/** Decay configuration for dream edges */
export interface DecayConfig {
  /** Time-to-live in dream cycles. Edge is removed when ttl reaches 0. */
  ttl: number;
  /** Confidence reduction per cycle (subtracted each cycle if not reinforced) */
  decay_rate: number;
}

/** Default decay settings — TTL must survive at least one full 6-strategy rotation */
export const DEFAULT_DECAY: DecayConfig = {
  ttl: 8,
  decay_rate: 0.05,
};

// ---------------------------------------------------------------------------
// Promotion & Retention Thresholds
// ---------------------------------------------------------------------------

/** Two-threshold configuration: promotion (→ validated) + retention (→ latent) */
export interface PromotionConfig {
  /** Minimum combined confidence for promotion to validated */
  promotion_confidence: number;
  /** Minimum plausibility for promotion */
  promotion_plausibility: number;
  /** Minimum evidence score for promotion */
  promotion_evidence: number;
  /** Minimum distinct evidence signals for promotion */
  promotion_evidence_count: number;
  /** Minimum plausibility for retention as latent (below = rejected) */
  retention_plausibility: number;
  /** Maximum contradiction score before rejection (above = rejected) */
  max_contradiction: number;
}

export const DEFAULT_PROMOTION: PromotionConfig = {
  promotion_confidence: 0.62,
  promotion_plausibility: 0.45,
  promotion_evidence: 0.4,
  promotion_evidence_count: 2,
  retention_plausibility: 0.35,
  max_contradiction: 0.3,
};

// ---------------------------------------------------------------------------
// Scoring Helpers
// ---------------------------------------------------------------------------

/**
 * Combined confidence = plausibility × 0.45 + evidence × 0.45
 *                       + reinforcement bonus − contradiction penalty
 */
export function computeConfidence(
  plausibility: number,
  evidenceScore: number,
  reinforcementCount: number,
  contradictionScore: number
): number {
  const reinforcementBonus = Math.min(reinforcementCount * 0.05, 0.10);
  const contradictionPenalty = contradictionScore * 0.5;
  const raw =
    plausibility * 0.45 +
    evidenceScore * 0.45 +
    reinforcementBonus -
    contradictionPenalty;
  return Math.round(Math.max(Math.min(raw, 1), 0) * 100) / 100;
}

/**
 * Activation score — how much dream attention an edge should receive.
 * High activation = revisit in next REM cycle.
 */
export function computeActivationScore(
  plausibility: number,
  reinforcementCount: number,
  cyclesSinceCreation: number,
  tensionProximity: number
): number {
  const recencyBoost = 0.2 / (cyclesSinceCreation + 1);
  const reinforcementMomentum = Math.min(reinforcementCount * 0.1, 0.3);
  const raw =
    plausibility * 0.3 +
    tensionProximity * 0.3 +
    recencyBoost +
    reinforcementMomentum;
  return Math.round(Math.max(Math.min(raw, 1), 0) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Dream Graph Structures — generated during REM
// ---------------------------------------------------------------------------

/**
 * A dream node is a speculative entity generated during REM.
 * It does not exist in the Fact Graph and must be validated.
 */
export interface DreamNode {
  id: string;
  type: DreamEntityType;
  name: string;
  description: string;
  /** Fact graph entity IDs that inspired this dream */
  inspiration: string[];
  /** Dreamer's confidence in this node's value (0.0–1.0) */
  confidence: number;
  /** Always "rem" — marks provenance */
  origin: "rem";
  /** ISO 8601 creation timestamp */
  created_at: string;
  /** Which dream cycle generated this */
  dream_cycle: number;
  /** Set to true if REM was interrupted before completion */
  interrupted?: boolean;
  /** Remaining dream cycles before expiry (decremented each cycle) */
  ttl: number;
  /** Confidence decay per unfed cycle */
  decay_rate: number;
  /** Number of times this node was re-dreamed (duplicate suppression) */
  reinforcement_count: number;
  /** Last cycle in which this was reinforced */
  last_reinforced_cycle: number;
  /** Lifecycle status (speculative memory) */
  status: DreamEdgeStatus;
  /** How much dream attention this node should receive next cycle */
  activation_score: number;
}

/**
 * A dream edge is a speculative relationship generated during REM.
 * Connects any two entities (fact or dream) with a proposed relationship.
 */
export interface DreamEdge {
  id: string;
  /** Source entity ID (may be fact graph or dream node) */
  from: string;
  /** Target entity ID (may be fact graph or dream node) */
  to: string;
  type: DreamEdgeType;
  /** Relationship verb (e.g., "potential_unified_pipeline") */
  relation: string;
  /** Human-readable reason this edge was dreamed */
  reason: string;
  /** Dreamer's confidence (0.0–1.0) */
  confidence: number;
  /** Always "rem" */
  origin: "rem";
  /** ISO 8601 */
  created_at: string;
  /** Which dream cycle */
  dream_cycle: number;
  /** Strategy that generated this edge */
  strategy: DreamStrategy;
  /** Optional metadata */
  meta?: Record<string, unknown>;
  /** True if REM was interrupted */
  interrupted?: boolean;
  /** Remaining dream cycles before expiry */
  ttl: number;
  /** Confidence decay per unfed cycle */
  decay_rate: number;
  /** Times this edge (or a similar one) was re-dreamed */
  reinforcement_count: number;
  /** Last cycle this was reinforced */
  last_reinforced_cycle: number;
  /** Lifecycle status (speculative memory) */
  status: DreamEdgeStatus;
  /** How much dream attention this edge should receive next cycle */
  activation_score: number;
  /** Structural/semantic plausibility (0–1), set by normalizer */
  plausibility: number;
  /** Evidence grounding score (0–1), set by normalizer */
  evidence_score: number;
  /** Contradiction severity (0–1), set by normalizer. 0 = no contradictions */
  contradiction_score: number;
}

// ---------------------------------------------------------------------------
// Dream Graph File Structure
// ---------------------------------------------------------------------------

export interface DreamGraphMetadata {
  description: string;
  schema_version: string;
  last_dream_cycle: string | null;
  total_cycles: number;
  created_at: string;
}

export interface DreamGraphFile {
  metadata: DreamGraphMetadata;
  nodes: DreamNode[];
  edges: DreamEdge[];
}

// ---------------------------------------------------------------------------
// Normalization Structures — generated during NORMALIZING
// ---------------------------------------------------------------------------

/** Evidence gathered during validation */
export interface ValidationEvidence {
  /** Fact graph entities that ground this dream */
  shared_entities: string[];
  /** Workflows that support this relationship */
  shared_workflows: string[];
  /** Domain tags that overlap */
  domain_overlap: string[];
  /** Keywords that overlap */
  keyword_overlap: string[];
  /** Whether the entities share a source repository */
  source_repo_match: boolean;
  /** Fact graph conflicts found */
  contradictions: string[];
}

/** Count of distinct evidence signals (used for promotion gate) */
export function countEvidence(evidence: ValidationEvidence): number {
  let count = 0;
  if (evidence.shared_entities.length > 0) count++;
  if (evidence.shared_workflows.length > 0) count++;
  if (evidence.domain_overlap.length > 0) count++;
  if (evidence.keyword_overlap.length > 0) count++;
  if (evidence.source_repo_match) count++;
  return count;
}

/** A validation judgment on a single dream artifact */
export interface ValidationResult {
  /** ID of the dream node/edge being validated */
  dream_id: string;
  /** Whether a node or edge was validated */
  dream_type: "node" | "edge";
  /** Three-outcome classification: validated / latent / rejected */
  status: NormalizationOutcome;
  /** Combined confidence (plausibility × 0.45 + evidence × 0.45 + reinforcement − contradiction) */
  confidence: number;
  /** Structural/semantic plausibility (0–1) */
  plausibility: number;
  /** Evidence grounding score (0–1) */
  evidence_score: number;
  /** Contradiction severity (0–1). 0 = no contradictions */
  contradiction_score: number;
  /** Structured evidence */
  evidence: ValidationEvidence;
  /** Count of distinct supporting evidence signals */
  evidence_count: number;
  /** Machine-readable reason code for the decision */
  reason_code: NormalizationReasonCode;
  /** Human-readable explanation */
  reason: string;
  /** ISO 8601 */
  validated_at: string;
  /** Which normalization pass */
  normalization_cycle: number;
}

/** Candidate edges file structure */
export interface CandidateEdgesMetadata {
  description: string;
  schema_version: string;
  last_normalization: string | null;
  total_cycles: number;
  created_at: string;
}

export interface CandidateEdgesFile {
  metadata: CandidateEdgesMetadata;
  results: ValidationResult[];
}

// ---------------------------------------------------------------------------
// Validated Edges — promoted dreams that passed normalization
// ---------------------------------------------------------------------------

/**
 * A validated edge is a dream edge that passed normalization.
 * It is TRUSTED and additive to the Fact Graph.
 * Both `from` and `to` must reference real Fact Graph entities.
 *
 * PROMOTION GATE: confidence > 0.7 AND evidence_count >= 2
 */
export interface ValidatedEdge {
  id: string;
  from: string;
  to: string;
  type: "feature" | "workflow" | "data_model";
  relation: string;
  description: string;
  /** Combined confidence (post-validation) */
  confidence: number;
  /** Structural/semantic plausibility (0–1) */
  plausibility: number;
  /** Evidence grounding score (0–1) */
  evidence_score: number;
  /** Provenance: always "rem" */
  origin: "rem";
  /** Always "validated" for promoted edges */
  status: "validated";
  /** Brief summary of validation evidence */
  evidence_summary: string;
  /** Count of distinct evidence signals that supported this promotion */
  evidence_count: number;
  /** How many times the dream was reinforced before promotion */
  reinforcement_count: number;
  /** Which dream cycle originated this */
  dream_cycle: number;
  /** Which normalization cycle validated this */
  normalization_cycle: number;
  /** ISO 8601 */
  validated_at: string;
}

/** Validated edges file structure */
export interface ValidatedEdgesMetadata {
  description: string;
  schema_version: string;
  last_validation: string | null;
  total_validated: number;
  created_at: string;
}

export interface ValidatedEdgesFile {
  metadata: ValidatedEdgesMetadata;
  edges: ValidatedEdge[];
}

// ---------------------------------------------------------------------------
// Tension System — what the system struggles with
// ---------------------------------------------------------------------------

/** Domain grouping for tensions — enables prioritization by area */
export type TensionDomain =
  | "security"
  | "invoicing"
  | "sync"
  | "integration"
  | "data_model"
  | "auth"
  | "payroll"
  | "reporting"
  | "api"
  | "mobile"
  | "general";

/** How a tension was resolved */
export type TensionResolutionType =
  | "confirmed_fixed"   // Verified that the issue is actually resolved
  | "false_positive"    // Turned out not to be a real problem
  | "wont_fix";         // Acknowledged but intentionally left as-is

/** Who resolved the tension */
export type TensionResolutionAuthority = "human" | "system";

/** A tension signal: something the system noticed was hard / missing / weak */
export interface TensionSignal {
  id: string;
  /** What kind of tension */
  type: "missing_link" | "weak_connection" | "hard_query" | "ungrounded_dream" | "code_insight";
  /** Domain group for clustering and prioritization */
  domain: TensionDomain;
  /** Entity IDs involved */
  entities: string[];
  /** Human-readable description */
  description: string;
  /** How many times this tension was observed */
  occurrences: number;
  /** Urgency score (0.0-1.0) -- higher = more cycles should focus here */
  urgency: number;
  /** ISO 8601 first seen */
  first_seen: string;
  /** ISO 8601 last seen */
  last_seen: string;
  /** Has REM attempted to resolve this? */
  attempted: boolean;
  /** Was it resolved? (kept for backward compat; see resolution for details) */
  resolved: boolean;
  /** Tension TTL -- decays each cycle; expires when <= 0 */
  ttl: number;
}

/**
 * A resolved tension -- moved here instead of deleted.
 * Preserves institutional memory: what was fixed, what was false positive,
 * what patterns repeat.
 */
export interface ResolvedTension {
  /** Original tension ID */
  tension_id: string;
  /** ISO 8601 resolution timestamp */
  resolved_at: string;
  /** Who closed this: human (external validation) or system (auto-resolved) */
  resolved_by: TensionResolutionAuthority;
  /** Why it was closed */
  resolution_type: TensionResolutionType;
  /** Optional evidence or explanation */
  evidence?: string;
  /** Optional re-check window in cycles -- if set, tension can reactivate */
  recheck_ttl?: number;
  /** Snapshot of the original tension at time of resolution */
  original: TensionSignal;
}

/** Tension system configuration */
export interface TensionConfig {
  /** Max active (unresolved) tensions that drive dreaming */
  max_active_tensions: number;
  /** TTL for new tensions (cycles before auto-expire) */
  default_tension_ttl: number;
  /** Urgency decay per cycle for tensions not re-observed */
  tension_urgency_decay: number;
  /** Minimum urgency to stay active (below = auto-expire) */
  min_urgency_threshold: number;
}

export const DEFAULT_TENSION_CONFIG: TensionConfig = {
  max_active_tensions: 50,
  default_tension_ttl: 30,
  tension_urgency_decay: 0.02,
  min_urgency_threshold: 0.05,
};

export interface TensionFile {
  metadata: {
    description: string;
    schema_version: string;
    total_signals: number;
    total_resolved: number;
    last_updated: string | null;
  };
  signals: TensionSignal[];
  resolved_tensions: ResolvedTension[];
}

// ---------------------------------------------------------------------------
// Dream History — audit trail of every cycle
// ---------------------------------------------------------------------------

export interface DreamHistoryEntry {
  session_id: string;
  cycle_number: number;
  timestamp: string;
  strategy: DreamStrategy;
  duration_ms: number;
  generated_edges: number;
  generated_nodes: number;
  /** Edges that were duplicate-suppressed (reinforced existing instead) */
  duplicates_merged: number;
  /** Edges that decayed and were removed this cycle */
  decayed_edges: number;
  decayed_nodes: number;
  normalization?: {
    validated: number;
    latent: number;
    rejected: number;
    promoted: number;
    /** Edges blocked by promotion gate */
    blocked_by_gate: number;
  };
  tension_signals_created: number;
  tension_signals_resolved: number;
  /** Tensions that expired (TTL or urgency faded to zero) */
  tensions_expired: number;
  /** Tensions that had urgency/TTL decayed this cycle */
  tensions_decayed: number;
}

export interface DreamHistoryFile {
  metadata: {
    description: string;
    schema_version: string;
    total_sessions: number;
    created_at: string;
  };
  sessions: DreamHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Cognitive State — introspection (enhanced)
// ---------------------------------------------------------------------------

export interface DreamGraphStats {
  total_nodes: number;
  total_edges: number;
  /** Edges currently in latent (speculative memory) status */
  latent_edges: number;
  /** Nodes currently in latent status */
  latent_nodes: number;
  /** Items that will expire next cycle if not reinforced */
  expiring_next_cycle: number;
  /** Average confidence across all dream edges */
  avg_confidence: number;
  /** Average reinforcement count */
  avg_reinforcement: number;
  /** Average activation score across latent edges */
  avg_activation: number;
}

export interface ValidationStats {
  validated: number;
  latent: number;
  rejected: number;
}

export interface TensionStats {
  total: number;
  unresolved: number;
  top_urgency: TensionSignal | null;
}

/** Full cognitive state for introspection */
export interface CognitiveState {
  current_state: CognitiveStateName;
  last_state_change: string;
  total_dream_cycles: number;
  total_normalization_cycles: number;
  dream_graph_stats: DreamGraphStats;
  validated_stats: ValidationStats;
  tension_stats: TensionStats;
  last_dream_cycle: string | null;
  last_normalization: string | null;
  promotion_config: PromotionConfig;
  decay_config: DecayConfig;
}

// ---------------------------------------------------------------------------
// Dream Insights — what the introspection tool returns
// ---------------------------------------------------------------------------

export interface DreamCluster {
  /** Central entity or domain */
  center: string;
  /** Entity IDs in the cluster */
  members: string[];
  /** Average confidence */
  avg_confidence: number;
  /** Total reinforcement across cluster */
  total_reinforcement: number;
}

export interface DreamInsights {
  /** New edges from most recent cycle */
  recent_edges: DreamEdge[];
  /** Strongest hypotheses (highest confidence × reinforcement) */
  strongest_hypotheses: Array<{
    edge: DreamEdge;
    score: number;
    reinforcement_count: number;
  }>;
  /** Clusters of related dreams */
  clusters: DreamCluster[];
  /** Unresolved tensions directing next REM */
  active_tensions: TensionSignal[];
  /** Edges about to expire */
  expiring_soon: DreamEdge[];
  /** Summary statistics */
  summary: {
    total_dreams: number;
    total_validated: number;
    total_latent: number;
    total_tensions: number;
    dream_health: "healthy" | "stale" | "overloaded" | "empty";
    recommendation: string;
  };
}

// ---------------------------------------------------------------------------
// Tool Input/Output types
// ---------------------------------------------------------------------------

export interface DreamCycleInput {
  strategy?: DreamStrategy;
  max_dreams?: number;
  auto_normalize?: boolean;
}

export interface DreamCycleOutput {
  cycle_number: number;
  state_transitions: string[];
  dreams_generated: { nodes: number; edges: number };
  duplicates_merged: number;
  decayed: { nodes: number; edges: number };
  normalization?: {
    validated: number;
    latent: number;
    rejected: number;
    blocked_by_gate: number;
  };
  promoted_edges: number;
  tensions_created: number;
  tensions_resolved: number;
  /** Tensions auto-expired by decay this cycle */
  tensions_expired: number;
  /** Tensions that had urgency/TTL reduced this cycle */
  tensions_decayed: number;
  duration_ms: number;
}

export interface NormalizeDreamsInput {
  threshold?: number;
  strict?: boolean;
}

export interface NormalizeDreamsOutput {
  cycle_number: number;
  processed: number;
  validated: number;
  latent: number;
  rejected: number;
  blocked_by_gate: number;
  promoted_edges: ValidatedEdge[];
}

export interface QueryDreamsInput {
  type?: "node" | "edge" | "all";
  domain?: string;
  min_confidence?: number;
  status?: "validated" | "latent" | "rejected" | "expired" | "candidate" | "raw";
}

export interface QueryDreamsOutput {
  nodes: DreamNode[];
  edges: DreamEdge[];
  validated: ValidatedEdge[];
}

export interface ClearDreamsInput {
  target: "dream_graph" | "candidates" | "validated" | "tensions" | "history" | "all";
  confirm: boolean;
}

export interface ClearDreamsOutput {
  cleared: string[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Architecture Decision Records (ADR)
// ---------------------------------------------------------------------------

/** A single Architecture Decision Record */
export interface ArchitectureDecisionRecord {
  /** Sequential ID: "ADR-001", "ADR-002", etc. */
  id: string;
  title: string;
  date: string;
  decided_by: "human" | "system" | "collaborative";
  status: "accepted" | "deprecated" | "superseded";
  superseded_by?: string;

  context: {
    problem: string;
    constraints: string[];
    affected_entities: string[];
    related_tensions?: string[];
  };

  decision: {
    chosen: string;
    alternatives: Array<{
      option: string;
      rejected_because: string;
    }>;
  };

  consequences: {
    expected: string[];
    risks: string[];
    actual?: string[];
  };

  guard_rails: string[];
  tags: string[];
}

/** ADR log file structure */
export interface ADRLogFile {
  metadata: {
    description: string;
    schema_version: string;
    total_decisions: number;
    last_updated: string | null;
  };
  decisions: ArchitectureDecisionRecord[];
}

// ---------------------------------------------------------------------------
// Semantic UI Registry
// ---------------------------------------------------------------------------

/** Categories for semantic UI elements */
export type SemanticElementCategory =
  | "data_display"
  | "data_input"
  | "navigation"
  | "feedback"
  | "layout"
  | "action"
  | "composite";

/** The atomic unit of semantic UI understanding */
export interface SemanticElement {
  id: string;
  name: string;
  purpose: string;
  category: SemanticElementCategory;

  data_contract: {
    inputs: Array<{
      name: string;
      type: string;
      description: string;
      required: boolean;
    }>;
    outputs: Array<{
      name: string;
      type: string;
      description: string;
      trigger: string;
    }>;
  };

  interactions: Array<{
    action: string;
    description: string;
  }>;

  children?: string[];

  implementations: Array<{
    platform: string;
    component: string;
    source_file?: string;
    notes?: string;
  }>;

  used_by: string[];
  tags: string[];
}

/** UI registry file structure */
export interface UIRegistryFile {
  metadata: {
    description: string;
    schema_version: string;
    total_elements: number;
    total_categories: number;
    last_updated: string | null;
  };
  elements: SemanticElement[];
}

// ---------------------------------------------------------------------------
// Visual Architect Tool I/O
// ---------------------------------------------------------------------------

export interface GenerateVisualFlowInput {
  target_type: "workflow" | "feature_deps" | "data_flow" | "tension_map" | "domain_overview" | "ui_composition";
  target_ids: string[];
  depth?: number;
  direction?: "TB" | "LR" | "BT" | "RL";
  include_dreams?: boolean;
  include_tensions?: boolean;
  max_nodes?: number;
}

export interface GenerateVisualFlowOutput {
  mermaid: string;
  diagram_type: string;
  node_count: number;
  edge_count: number;
  simplified: boolean;
  title: string;
}

// ---------------------------------------------------------------------------
// ADR Tool I/O
// ---------------------------------------------------------------------------

export interface RecordADRInput {
  title: string;
  decided_by: "human" | "system" | "collaborative";
  problem: string;
  constraints: string[];
  affected_entities: string[];
  related_tensions?: string[];
  chosen: string;
  alternatives?: Array<{
    option: string;
    rejected_because: string;
  }>;
  expected_consequences: string[];
  risks: string[];
  guard_rails: string[];
  tags?: string[];
}

export interface RecordADROutput {
  adr_id: string;
  title: string;
  status: "accepted";
  affected_entities: string[];
  guard_rails: string[];
  message: string;
}

export interface QueryADRInput {
  entity_id?: string;
  tag?: string;
  status?: "accepted" | "deprecated" | "superseded";
  search?: string;
  guard_check?: {
    entity_id: string;
    proposed_change: string;
  };
}

export interface GuardRailWarning {
  adr_id: string;
  title: string;
  guard_rail: string;
  message: string;
}

export interface QueryADROutput {
  decisions: ArchitectureDecisionRecord[];
  guard_rail_warnings: GuardRailWarning[];
  total: number;
}

export interface DeprecateADRInput {
  adr_id: string;
  new_status: "deprecated" | "superseded";
  superseded_by?: string;
  reason: string;
}

export interface DeprecateADROutput {
  adr_id: string;
  new_status: "deprecated" | "superseded";
  message: string;
}

// ---------------------------------------------------------------------------
// UI Registry Tool I/O
// ---------------------------------------------------------------------------

export interface RegisterUIElementInput {
  id: string;
  name: string;
  purpose: string;
  category: SemanticElementCategory;
  inputs: Array<{
    name: string;
    type: string;
    description: string;
    required: boolean;
  }>;
  outputs: Array<{
    name: string;
    type: string;
    description: string;
    trigger: string;
  }>;
  interactions: Array<{
    action: string;
    description: string;
  }>;
  children?: string[];
  implementations?: Array<{
    platform: string;
    component: string;
    source_file?: string;
    notes?: string;
  }>;
  used_by?: string[];
  tags?: string[];
}

export interface RegisterUIElementOutput {
  element_id: string;
  name: string;
  category: string;
  inputs_count: number;
  outputs_count: number;
  merged: boolean;
  message: string;
}

export interface QueryUIElementsInput {
  category?: SemanticElementCategory;
  purpose_search?: string;
  platform?: string;
  feature_id?: string;
  missing_platform?: string;
}

export interface QueryUIElementsOutput {
  elements: SemanticElement[];
  total: number;
  categories: Record<string, number>;
  platforms: Record<string, number>;
}

export interface GenerateUIMigrationInput {
  source_platform: string;
  target_platform: string;
  scope?: string[];
}

export interface MigrationPortedElement {
  element_id: string;
  name: string;
  source_component: string;
  target_component: string;
}

export interface MigrationGapElement {
  element_id: string;
  name: string;
  purpose: string;
  category: string;
  source_component: string;
  data_contract_summary: string;
  complexity_estimate: "trivial" | "moderate" | "complex";
}

export interface GenerateUIMigrationOutput {
  source_platform: string;
  target_platform: string;
  already_ported: MigrationPortedElement[];
  migration_needed: MigrationGapElement[];
  total_elements: number;
  ported_count: number;
  gap_count: number;
  coverage_percent: number;
}

// ---------------------------------------------------------------------------
// Living Docs Exporter I/O
// ---------------------------------------------------------------------------

export type LivingDocsSection =
  | "features"
  | "data_model"
  | "workflows"
  | "architecture"
  | "ui_registry"
  | "cognitive_status"
  | "api_reference"
  | "all";

export type LivingDocsFormat = "docusaurus" | "nextra" | "mkdocs" | "plain";

export interface ExportLivingDocsInput {
  output_dir: string;
  repo?: string;
  sections: LivingDocsSection[];
  format?: LivingDocsFormat;
  include_diagrams?: boolean;
  include_cognitive?: boolean;
}

export interface ExportedFile {
  path: string;
  section: string;
  size_bytes: number;
}

export interface ExportLivingDocsOutput {
  files_created: ExportedFile[];
  total_files: number;
  total_bytes: number;
  sections_exported: string[];
  timestamp: string;
}
