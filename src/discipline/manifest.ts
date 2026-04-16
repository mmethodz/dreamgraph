/**
 * DreamGraph MCP Server — Discipline Manifest Builder.
 *
 * Builds the discipline://manifest resource — a machine-readable
 * declaration of all tool classifications, phase permissions, data
 * protection rules, transition rules, and mandatory tool requirements.
 *
 * Wrappers read this manifest on startup to understand DreamGraph's
 * discipline model without hardcoding any rules.
 *
 * See ADR-001: Hybrid Wrapper Architecture.
 */

import { config } from "../config/config.js";
import { DATA_PROTECTION_RULES } from "./protection.js";
import { TRANSITION_RULES } from "./state-machine.js";
import type {
  DisciplineManifest,
  DisciplinePhase,
  MandatoryToolRule,
  PhasePermissions,
  ToolClassification,
} from "./types.js";

// ---------------------------------------------------------------------------
// All five phases for truth tools
// ---------------------------------------------------------------------------
const ALL_PHASES: DisciplinePhase[] = [
  "ingest",
  "audit",
  "plan",
  "execute",
  "verify",
];

const TRUTH_PHASES: DisciplinePhase[] = [
  "ingest",
  "audit",
  "plan",
  "execute",
  "verify",
];

const ANALYSIS_PHASES: DisciplinePhase[] = [
  "ingest",
  "audit",
  "plan",
  "verify",
];

// ---------------------------------------------------------------------------
// Tool Classifications  (ADR-004)
// ---------------------------------------------------------------------------

/**
 * Complete classification of all 53 MCP tools.
 */
export const TOOL_CLASSIFICATIONS: ToolClassification[] = [
  // =====================================================================
  // TRUTH TOOLS — Read-only ground truth (22 tools)
  // =====================================================================

  // -- Utility / Sense tools --
  {
    tool_name: "query_resource",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "search_data_model",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_workflow",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "query_ui_elements",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "query_architecture_decisions",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "read_source_code",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  // Local extension tools — equivalent truth reads performed outside MCP transport
  {
    tool_name: "read_local_file",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "query_api_surface",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "extract_api_surface",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "list_directory",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "git_log",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "git_blame",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "fetch_web_page",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "query_db_schema",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "query_runtime_metrics",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },

  // -- Cognitive read-only tools --
  {
    tool_name: "cognitive_status",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "query_dreams",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_dream_insights",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_causal_insights",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_temporal_insights",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_system_narrative",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_system_story",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "list_schedules",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_schedule_history",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "metacognitive_analysis",
    tool_class: "truth",
    protection_level: "public",
    allowed_phases: TRUTH_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },

  // =====================================================================
  // ANALYSIS TOOLS — Computation, no side effects (4 tools)
  // =====================================================================
  {
    tool_name: "generate_visual_flow",
    tool_class: "analysis",
    protection_level: "public",
    allowed_phases: ANALYSIS_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "generate_ui_migration_plan",
    tool_class: "analysis",
    protection_level: "public",
    allowed_phases: ["audit", "plan"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "get_remediation_plan",
    tool_class: "analysis",
    protection_level: "public",
    allowed_phases: ["audit", "plan"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "export_living_docs",
    tool_class: "analysis",
    protection_level: "public",
    allowed_phases: ["audit", "verify"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },

  // =====================================================================
  // WRITE TOOLS — Modify DreamGraph state (5 tools)
  // =====================================================================
  {
    tool_name: "record_architecture_decision",
    tool_class: "write",
    protection_level: "target-write",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },
  {
    tool_name: "deprecate_architecture_decision",
    tool_class: "write",
    protection_level: "target-write",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },
  {
    tool_name: "register_ui_element",
    tool_class: "write",
    protection_level: "target-write",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },
  {
    tool_name: "solidify_cognitive_insight",
    tool_class: "write",
    protection_level: "privileged-only",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },
  {
    tool_name: "resolve_tension",
    tool_class: "write",
    protection_level: "privileged-only",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },
  {
    tool_name: "enrich_seed_data",
    tool_class: "write",
    protection_level: "target-write",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },

  // =====================================================================
  // FILE OPERATION TOOLS — Target project writes (1 tool)
  // =====================================================================
  {
    tool_name: "create_file",
    tool_class: "file_operation",
    protection_level: "target-write",
    allowed_phases: ["execute"],
    requires_plan_entry: true,
    requires_audit_trail: true,
  },

  // =====================================================================
  // COGNITIVE TOOLS — DreamGraph internal only (11 tools)
  // =====================================================================
  {
    tool_name: "dream_cycle",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "normalize_dreams",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "nightmare_cycle",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "clear_dreams",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "dispatch_cognitive_event",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "schedule_dream",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "update_schedule",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "delete_schedule",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "run_schedule_now",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "export_dream_archetypes",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "import_dream_archetypes",
    tool_class: "cognitive",
    protection_level: "internal-only",
    allowed_phases: [],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },

  // =====================================================================
  // VERIFICATION / DISCIPLINE TOOLS — Session lifecycle & enforcement (9 tools)
  // =====================================================================

  {
    tool_name: "discipline_start_session",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ALL_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "discipline_transition",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ALL_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "discipline_check_tool",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ALL_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: false,
  },
  {
    tool_name: "discipline_get_session",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ALL_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: false,
  },
  {
    tool_name: "discipline_record_delta",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ["audit", "verify"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "discipline_submit_plan",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ["plan"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "discipline_approve_plan",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ["plan"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "discipline_verify",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ["verify"],
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
  {
    tool_name: "discipline_complete_session",
    tool_class: "verification",
    protection_level: "public",
    allowed_phases: ALL_PHASES,
    requires_plan_entry: false,
    requires_audit_trail: true,
  },
];

// ---------------------------------------------------------------------------
// Phase Permissions
// ---------------------------------------------------------------------------

export const PHASE_PERMISSIONS: PhasePermissions[] = [
  {
    phase: "ingest",
    allowed_tool_classes: ["truth", "analysis", "verification"],
    can_read_mcp: true,
    can_write_mcp: false,
    can_write_target: false,
    can_write_dreamgraph: false,
    output_format: "SourceTruthContext",
  },
  {
    phase: "audit",
    allowed_tool_classes: ["truth", "analysis", "verification"],
    can_read_mcp: true,
    can_write_mcp: false,
    can_write_target: false,
    can_write_dreamgraph: false,
    output_format: "DeltaTable",
  },
  {
    phase: "plan",
    allowed_tool_classes: ["truth", "analysis", "verification"],
    can_read_mcp: true,
    can_write_mcp: false,
    can_write_target: false,
    can_write_dreamgraph: false,
    output_format: "ImplementationPlan",
  },
  {
    phase: "execute",
    allowed_tool_classes: ["truth", "write", "file_operation", "verification"],
    can_read_mcp: true,
    can_write_mcp: true,
    can_write_target: true,
    can_write_dreamgraph: false,
    output_format: "ExecutionReport",
  },
  {
    phase: "verify",
    allowed_tool_classes: ["truth", "analysis", "verification"],
    can_read_mcp: true,
    can_write_mcp: false,
    can_write_target: false,
    can_write_dreamgraph: false,
    output_format: "VerificationReport",
  },
];

// ---------------------------------------------------------------------------
// Mandatory Tool Rules
// ---------------------------------------------------------------------------

export const MANDATORY_TOOL_RULES: MandatoryToolRule[] = [
  {
    phase: "ingest",
    // read_local_file and query_api_surface are local-tool equivalents of read_source_code.
    // They perform the same ground-truth read but via the VS Code extension host rather
    // than the MCP transport. All three satisfy the ingest gate.
    required_tool: "read_source_code|read_local_file|query_api_surface",
    min_calls: 1,
    rationale: "Cannot audit without reading at least one source file (read_source_code, read_local_file, or query_api_surface all satisfy this)",
  },
  {
    phase: "ingest",
    required_tool:
      "query_ui_elements|search_data_model|get_workflow|query_architecture_decisions",
    min_calls: 1,
    rationale: "At least one registry/truth query must be made",
  },
  {
    phase: "verify",
    required_tool: "read_source_code|read_local_file",
    min_calls: 1,
    rationale:
      "Verification must re-read modified source to confirm changes (read_source_code or read_local_file both satisfy this)",
  },
];

// ---------------------------------------------------------------------------
// Manifest Builder
// ---------------------------------------------------------------------------

/**
 * Build the complete discipline manifest.
 *
 * Called once at server startup. The result is served as the
 * `discipline://manifest` MCP resource.
 */
export function buildManifest(): DisciplineManifest {
  return {
    schema_version: "1.0.0",
    server_version: config.server.version,
    generated_at: new Date().toISOString(),
    tools: TOOL_CLASSIFICATIONS,
    phases: PHASE_PERMISSIONS,
    data_protection: DATA_PROTECTION_RULES,
    transitions: TRANSITION_RULES,
    mandatory_tools: MANDATORY_TOOL_RULES,
  };
}

// ---------------------------------------------------------------------------
// Convenience Look-ups
// ---------------------------------------------------------------------------

/** Map from tool name → classification (O(1) lookup) */
const _toolMap = new Map<string, ToolClassification>(
  TOOL_CLASSIFICATIONS.map((t) => [t.tool_name, t])
);

/**
 * Get the classification for a tool by name.
 * Returns undefined if the tool is not classified.
 */
export function getToolClassification(
  toolName: string
): ToolClassification | undefined {
  return _toolMap.get(toolName);
}

/**
 * Get all tools permitted in a given phase.
 */
export function getToolsForPhase(
  phase: DisciplinePhase
): ToolClassification[] {
  return TOOL_CLASSIFICATIONS.filter((t) =>
    t.allowed_phases.includes(phase)
  );
}

/**
 * Get all tools in a given class.
 */
export function getToolsByClass(
  toolClass: string
): ToolClassification[] {
  return TOOL_CLASSIFICATIONS.filter((t) => t.tool_class === toolClass);
}

/**
 * Summary counts for logging / diagnostics.
 */
export function getManifestSummary(): Record<string, number> {
  const byClass: Record<string, number> = {};
  for (const t of TOOL_CLASSIFICATIONS) {
    byClass[t.tool_class] = (byClass[t.tool_class] ?? 0) + 1;
  }
  return {
    total_tools: TOOL_CLASSIFICATIONS.length,
    ...byClass,
    data_protection_rules: DATA_PROTECTION_RULES.length,
    transition_rules: TRANSITION_RULES.length,
    mandatory_tool_rules: MANDATORY_TOOL_RULES.length,
  };
}
