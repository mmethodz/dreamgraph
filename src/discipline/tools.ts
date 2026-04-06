/**
 * DreamGraph MCP Server — Discipline Execution MCP Tools.
 *
 * Registers 9 MCP tools that provide runtime disciplinary enforcement:
 *
 *   discipline_start_session    — Start a new discipline task session
 *   discipline_transition       — Phase transition with guard checks
 *   discipline_check_tool       — Check if a tool call is permitted
 *   discipline_get_session      — Read current session state
 *   discipline_record_delta     — Submit delta table entries (AUDIT/VERIFY)
 *   discipline_submit_plan      — Validate and submit implementation plan (PLAN)
 *   discipline_approve_plan     — Approve a draft plan
 *   discipline_verify           — Generate verification report (VERIFY)
 *   discipline_complete_session — End the active session
 *
 * TDD Phase 4 Task 4.7: End-to-end registration.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { logger } from "../utils/logger.js";
import {
  startSession,
  transitionPhase,
  getActiveSession,
  completeSession,
  listSessions,
  loadSession,
} from "./session.js";
import {
  checkToolPermission,
  getPhaseToolSummary,
} from "./tool-proxy.js";
import {
  createDeltaTable,
  isDeltaComplete,
  validateAndCreatePlan,
  approvePlan,
  generateVerificationReport,
} from "./artifacts.js";
import { buildSystemPrompt, getAllowedToolNames } from "./prompts.js";
import type {
  DeltaEntry,
  SourceReference,
  PlanItem,
  ItemVerification,
  DeltaTable,
  TaskType,
  DisciplinePhase,
} from "./types.js";

// ---------------------------------------------------------------------------
// MCP content helpers
// ---------------------------------------------------------------------------

function textContent(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorContent(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: { code, message } }, null, 2) }],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Zod schemas for tool parameters
// ---------------------------------------------------------------------------

const EvidenceSchema = z.object({
  tool_call_id: z.string(),
  tool_name: z.string(),
  summary: z.string(),
  supports: z.enum(["confirms", "contradicts", "partial"]),
});

const SourceRefSchema = z.object({
  type: z.enum(["registry", "source_file", "database", "workflow", "adr", "data_model"]),
  identifier: z.string(),
  tool_call_id: z.string(),
  excerpt: z.string().optional(),
});

const TargetRefSchema = z.object({
  file_path: z.string(),
  line_range: z.object({ start: z.number(), end: z.number() }).optional(),
  tool_call_id: z.string(),
  excerpt: z.string().optional(),
});

const DeltaEntrySchema = z.object({
  id: z.string(),
  source_ref: SourceRefSchema,
  target_ref: TargetRefSchema.nullable(),
  status: z.enum(["confirmed_match", "confirmed_gap", "partial_match", "not_yet_verified"]),
  description: z.string(),
  evidence: z.array(EvidenceSchema),
  severity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
  discrepancies: z.array(z.string()).optional(),
});

const VerificationCriterionSchema = z.object({
  tool: z.string(),
  expected_result: z.string(),
  check_description: z.string(),
});

const RiskSchema = z.object({
  level: z.enum(["low", "medium", "high"]),
  breaking_changes: z.array(z.string()),
  regressions: z.array(z.string()),
  dependencies: z.array(z.string()),
});

const PlanItemSchema = z.object({
  id: z.string(),
  priority: z.number(),
  delta_entry_id: z.string(),
  action: z.enum(["create", "modify", "delete", "register"]),
  target_file: z.string(),
  change_description: z.string(),
  source_truth_mapping: z.object({
    source_type: z.string(),
    source_identifier: z.string(),
    what_it_requires: z.string(),
  }),
  risk: RiskSchema,
  verification_criteria: z.array(VerificationCriterionSchema),
});

const ItemVerificationSchema = z.object({
  plan_item_id: z.string(),
  delta_entry_id: z.string(),
  tool_call_id: z.string(),
  verified: z.boolean(),
  verification_detail: z.string(),
  evidence: z.array(EvidenceSchema),
});

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

export function registerDisciplineTools(server: McpServer): void {

  // -----------------------------------------------------------------------
  // discipline_start_session
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_start_session",
    "Start a new disciplinary task session. Enters the INGEST phase. " +
    "Only one session can be active at a time. " +
    "Returns the session ID and system prompt for the INGEST phase.",
    {
      type: z.enum(["audit", "port", "reconstruction", "modification"])
        .describe("Type of disciplinary task"),
      description: z.string()
        .describe("Description of what this task is about"),
      target_scope: z.array(z.string())
        .describe("File paths or directories in scope for this task"),
      requires_ground_truth: z.boolean().optional()
        .describe("Whether all claims must have tool evidence (default: true)"),
    },
    async (params) => {
      try {
        const session = await startSession({
          type: params.type as TaskType,
          description: params.description,
          target_scope: params.target_scope,
          requires_ground_truth: params.requires_ground_truth,
        });

        const prompt = buildSystemPrompt(session);
        const tools = getAllowedToolNames(session.current_phase);

        return textContent({
          success: true,
          session_id: session.id,
          phase: session.current_phase,
          allowed_tools: tools,
          system_prompt: prompt,
          message: "Session started. You are in INGEST phase. Use truth tools to gather ground truth.",
        });
      } catch (err) {
        return errorContent("SESSION_ERROR", err instanceof Error ? err.message : String(err));
      }
    },
  );

  // -----------------------------------------------------------------------
  // discipline_transition
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_transition",
    "Transition the active discipline session to a new phase. " +
    "Validates state machine rules and mandatory tool requirements. " +
    "Returns the updated system prompt for the new phase.",
    {
      target_phase: z.enum(["ingest", "audit", "plan", "execute", "verify"])
        .describe("The phase to transition to"),
      justification: z.string().optional()
        .describe("Why this transition is appropriate (required for loopbacks)"),
    },
    async (params) => {
      const result = await transitionPhase(
        params.target_phase as DisciplinePhase,
        params.justification,
      );

      if (!result.success) {
        return errorContent("TRANSITION_BLOCKED", result.reason);
      }

      const prompt = buildSystemPrompt(result.session);
      const tools = getAllowedToolNames(result.session.current_phase);
      const summary = getPhaseToolSummary(result.session.current_phase);

      return textContent({
        success: true,
        phase: result.session.current_phase,
        allowed_tools: tools,
        blocked_classes: summary.blocked_classes,
        system_prompt: prompt,
        message: `Transitioned to ${result.session.current_phase.toUpperCase()} phase. ${result.reason}`,
      });
    },
  );

  // -----------------------------------------------------------------------
  // discipline_check_tool
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_check_tool",
    "Check whether a specific tool call is permitted in the current discipline phase. " +
    "Returns permission status, classification, and any warnings. " +
    "Use this before calling a tool to validate it's allowed.",
    {
      tool_name: z.string()
        .describe("Name of the MCP tool to check"),
      target_file: z.string().optional()
        .describe("Target file path (for write tools — validates data protection)"),
    },
    async (params) => {
      const check = checkToolPermission(params.tool_name, params.target_file);
      return textContent({
        success: true,
        permitted: check.permitted,
        reason: check.reason,
        phase: check.phase,
        tool_class: check.classification?.tool_class ?? "unknown",
        protection_level: check.classification?.protection_level ?? "unknown",
        requires_plan_entry: check.requires_plan_entry,
        warnings: check.warnings,
      });
    },
  );

  // -----------------------------------------------------------------------
  // discipline_get_session
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_get_session",
    "Get the current discipline session state, including phase, tool call history, " +
    "artifacts, blocked actions, and violations. " +
    "Can also list all sessions or load a specific session by ID.",
    {
      session_id: z.string().optional()
        .describe("Specific session ID to load (omit for active session)"),
      list_all: z.boolean().optional()
        .describe("List all sessions instead of returning one"),
      include_prompt: z.boolean().optional()
        .describe("Include the current system prompt in the response"),
    },
    async (params) => {
      if (params.list_all) {
        const sessions = await listSessions();
        return textContent({ success: true, sessions, count: sessions.length });
      }

      let session;
      if (params.session_id) {
        try {
          session = await loadSession(params.session_id);
        } catch {
          return errorContent("NOT_FOUND", `Session ${params.session_id} not found`);
        }
      } else {
        session = getActiveSession();
        if (!session) {
          return errorContent("NO_SESSION", "No active discipline session. Start one with discipline_start_session.");
        }
      }

      const result: Record<string, unknown> = {
        success: true,
        id: session.id,
        status: session.status,
        phase: session.current_phase,
        task: session.task,
        started_at: session.started_at,
        completed_at: session.completed_at,
        phase_history: session.phase_history,
        tool_call_count: session.tool_calls.length,
        blocked_count: session.blocked_actions.length,
        violation_count: session.violations.length,
        artifacts: {
          delta_tables: session.artifacts.delta_tables.length,
          plans: session.artifacts.plans.length,
          verification_reports: session.artifacts.verification_reports.length,
        },
        recent_tool_calls: session.tool_calls.slice(-10).map((tc) => ({
          tool: tc.tool_name,
          phase: tc.phase,
          allowed: tc.allowed,
          timestamp: tc.timestamp,
        })),
        blocked_actions: session.blocked_actions.slice(-5),
        violations: session.violations.slice(-5),
      };

      if (params.include_prompt) {
        result.system_prompt = buildSystemPrompt(session);
      }

      return textContent(result);
    },
  );

  // -----------------------------------------------------------------------
  // discipline_record_delta
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_record_delta",
    "Submit delta table entries during AUDIT or VERIFY phase. " +
    "Each entry compares a source-of-truth element against the target implementation. " +
    "Validates that all entries have proper evidence and classifications.",
    {
      entries: z.array(DeltaEntrySchema)
        .describe("Array of delta entries to record"),
      sources: z.array(SourceRefSchema)
        .describe("Sources of truth that were queried"),
      phase: z.enum(["audit", "verify"]).optional()
        .describe("Override phase (defaults to current session phase)"),
    },
    async (params) => {
      const result = await createDeltaTable({
        entries: params.entries as DeltaEntry[],
        sources: params.sources as SourceReference[],
        phase: params.phase as "audit" | "verify" | undefined,
      });

      if (!result.success) {
        return errorContent("VALIDATION_ERROR", JSON.stringify(result.validation_errors, null, 2));
      }

      const dt = result.delta_table!;
      const completeness = isDeltaComplete(dt);

      return textContent({
        success: true,
        delta_table_id: dt.session_id,
        summary: dt.summary,
        complete: completeness.complete,
        completeness_message: completeness.message,
        message: `Delta table recorded: ${dt.summary.total} entries, ${dt.summary.parity_percentage}% parity`,
      });
    },
  );

  // -----------------------------------------------------------------------
  // discipline_submit_plan
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_submit_plan",
    "Submit a structured implementation plan during PLAN phase. " +
    "Validates that every plan item maps to a delta table entry, " +
    "has proper risk assessment, and includes verification criteria. " +
    "Plans start as 'draft' unless auto_approve is true.",
    {
      description: z.string()
        .describe("Overall plan description"),
      items: z.array(PlanItemSchema)
        .describe("Array of plan items, each addressing a delta table entry"),
      auto_approve: z.boolean().optional()
        .describe("Auto-approve the plan (default: false, requires discipline_approve_plan)"),
    },
    async (params) => {
      const result = await validateAndCreatePlan({
        description: params.description,
        items: params.items as PlanItem[],
        auto_approve: params.auto_approve,
      });

      if (!result.success) {
        return errorContent("PLAN_VALIDATION_ERROR", JSON.stringify(result.validation_errors, null, 2));
      }

      const plan = result.plan!;
      return textContent({
        success: true,
        plan_status: plan.status,
        items_count: plan.items.length,
        risk_summary: plan.risk_summary,
        message: plan.status === "approved"
          ? `Plan approved with ${plan.items.length} items. Ready for EXECUTE phase.`
          : `Plan created as DRAFT with ${plan.items.length} items. Call discipline_approve_plan to approve.`,
      });
    },
  );

  // -----------------------------------------------------------------------
  // discipline_approve_plan
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_approve_plan",
    "Approve a draft implementation plan. " +
    "Only draft plans can be approved. Once approved, the session " +
    "can transition to EXECUTE phase.",
    {
      plan_index: z.number().optional()
        .describe("Index of the plan to approve (default: latest plan)"),
    },
    async (params) => {
      const result = await approvePlan(params.plan_index);
      if (!result.success) {
        return errorContent("APPROVE_FAILED", result.message);
      }
      return textContent({ success: true, message: result.message });
    },
  );

  // -----------------------------------------------------------------------
  // discipline_verify
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_verify",
    "Generate a verification report during VERIFY phase. " +
    "Requires a post-execution delta table (from re-auditing modified files) " +
    "and per-item verification results. " +
    "Compares against the AUDIT-phase delta to detect regressions.",
    {
      post_delta_entries: z.array(DeltaEntrySchema)
        .describe("Post-execution delta entries from re-audit"),
      post_delta_sources: z.array(SourceRefSchema)
        .describe("Sources queried during verification"),
      item_results: z.array(ItemVerificationSchema)
        .describe("Per-plan-item verification results"),
    },
    async (params) => {
      const session = getActiveSession();
      if (!session) {
        return errorContent("NO_SESSION", "No active discipline session");
      }

      const postDelta: DeltaTable = {
        schema_version: "1.0.0",
        session_id: session.id,
        instance_uuid: session.instance_uuid,
        produced_at: new Date().toISOString(),
        produced_in_phase: "verify",
        source_of_truth: {
          sources: params.post_delta_sources as SourceReference[],
          total_entries: params.post_delta_entries.length,
        },
        entries: params.post_delta_entries as DeltaEntry[],
        summary: computeInlineSummary(params.post_delta_entries as DeltaEntry[]),
      };

      const result = await generateVerificationReport({
        post_delta: postDelta,
        item_results: params.item_results as ItemVerification[],
      });

      if (!result.success) {
        return errorContent("VERIFY_ERROR", JSON.stringify(result.errors, null, 2));
      }

      const report = result.report!;
      return textContent({
        success: true,
        compliance: report.compliance,
        regressions: report.regressions.length,
        recommendation: report.recommendation,
        message: `Verification: ${report.compliance.status.toUpperCase()} — ` +
          `${report.compliance.parity_percentage}% parity, ` +
          `${report.compliance.gaps_remaining} gaps, ` +
          `${report.regressions.length} regressions. ` +
          `Recommendation: ${report.recommendation.action}`,
      });
    },
  );

  // -----------------------------------------------------------------------
  // discipline_complete_session
  // -----------------------------------------------------------------------
  server.tool(
    "discipline_complete_session",
    "Complete or abandon the active discipline session. " +
    "Marks the session with the given status and persists final state.",
    {
      status: z.enum(["completed", "failed", "abandoned"])
        .describe("Final session status"),
    },
    async (params) => {
      try {
        const session = await completeSession(params.status as "completed" | "failed" | "abandoned");
        return textContent({
          success: true,
          session_id: session.id,
          status: session.status,
          duration_ms: session.completed_at
            ? new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()
            : 0,
          tool_calls: session.tool_calls.length,
          blocked: session.blocked_actions.length,
          violations: session.violations.length,
          message: `Session ${session.id} ${params.status}.`,
        });
      } catch (err) {
        return errorContent("SESSION_ERROR", err instanceof Error ? err.message : String(err));
      }
    },
  );

  logger.info("Registered 9 discipline execution tools");
}

// ---------------------------------------------------------------------------
// Inline summary helper (avoids circular import)
// ---------------------------------------------------------------------------

function computeInlineSummary(entries: DeltaEntry[]): DeltaTable["summary"] {
  const confirmed_matches = entries.filter((e) => e.status === "confirmed_match").length;
  const confirmed_gaps = entries.filter((e) => e.status === "confirmed_gap").length;
  const partial_matches = entries.filter((e) => e.status === "partial_match").length;
  const not_yet_verified = entries.filter((e) => e.status === "not_yet_verified").length;
  const total = entries.length;
  const parity_percentage = total > 0 ? Math.round((confirmed_matches / total) * 10000) / 100 : 0;
  return { confirmed_matches, confirmed_gaps, partial_matches, not_yet_verified, total, parity_percentage };
}
