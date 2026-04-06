/**
 * DreamGraph MCP Server — Discipline Artifact Generators.
 *
 * Structured generators for the three core disciplinary artifacts:
 * - Delta Table (AUDIT + VERIFY phases)
 * - Implementation Plan with validation (PLAN phase)
 * - Verification Report (VERIFY phase)
 *
 * TDD Phase 4 Tasks 4.3, 4.4, 4.5.
 */

import { randomUUID } from "node:crypto";
import { getActiveSession, attachDeltaTable, attachPlan, attachVerificationReport } from "./session.js";
import { logger } from "../utils/logger.js";
import type {
  DeltaTable,
  DeltaEntry,
  DeltaStatus,
  DeltaSeverity,
  SourceReference,
  TargetReference,
  Evidence,
  ImplementationPlan,
  PlanItem,
  PlanStatus,
  RiskLevel,
  VerificationReport,
  ItemVerification,
  RegressionEntry,
  ComplianceStatus,
  TaskSession,
} from "./types.js";

// ===========================================================================
// 4.3  Delta Table Generator
// ===========================================================================

/**
 * Validation errors for delta entries.
 */
export interface DeltaValidationError {
  entry_id: string;
  field: string;
  message: string;
}

/**
 * Validate a delta entry before adding it to a table.
 */
function validateDeltaEntry(entry: DeltaEntry): DeltaValidationError[] {
  const errors: DeltaValidationError[] = [];

  if (!entry.id || entry.id.trim().length === 0) {
    errors.push({ entry_id: entry.id ?? "unknown", field: "id", message: "Entry ID is required" });
  }

  if (!entry.source_ref?.identifier) {
    errors.push({ entry_id: entry.id, field: "source_ref", message: "Source reference with identifier is required" });
  }

  if (entry.status === "confirmed_match" && entry.evidence.length === 0) {
    errors.push({ entry_id: entry.id, field: "evidence", message: "CONFIRMED MATCH requires at least one evidence item" });
  }

  if (entry.status === "confirmed_gap" && !entry.severity) {
    errors.push({ entry_id: entry.id, field: "severity", message: "CONFIRMED GAP requires a severity rating" });
  }

  if (entry.status === "partial_match" && (!entry.discrepancies || entry.discrepancies.length === 0)) {
    errors.push({ entry_id: entry.id, field: "discrepancies", message: "PARTIAL MATCH requires at least one discrepancy description" });
  }

  if (!entry.source_ref?.tool_call_id) {
    errors.push({ entry_id: entry.id, field: "source_ref.tool_call_id", message: "Source reference must cite a tool call" });
  }

  if (entry.target_ref && !entry.target_ref.tool_call_id) {
    errors.push({ entry_id: entry.id, field: "target_ref.tool_call_id", message: "Target reference must cite a tool call" });
  }

  return errors;
}

/**
 * Compute delta summary statistics.
 */
function computeSummary(entries: DeltaEntry[]): DeltaTable["summary"] {
  const confirmed_matches = entries.filter((e) => e.status === "confirmed_match").length;
  const confirmed_gaps = entries.filter((e) => e.status === "confirmed_gap").length;
  const partial_matches = entries.filter((e) => e.status === "partial_match").length;
  const not_yet_verified = entries.filter((e) => e.status === "not_yet_verified").length;
  const total = entries.length;
  const parity_percentage = total > 0 ? Math.round((confirmed_matches / total) * 10000) / 100 : 0;

  return { confirmed_matches, confirmed_gaps, partial_matches, not_yet_verified, total, parity_percentage };
}

/**
 * Create a new delta table from entries.
 * Validates all entries and attaches to the active session.
 */
export async function createDeltaTable(opts: {
  entries: DeltaEntry[];
  sources: SourceReference[];
  phase?: "audit" | "verify";
}): Promise<{
  success: boolean;
  delta_table?: DeltaTable;
  validation_errors: DeltaValidationError[];
}> {
  const session = getActiveSession();
  if (!session || session.status !== "active") {
    return {
      success: false,
      validation_errors: [{ entry_id: "session", field: "session", message: "No active discipline session" }],
    };
  }

  const phase = opts.phase ?? (session.current_phase === "verify" ? "verify" : "audit");
  if (phase !== "audit" && phase !== "verify") {
    return {
      success: false,
      validation_errors: [{
        entry_id: "phase",
        field: "phase",
        message: `Delta tables can only be created in AUDIT or VERIFY phases (current: ${session.current_phase})`,
      }],
    };
  }

  // Validate all entries
  const allErrors: DeltaValidationError[] = [];
  for (const entry of opts.entries) {
    allErrors.push(...validateDeltaEntry(entry));
  }

  if (allErrors.length > 0) {
    return { success: false, validation_errors: allErrors };
  }

  const delta: DeltaTable = {
    schema_version: "1.0.0",
    session_id: session.id,
    instance_uuid: session.instance_uuid,
    produced_at: new Date().toISOString(),
    produced_in_phase: phase,
    source_of_truth: {
      sources: opts.sources,
      total_entries: opts.entries.length,
    },
    entries: opts.entries,
    summary: computeSummary(opts.entries),
  };

  await attachDeltaTable(delta);
  logger.info(
    `Delta table created: ${delta.summary.total} entries, ` +
    `${delta.summary.parity_percentage}% parity ` +
    `(session ${session.id}, phase ${phase})`,
  );

  return { success: true, delta_table: delta, validation_errors: [] };
}

/**
 * Check if a delta table is ready for plan phase transition.
 * All entries must be resolved (no NOT_YET_VERIFIED).
 */
export function isDeltaComplete(delta: DeltaTable): {
  complete: boolean;
  unresolved: DeltaEntry[];
  message: string;
} {
  const unresolved = delta.entries.filter((e) => e.status === "not_yet_verified");
  if (unresolved.length > 0) {
    return {
      complete: false,
      unresolved,
      message: `${unresolved.length} entries still NOT_YET_VERIFIED. All must be resolved before PLAN phase.`,
    };
  }
  return { complete: true, unresolved: [], message: "Delta table is complete — ready for PLAN phase" };
}

// ===========================================================================
// 4.4  Plan Validator
// ===========================================================================

export interface PlanValidationError {
  item_id?: string;
  field: string;
  message: string;
}

/**
 * Validate a single plan item.
 */
function validatePlanItem(item: PlanItem, deltaEntryIds: Set<string>): PlanValidationError[] {
  const errors: PlanValidationError[] = [];

  if (!item.id) {
    errors.push({ item_id: item.id, field: "id", message: "Plan item ID is required" });
  }

  if (!item.delta_entry_id) {
    errors.push({ item_id: item.id, field: "delta_entry_id", message: "Must reference a delta table entry" });
  } else if (!deltaEntryIds.has(item.delta_entry_id)) {
    errors.push({
      item_id: item.id,
      field: "delta_entry_id",
      message: `Delta entry '${item.delta_entry_id}' not found in any session delta table`,
    });
  }

  if (!item.target_file) {
    errors.push({ item_id: item.id, field: "target_file", message: "Target file path is required" });
  }

  if (!item.change_description || item.change_description.trim().length < 10) {
    errors.push({ item_id: item.id, field: "change_description", message: "Change description must be at least 10 characters" });
  }

  if (!item.source_truth_mapping?.source_identifier) {
    errors.push({ item_id: item.id, field: "source_truth_mapping", message: "Must map to a source truth entry" });
  }

  if (!item.verification_criteria || item.verification_criteria.length === 0) {
    errors.push({ item_id: item.id, field: "verification_criteria", message: "At least one verification criterion is required" });
  }

  // Validate risk assessment
  if (!item.risk) {
    errors.push({ item_id: item.id, field: "risk", message: "Risk assessment is required" });
  }

  return errors;
}

/**
 * Validate and create an implementation plan.
 * The plan must reference delta table entries from the active session.
 */
export async function validateAndCreatePlan(opts: {
  description: string;
  items: PlanItem[];
  auto_approve?: boolean;
}): Promise<{
  success: boolean;
  plan?: ImplementationPlan;
  validation_errors: PlanValidationError[];
}> {
  const session = getActiveSession();
  if (!session || session.status !== "active") {
    return {
      success: false,
      validation_errors: [{ field: "session", message: "No active discipline session" }],
    };
  }

  if (session.current_phase !== "plan") {
    return {
      success: false,
      validation_errors: [{
        field: "phase",
        message: `Plans can only be created in PLAN phase (current: ${session.current_phase})`,
      }],
    };
  }

  // Collect all delta entry IDs from session
  const deltaEntryIds = new Set<string>();
  for (const dt of session.artifacts.delta_tables) {
    for (const entry of dt.entries) {
      deltaEntryIds.add(entry.id);
    }
  }

  if (deltaEntryIds.size === 0) {
    return {
      success: false,
      validation_errors: [{ field: "delta_tables", message: "No delta tables found. Complete AUDIT phase first." }],
    };
  }

  // Validate all items
  const allErrors: PlanValidationError[] = [];
  for (const item of opts.items) {
    allErrors.push(...validatePlanItem(item, deltaEntryIds));
  }

  // Check that all gaps/partials have plan items
  const addressedDeltas = new Set(opts.items.map((i) => i.delta_entry_id));
  for (const dt of session.artifacts.delta_tables) {
    for (const entry of dt.entries) {
      if ((entry.status === "confirmed_gap" || entry.status === "partial_match") && !addressedDeltas.has(entry.id)) {
        allErrors.push({
          field: "coverage",
          message: `Delta entry '${entry.id}' (${entry.status}) has no plan item. All gaps and partial matches must be addressed.`,
        });
      }
    }
  }

  // Check for duplicate plan item IDs
  const itemIds = new Set<string>();
  for (const item of opts.items) {
    if (itemIds.has(item.id)) {
      allErrors.push({ item_id: item.id, field: "id", message: `Duplicate plan item ID: '${item.id}'` });
    }
    itemIds.add(item.id);
  }

  if (allErrors.length > 0) {
    return { success: false, validation_errors: allErrors };
  }

  // Compute risk summary
  const risk_summary = {
    total_items: opts.items.length,
    high_risk: opts.items.filter((i) => i.risk.level === "high").length,
    medium_risk: opts.items.filter((i) => i.risk.level === "medium").length,
    low_risk: opts.items.filter((i) => i.risk.level === "low").length,
    estimated_files_modified: new Set(opts.items.map((i) => i.target_file)).size,
  };

  const now = new Date().toISOString();
  const plan: ImplementationPlan = {
    schema_version: "1.0.0",
    session_id: session.id,
    instance_uuid: session.instance_uuid,
    created_at: now,
    delta_table_id: session.artifacts.delta_tables[session.artifacts.delta_tables.length - 1]?.session_id ?? session.id,
    description: opts.description,
    status: opts.auto_approve ? "approved" : "draft",
    approved_at: opts.auto_approve ? now : undefined,
    approved_by: opts.auto_approve ? "auto" : undefined,
    items: opts.items.map((item) => ({
      ...item,
      execution_status: "pending" as const,
    })),
    risk_summary,
  };

  await attachPlan(plan);
  logger.info(
    `Implementation plan created: ${plan.items.length} items, ` +
    `${risk_summary.high_risk} high-risk ` +
    `(session ${session.id}, status: ${plan.status})`,
  );

  return { success: true, plan, validation_errors: [] };
}

/**
 * Approve a draft plan (by plan index, default latest).
 */
export async function approvePlan(planIndex?: number): Promise<{
  success: boolean;
  message: string;
}> {
  const session = getActiveSession();
  if (!session) return { success: false, message: "No active session" };

  const idx = planIndex ?? session.artifacts.plans.length - 1;
  const plan = session.artifacts.plans[idx];
  if (!plan) return { success: false, message: `Plan at index ${idx} not found` };

  if (plan.status !== "draft") {
    return { success: false, message: `Plan is already '${plan.status}', cannot approve` };
  }

  plan.status = "approved";
  plan.approved_at = new Date().toISOString();
  plan.approved_by = "human";

  // Re-persist via attachPlan (which re-saves session)
  // We already mutated in place, just need to persist
  const { attachPlan: _attach } = await import("./session.js");
  // Session is already mutated — just need to trigger persistence
  // Simplest: call completeSession/loadSession? No — just re-import and call persist
  // Actually the session reference is shared, so we can call any session write op
  await recordToolCall(
    "discipline_approve_plan",
    { plan_index: idx },
    `Approved plan: ${plan.description}`,
    0,
  );

  return { success: true, message: `Plan approved: ${plan.description}` };
}

// Private import for recording
import { recordToolCall } from "./session.js";

// ===========================================================================
// 4.5  Verification Report Generator
// ===========================================================================

export interface VerificationError {
  field: string;
  message: string;
}

/**
 * Generate a verification report by comparing pre- and post-execution delta tables.
 *
 * The caller must provide a post-execution delta table (from VERIFY phase re-audit).
 * The generator compares it against the AUDIT-phase delta to detect regressions
 * and compute compliance.
 */
export async function generateVerificationReport(opts: {
  post_delta: DeltaTable;
  item_results: ItemVerification[];
}): Promise<{
  success: boolean;
  report?: VerificationReport;
  errors: VerificationError[];
}> {
  const session = getActiveSession();
  if (!session || session.status !== "active") {
    return { success: false, errors: [{ field: "session", message: "No active discipline session" }] };
  }

  if (session.current_phase !== "verify") {
    return {
      success: false,
      errors: [{ field: "phase", message: `Reports can only be generated in VERIFY phase (current: ${session.current_phase})` }],
    };
  }

  // Find the latest approved/completed plan
  const plan = [...session.artifacts.plans].reverse().find(
    (p) => p.status === "approved" || p.status === "in_progress" || p.status === "completed",
  );
  if (!plan) {
    return { success: false, errors: [{ field: "plan", message: "No approved plan found in session" }] };
  }

  // Find the AUDIT-phase delta for regression detection
  const auditDelta = session.artifacts.delta_tables.find((dt) => dt.produced_in_phase === "audit");

  // Detect regressions
  const regressions: RegressionEntry[] = [];
  if (auditDelta) {
    for (const auditEntry of auditDelta.entries) {
      if (auditEntry.status !== "confirmed_match") continue;
      const postEntry = opts.post_delta.entries.find((e) => e.id === auditEntry.id);
      if (postEntry && postEntry.status !== "confirmed_match") {
        regressions.push({
          delta_entry_id: auditEntry.id,
          was_status: "confirmed_match",
          now_status: postEntry.status as "confirmed_gap" | "partial_match",
          cause: `Was confirmed_match in audit, now ${postEntry.status} after execution`,
          evidence: postEntry.evidence,
        });
      }
    }
  }

  // Compute compliance
  const summary = opts.post_delta.summary;
  const gaps = summary.confirmed_gaps + summary.partial_matches + summary.not_yet_verified;
  let complianceStatus: ComplianceStatus;
  if (gaps === 0 && regressions.length === 0) {
    complianceStatus = "compliant";
  } else if (summary.parity_percentage >= 90 && regressions.length === 0) {
    complianceStatus = "partial";
  } else {
    complianceStatus = "non_compliant";
  }

  // Determine recommendation
  let action: VerificationReport["recommendation"]["action"];
  let justification: string;
  const specificItems: string[] = [];

  if (complianceStatus === "compliant") {
    action = "accept";
    justification = "All entries match. No regressions detected.";
  } else if (regressions.length > 0) {
    action = "re_plan";
    justification = `${regressions.length} regression(s) detected — changes broke previously working items. Re-planning needed.`;
    specificItems.push(...regressions.map((r) => r.delta_entry_id));
  } else if (summary.not_yet_verified > 0) {
    action = "re_execute";
    justification = `${summary.not_yet_verified} items still unverified. Re-execute with additional tool reads.`;
  } else {
    action = "re_plan";
    justification = `${gaps} gap(s) remaining (parity: ${summary.parity_percentage}%). Needs re-planning.`;
    specificItems.push(
      ...opts.post_delta.entries
        .filter((e) => e.status === "confirmed_gap" || e.status === "partial_match")
        .map((e) => e.id),
    );
  }

  const report: VerificationReport = {
    schema_version: "1.0.0",
    session_id: session.id,
    instance_uuid: session.instance_uuid,
    produced_at: new Date().toISOString(),
    plan_id: plan.session_id,
    delta_table: opts.post_delta,
    compliance: {
      status: complianceStatus,
      parity_percentage: summary.parity_percentage,
      total_entries: summary.total,
      matched: summary.confirmed_matches,
      gaps_remaining: gaps,
      regressions: regressions.length,
    },
    item_results: opts.item_results,
    regressions,
    recommendation: {
      action,
      justification,
      specific_items: specificItems.length > 0 ? specificItems : undefined,
    },
  };

  await attachVerificationReport(report);

  // Also attach the post-execution delta as a VERIFY-phase delta
  await attachDeltaTable(opts.post_delta);

  logger.info(
    `Verification report: ${complianceStatus} (${summary.parity_percentage}% parity, ` +
    `${regressions.length} regressions, session ${session.id})`,
  );

  return { success: true, report, errors: [] };
}
