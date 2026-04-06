/**
 * DreamGraph MCP Server — Tool Proxy with Phase Filtering.
 *
 * Runtime enforcement layer that checks every tool call against
 * the current discipline session's phase permissions. Called by
 * the discipline_check_tool MCP tool or by wrappers before
 * proxying a tool call.
 *
 * TDD Phase 4 Task 4.2: Tool proxy with phase filtering.
 */

import { getToolClassification, getToolsForPhase } from "./manifest.js";
import { getActiveSession, recordToolCall, recordViolation } from "./session.js";
import { canWriteFile } from "./protection.js";
import type {
  DisciplinePhase,
  ToolClassification,
  ViolationRecord,
} from "./types.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Check result
// ---------------------------------------------------------------------------

export interface ToolCheckResult {
  /** Whether the tool call is permitted */
  permitted: boolean;
  /** Human-readable reason */
  reason: string;
  /** The tool classification (if known) */
  classification: ToolClassification | null;
  /** Current phase */
  phase: DisciplinePhase | null;
  /** Whether a plan entry is required for this tool */
  requires_plan_entry: boolean;
  /** Warnings (permitted but flagged) */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Core proxy check
// ---------------------------------------------------------------------------

/**
 * Check whether a tool call is permitted in the current discipline session.
 *
 * If no session is active, all tools are permitted (non-disciplinary mode).
 * If a session is active, the tool must be classified and permitted
 * in the current phase.
 */
export function checkToolPermission(
  toolName: string,
  targetFile?: string,
): ToolCheckResult {
  const session = getActiveSession();
  const warnings: string[] = [];

  // No active session → everything allowed
  if (!session || session.status !== "active") {
    return {
      permitted: true,
      reason: "No active discipline session — all tools permitted",
      classification: getToolClassification(toolName) ?? null,
      phase: null,
      requires_plan_entry: false,
      warnings: [],
    };
  }

  const phase = session.current_phase;
  const classification = getToolClassification(toolName);

  // Unknown tool
  if (!classification) {
    return {
      permitted: false,
      reason: `Tool '${toolName}' is not classified in the discipline manifest. Cannot verify phase permissions.`,
      classification: null,
      phase,
      requires_plan_entry: false,
      warnings: ["Unclassified tool — contact maintainer to add classification"],
    };
  }

  // Cognitive tools are never available in discipline sessions
  if (classification.tool_class === "cognitive") {
    return {
      permitted: false,
      reason: `Tool '${toolName}' is a cognitive-internal tool. Not available during disciplinary execution.`,
      classification,
      phase,
      requires_plan_entry: false,
      warnings: [],
    };
  }

  // Check phase permission
  if (classification.allowed_phases.length > 0 && !classification.allowed_phases.includes(phase)) {
    return {
      permitted: false,
      reason: `Tool '${toolName}' (class: ${classification.tool_class}) not permitted in phase '${phase}'. ` +
        `Allowed phases: ${classification.allowed_phases.join(", ")}`,
      classification,
      phase,
      requires_plan_entry: classification.requires_plan_entry,
      warnings: [],
    };
  }

  // Write tools: check protection tier if target file is provided
  if (targetFile && (classification.tool_class === "write" || classification.tool_class === "file_operation")) {
    const writeCheck = canWriteFile(targetFile, phase, toolName);
    if (!writeCheck.allowed) {
      return {
        permitted: false,
        reason: `Write blocked: ${writeCheck.reason}`,
        classification,
        phase,
        requires_plan_entry: classification.requires_plan_entry,
        warnings: [],
      };
    }
  }

  // Plan entry required?
  if (classification.requires_plan_entry) {
    const plans = session.artifacts.plans;
    const activePlan = plans.find((p) => p.status === "approved" || p.status === "in_progress");
    if (!activePlan) {
      warnings.push("This tool requires a plan entry but no approved plan exists yet");
    } else if (targetFile) {
      const hasEntry = activePlan.items.some(
        (item) => item.target_file === targetFile && item.execution_status === "pending",
      );
      if (!hasEntry) {
        warnings.push(`No pending plan entry found for target file '${targetFile}'`);
      }
    }
  }

  return {
    permitted: true,
    reason: `Tool '${toolName}' (class: ${classification.tool_class}) permitted in phase '${phase}'`,
    classification,
    phase,
    requires_plan_entry: classification.requires_plan_entry,
    warnings,
  };
}

/**
 * Full proxy: check permission, record the call, and return the verdict.
 *
 * This combines permission checking with session recording —
 * call this from tool handlers or wrapper middleware.
 */
export async function proxyToolCall(opts: {
  toolName: string;
  parameters: Record<string, unknown>;
  targetFile?: string;
  resultSummary?: string;
  durationMs?: number;
}): Promise<ToolCheckResult> {
  const check = checkToolPermission(opts.toolName, opts.targetFile);

  // Record in session (if active)
  await recordToolCall(
    opts.toolName,
    opts.parameters,
    opts.resultSummary ?? (check.permitted ? "permitted" : `BLOCKED: ${check.reason}`),
    opts.durationMs ?? 0,
  );

  // Record violation if blocked
  if (!check.permitted) {
    const violation: ViolationRecord = {
      timestamp: new Date().toISOString(),
      phase: check.phase ?? "ingest",
      violation_type: check.classification?.tool_class === "cognitive"
        ? "scope_violation"
        : "unauthorized_write",
      description: check.reason,
      severity: "error",
      action_taken: "blocked",
    };
    await recordViolation(violation);
    logger.warn(`Discipline BLOCKED: ${opts.toolName} — ${check.reason}`);
  }

  return check;
}

/**
 * Get a summary of tool permissions for the current phase.
 * Useful for wrappers building tool-filtering UI.
 */
export function getPhaseToolSummary(phase?: DisciplinePhase): {
  phase: DisciplinePhase;
  permitted_tools: string[];
  blocked_classes: string[];
  total_permitted: number;
} {
  const session = getActiveSession();
  const effectivePhase = phase ?? session?.current_phase ?? "ingest";
  const permitted = getToolsForPhase(effectivePhase);
  const permittedNames = permitted.map((t) => t.tool_name);

  const allClasses = ["truth", "analysis", "write", "cognitive", "file_operation", "verification"];
  const permittedClasses = new Set(permitted.map((t) => t.tool_class));
  const blocked = allClasses.filter((c) => !permittedClasses.has(c as any));

  return {
    phase: effectivePhase,
    permitted_tools: permittedNames,
    blocked_classes: blocked,
    total_permitted: permittedNames.length,
  };
}
