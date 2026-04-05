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
