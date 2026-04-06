/**
 * DreamGraph MCP Server — Discipline System Types.
 *
 * Type definitions for the five-phase disciplinary execution model.
 * These types define tool classification, phase permissions, data protection
 * tiers, and the discipline manifest schema.
 *
 * See TDD_DISCIPLINARY_EXECUTION.md for full architecture documentation.
 * See ADR-001 through ADR-005 for design rationale.
 */

// ---------------------------------------------------------------------------
// Discipline Phases  (ADR-003: Five-Phase Disciplinary State Machine)
// ---------------------------------------------------------------------------

/**
 * The five sequential phases of disciplinary execution.
 *
 *   INGEST  → read-only ground truth gathering
 *   AUDIT   → delta analysis against source of truth
 *   PLAN    → structured implementation plan (JSON)
 *   EXECUTE → approved plan implementation (write-enabled)
 *   VERIFY  → post-execution re-audit
 */
export type DisciplinePhase =
  | "ingest"
  | "audit"
  | "plan"
  | "execute"
  | "verify";

/** Ordered list of phases for sequential enforcement */
export const PHASE_ORDER: readonly DisciplinePhase[] = [
  "ingest",
  "audit",
  "plan",
  "execute",
  "verify",
] as const;

// ---------------------------------------------------------------------------
// Tool Classification  (ADR-004: Tool Classification as First-Class Metadata)
// ---------------------------------------------------------------------------

/**
 * Every MCP tool belongs to exactly one class.
 *
 *   truth          — read-only ground truth (file reads, queries)
 *   analysis       — computation with no side effects (diagrams, plans)
 *   write          — modifies DreamGraph persistent state (ADR, UI registry)
 *   cognitive      — DreamGraph internal (dream cycles, scheduling)
 *   file_operation — modifies target project files (create/edit/delete)
 *   verification   — re-reads to confirm execution results
 */
export type ToolClass =
  | "truth"
  | "analysis"
  | "write"
  | "cognitive"
  | "file_operation"
  | "verification";

/**
 * Protection level restricts who/what can invoke a tool.
 *
 *   public         — available to all callers in permitted phases
 *   target-write   — modifies external state, requires plan entry
 *   privileged-only— modifies DreamGraph state, requires elevated permissions
 *   internal-only  — DreamGraph cognitive internals, never available externally
 */
export type ProtectionLevel =
  | "public"
  | "target-write"
  | "privileged-only"
  | "internal-only";

/**
 * Classification metadata attached to every registered tool.
 */
export interface ToolClassification {
  /** Human-readable tool name (matches MCP registration) */
  tool_name: string;
  /** Functional category */
  tool_class: ToolClass;
  /** Access restriction level */
  protection_level: ProtectionLevel;
  /** Phases in which this tool may be called */
  allowed_phases: DisciplinePhase[];
  /** If true, tool call must map to an approved plan item */
  requires_plan_entry: boolean;
  /** If true, every call is logged to discipline.log */
  requires_audit_trail: boolean;
}

// ---------------------------------------------------------------------------
// Phase Permissions
// ---------------------------------------------------------------------------

/**
 * What a caller is allowed to do during a specific phase.
 */
export interface PhasePermissions {
  phase: DisciplinePhase;
  allowed_tool_classes: ToolClass[];
  can_read_mcp: boolean;
  can_write_mcp: boolean;
  can_write_target: boolean;
  can_write_dreamgraph: boolean;
  /** Expected output format for this phase */
  output_format: string;
}

// ---------------------------------------------------------------------------
// Data Protection  (ADR-005: Three-Tier Data Protection Model)
// ---------------------------------------------------------------------------

/**
 * Protection tiers for data files.
 *
 *   forbidden      — Tier 1: never writable by external tasks (cognitive state)
 *   tool_mediated  — Tier 2: writable only through MCP tools during Execute
 *   seed_data      — Tier 3: read-only reference (project descriptions)
 */
export type DataProtectionTier =
  | "forbidden"
  | "tool_mediated"
  | "seed_data";

/**
 * Protection rule for a single data file.
 */
export interface DataProtectionRule {
  /** Filename (basename only) */
  filename: string;
  /** Protection tier */
  tier: DataProtectionTier;
  /** Human-readable description */
  description: string;
  /** For Tier 2: which MCP tools may write to this file */
  allowed_tools?: string[];
}

// ---------------------------------------------------------------------------
// Discipline Manifest  (ADR-001: Hybrid Wrapper Architecture)
// ---------------------------------------------------------------------------

/**
 * The discipline://manifest resource — machine-readable discipline rules.
 *
 * Wrappers read this on startup to build phase→allowed_tools maps,
 * enforce data protection, and manage the state machine.
 */
export interface DisciplineManifest {
  /** Schema version for forward compatibility */
  schema_version: string;
  /** DreamGraph server version */
  server_version: string;
  /** When this manifest was generated */
  generated_at: string;

  /** Tool classifications */
  tools: ToolClassification[];

  /** Phase permission definitions */
  phases: PhasePermissions[];

  /** Data file protection rules */
  data_protection: DataProtectionRule[];

  /** Phase transition rules */
  transitions: PhaseTransitionRule[];

  /** Mandatory tool invocation rules */
  mandatory_tools: MandatoryToolRule[];
}

// ---------------------------------------------------------------------------
// State Machine Transitions
// ---------------------------------------------------------------------------

/**
 * A rule governing transition between phases.
 */
export interface PhaseTransitionRule {
  from: DisciplinePhase | "start";
  to: DisciplinePhase;
  /** Human-readable description of what must be true */
  requires: string;
}

/**
 * Tools that MUST be called before a phase transition is allowed.
 */
export interface MandatoryToolRule {
  /** Phase where this rule applies */
  phase: DisciplinePhase;
  /** Tool name(s) — pipe-separated for alternatives */
  required_tool: string;
  /** Minimum number of calls */
  min_calls: number;
  /** Why this is required */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Task Session  (Phase 4: Wrapper MVP — runtime state)
// ---------------------------------------------------------------------------

/** Type of disciplinary task */
export type TaskType = "audit" | "port" | "reconstruction" | "modification";

/** Task session status */
export type SessionStatus = "active" | "completed" | "failed" | "abandoned";

/** Evidence supporting a delta classification */
export interface Evidence {
  tool_call_id: string;
  tool_name: string;
  summary: string;
  supports: "confirms" | "contradicts" | "partial";
}

/** Reference to a source of truth entry */
export interface SourceReference {
  type: "registry" | "source_file" | "database" | "workflow" | "adr" | "data_model";
  identifier: string;
  tool_call_id: string;
  excerpt?: string;
}

/** Reference to a target implementation file */
export interface TargetReference {
  file_path: string;
  line_range?: { start: number; end: number };
  tool_call_id: string;
  excerpt?: string;
}

/** Delta entry status */
export type DeltaStatus =
  | "confirmed_match"
  | "confirmed_gap"
  | "partial_match"
  | "not_yet_verified";

/** Severity of a gap or partial match */
export type DeltaSeverity = "critical" | "major" | "minor" | "cosmetic";

/** A single entry in the delta table */
export interface DeltaEntry {
  id: string;
  source_ref: SourceReference;
  target_ref: TargetReference | null;
  status: DeltaStatus;
  description: string;
  evidence: Evidence[];
  severity?: DeltaSeverity;
  discrepancies?: string[];
}

/** The full delta table produced during AUDIT or VERIFY */
export interface DeltaTable {
  schema_version: "1.0.0";
  session_id: string;
  instance_uuid: string;
  produced_at: string;
  produced_in_phase: "audit" | "verify";
  source_of_truth: {
    sources: SourceReference[];
    total_entries: number;
  };
  entries: DeltaEntry[];
  summary: {
    confirmed_matches: number;
    confirmed_gaps: number;
    partial_matches: number;
    not_yet_verified: number;
    total: number;
    parity_percentage: number;
  };
}

/** Risk level */
export type RiskLevel = "low" | "medium" | "high";

/** A single item in the implementation plan */
export interface PlanItem {
  id: string;
  priority: number;
  delta_entry_id: string;
  action: "create" | "modify" | "delete" | "register";
  target_file: string;
  change_description: string;
  source_truth_mapping: {
    source_type: string;
    source_identifier: string;
    what_it_requires: string;
  };
  risk: {
    level: RiskLevel;
    breaking_changes: string[];
    regressions: string[];
    dependencies: string[];
  };
  verification_criteria: {
    tool: string;
    expected_result: string;
    check_description: string;
  }[];
  execution_status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
}

/** Plan status */
export type PlanStatus = "draft" | "approved" | "in_progress" | "completed" | "abandoned";

/** Structured implementation plan */
export interface ImplementationPlan {
  schema_version: "1.0.0";
  session_id: string;
  instance_uuid: string;
  created_at: string;
  delta_table_id: string;
  description: string;
  status: PlanStatus;
  approved_at?: string;
  approved_by?: "human" | "system" | "auto";
  items: PlanItem[];
  risk_summary: {
    total_items: number;
    high_risk: number;
    medium_risk: number;
    low_risk: number;
    estimated_files_modified: number;
  };
}

/** Verification of a single plan item */
export interface ItemVerification {
  plan_item_id: string;
  delta_entry_id: string;
  tool_call_id: string;
  verified: boolean;
  verification_detail: string;
  evidence: Evidence[];
}

/** A regression detected during verification */
export interface RegressionEntry {
  delta_entry_id: string;
  was_status: "confirmed_match";
  now_status: "confirmed_gap" | "partial_match";
  cause: string;
  evidence: Evidence[];
}

/** Compliance status */
export type ComplianceStatus = "compliant" | "non_compliant" | "partial";

/** Verification report produced after EXECUTE phase */
export interface VerificationReport {
  schema_version: "1.0.0";
  session_id: string;
  instance_uuid: string;
  produced_at: string;
  plan_id: string;
  delta_table: DeltaTable;
  compliance: {
    status: ComplianceStatus;
    parity_percentage: number;
    total_entries: number;
    matched: number;
    gaps_remaining: number;
    regressions: number;
  };
  item_results: ItemVerification[];
  regressions: RegressionEntry[];
  recommendation: {
    action: "accept" | "re_plan" | "re_execute" | "escalate";
    justification: string;
    specific_items?: string[];
  };
}

/** Record of a tool call within a session */
export interface ToolCallRecord {
  id: string;
  timestamp: string;
  phase: DisciplinePhase;
  tool_name: string;
  tool_class: ToolClass;
  parameters: Record<string, unknown>;
  result_summary: string;
  allowed: boolean;
  duration_ms: number;
}

/** Record of a blocked action */
export interface BlockedActionRecord {
  timestamp: string;
  phase: DisciplinePhase;
  action: string;
  reason: string;
  rule_triggered: string;
}

/** Violation severity */
export type ViolationSeverity = "warning" | "error" | "critical";

/** Violation type */
export type ViolationType =
  | "unbacked_claim"
  | "unauthorized_write"
  | "phase_skip"
  | "scope_violation";

/** Record of a discipline violation */
export interface ViolationRecord {
  timestamp: string;
  phase: DisciplinePhase;
  violation_type: ViolationType;
  description: string;
  severity: ViolationSeverity;
  action_taken: "blocked" | "flagged" | "allowed_with_warning";
}

/** Phase transition record within a session */
export interface PhaseTransitionRecord {
  from: DisciplinePhase | "start";
  to: DisciplinePhase;
  timestamp: string;
  guard_check: {
    passed: boolean;
    reason?: string;
  };
}

/** The full task session — persisted to disk */
export interface TaskSession {
  schema_version: "1.0.0";
  id: string;
  instance_uuid: string;
  task: {
    type: TaskType;
    description: string;
    target_scope: string[];
    requires_ground_truth: boolean;
  };
  current_phase: DisciplinePhase;
  phase_history: PhaseTransitionRecord[];
  tool_calls: ToolCallRecord[];
  blocked_actions: BlockedActionRecord[];
  violations: ViolationRecord[];
  artifacts: {
    delta_tables: DeltaTable[];
    plans: ImplementationPlan[];
    verification_reports: VerificationReport[];
  };
  started_at: string;
  completed_at?: string;
  status: SessionStatus;
}
