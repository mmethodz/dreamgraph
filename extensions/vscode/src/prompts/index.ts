/**
 * Prompt Assembler — composes the Architect system prompt from
 * core identity + task overlay + context block + autonomy/reporting contracts.
 *
 * @see TDD §7.5 (Prompt Architecture), §7.4 (Chat Flow)
 */

import { ARCHITECT_CORE } from "./architect-core.js";
import { ARCHITECT_EXPLAIN } from "./architect-explain.js";
import { ARCHITECT_VALIDATE } from "./architect-validate.js";
import { ARCHITECT_PATCH } from "./architect-patch.js";
import { ARCHITECT_SUGGEST } from "./architect-suggest.js";
import type { EditorContextEnvelope } from "../types.js";
import { getAutonomyInstructionBlock, type AutonomyInstructionState } from "../autonomy.js";
import { getStructuredResponseContractBlock } from "../autonomy-contract.js";
import { getReportingInstructionBlock } from "../reporting.js";

/* ------------------------------------------------------------------ */
/*  Task types                                                        */
/* ------------------------------------------------------------------ */

export type ArchitectTask =
  | "explain"
  | "validate"
  | "patch"
  | "suggest"
  | "chat";

/* ------------------------------------------------------------------ */
/*  Overlay selection                                                 */
/* ------------------------------------------------------------------ */

const TASK_OVERLAYS: Record<ArchitectTask, string> = {
  explain: ARCHITECT_EXPLAIN,
  validate: ARCHITECT_VALIDATE,
  patch: ARCHITECT_PATCH,
  suggest: ARCHITECT_SUGGEST,
  chat: "", // Free-form chat — no extra overlay
};

/* ------------------------------------------------------------------ */
/*  Context block formatting                                          */
/* ------------------------------------------------------------------ */

/**
 * Format the EditorContextEnvelope into a markdown context block
 * that the Architect can reference.
 */
function formatContextBlock(envelope: EditorContextEnvelope): string {
  const parts: string[] = ["## Context"];

  // Instance & workspace
  if (envelope.instanceId) {
    parts.push(`- **Instance:** ${envelope.instanceId}`);
  }
  parts.push(`- **Workspace:** ${envelope.workspaceRoot}`);
  parts.push(`- **Intent:** ${envelope.intentMode} (confidence: ${envelope.intentConfidence.toFixed(2)})`);

  // Active file
  if (envelope.activeFile) {
    const af = envelope.activeFile;
    parts.push(
      `- **Active file:** \`${af.path}\` (${af.languageId}, ${af.lineCount} lines, cursor at L${af.cursorLine}:C${af.cursorColumn})`,
    );
    if (af.selection) {
      parts.push(
        `- **Selection:** lines ${af.selection.startLine}–${af.selection.endLine}`,
      );
    }
  }

  // Visible & changed files
  if (envelope.visibleFiles.length > 0) {
    parts.push(`- **Visible files:** ${envelope.visibleFiles.join(", ")}`);
  }
  if (envelope.changedFiles.length > 0) {
    parts.push(`- **Unsaved files:** ${envelope.changedFiles.join(", ")}`);
  }

  // Graph context — the core knowledge advantage
  if (envelope.graphContext) {
    const gc = envelope.graphContext;
    parts.push("");
    parts.push("### Knowledge Graph Context");
    parts.push(`- **Cognitive state:** ${gc.cognitiveState}`);

    if (gc.relatedFeatures.length > 0) {
      parts.push(`- **Related features:** ${gc.relatedFeatures.join(", ")}`);
    }
    if (gc.relatedWorkflows.length > 0) {
      parts.push(`- **Related workflows:** ${gc.relatedWorkflows.join(", ")}`);
    }
    if (gc.applicableAdrs.length > 0) {
      parts.push(`- **Applicable ADRs:** ${gc.applicableAdrs.join(", ")}`);
    }
    if (gc.uiPatterns.length > 0) {
      parts.push(`- **UI patterns:** ${gc.uiPatterns.join(", ")}`);
    }
    if (gc.apiSurface) {
      parts.push(`- **API surface:** available`);
    }

    // ---- Deep Graph Signals ----
    // These are the knowledge edges that make DreamGraph superior to generic AI.
    // The Architect starts the conversation already knowing the tensions,
    // insights, and causal relationships around the current code.

    if (gc.tensions && gc.tensions.length > 0) {
      parts.push("");
      parts.push("### Active Tensions");
      parts.push("*(Architectural or design conflicts the graph has detected)*");
      for (const t of gc.tensions.slice(0, 5)) {
        const sev = t.severity === "high" ? "🔴" : t.severity === "medium" ? "🟡" : "🟢";
        parts.push(`- ${sev} **[${t.severity}]** ${t.description}${t.domain ? ` _(${t.domain})_` : ""}`);
      }
      if (gc.tensions.length > 5) {
        parts.push(`- _(${gc.tensions.length - 5} more tensions)_`);
      }
    }

    if (gc.dreamInsights && gc.dreamInsights.length > 0) {
      parts.push("");
      parts.push("### Dream Insights");
      parts.push("*(Discoveries from cognitive dream cycles — patterns, risks, opportunities)*");
      for (const i of gc.dreamInsights.slice(0, 5)) {
        const conf = (i.confidence * 100).toFixed(0);
        parts.push(`- 💡 **[${i.type}]** ${i.insight} _(${conf}% confidence${i.source ? `, source: ${i.source}` : ""})_`);
      }
    }

    if (gc.causalChains && gc.causalChains.length > 0) {
      parts.push("");
      parts.push("### Causal Chains");
      parts.push("*(Known cause-effect relationships in the system)*");
      for (const c of gc.causalChains.slice(0, 8)) {
        parts.push(`- \`${c.from}\` → *${c.relationship}* → \`${c.to}\` (${(c.confidence * 100).toFixed(0)}%)`);
      }
    }

    if (gc.temporalPatterns && gc.temporalPatterns.length > 0) {
      parts.push("");
      parts.push("### Temporal Patterns");
      parts.push("*(Recurring patterns the graph has observed over time)*");
      for (const p of gc.temporalPatterns.slice(0, 5)) {
        parts.push(`- 🔄 ${p.pattern} — frequency: ${p.frequency}${p.last_seen ? ` (last: ${p.last_seen})` : ""}`);
      }
    }

    if (gc.dataModelEntities && gc.dataModelEntities.length > 0) {
      parts.push("");
      parts.push("### Related Data Model Entities");
      for (const e of gc.dataModelEntities.slice(0, 5)) {
        parts.push(`- \`${e.id}\`: ${e.name} (${e.storage})`);
      }
    }
  }

  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface AssembledPrompt {
  /** Complete system prompt (core + overlay + context) */
  system: string;
  /** Task that was used */
  task: ArchitectTask;
}

/**
 * Assemble the Architect system prompt from core + task overlay + context block.
 *
 * @param task - The task type (explain, validate, patch, suggest, chat)
 * @param envelope - Editor context envelope (may be null for config-only calls)
 * @param contextText - Optional assembled context text (from ContextBuilder.assembleContextBlock)
 * @param additionalInstructions - Optional additional instructions appended after the context
 * @param autonomyState - Optional autonomy state to inject policy/contract blocks
 */
export function assemblePrompt(
  task: ArchitectTask,
  envelope: EditorContextEnvelope | null,
  contextText?: string,
  additionalInstructions?: string,
  autonomyState?: AutonomyInstructionState,
): AssembledPrompt {
  const parts: string[] = [ARCHITECT_CORE];

  // Task overlay
  const overlay = TASK_OVERLAYS[task];
  if (overlay) {
    parts.push(overlay);
  }

  // Context block from envelope
  if (envelope) {
    parts.push(formatContextBlock(envelope));
  }

  // Assembled context text (file content, ADRs, etc.)
  if (contextText) {
    parts.push(contextText);
  }

  // Reporting contract (always injected so model knows verbosity expectations)
  parts.push(getReportingInstructionBlock());

  // Autonomy contract (injected when autonomy is enabled)
  const autonomyBlock = getAutonomyInstructionBlock(autonomyState);
  if (autonomyBlock) {
    parts.push(autonomyBlock);
    parts.push(getStructuredResponseContractBlock());
  }

  // Additional instructions
  if (additionalInstructions) {
    parts.push(additionalInstructions);
  }

  return {
    system: parts.join("\n\n"),
    task,
  };
}

/**
 * Infer the best task overlay from an intent mode and optional command source.
 */
export function inferTask(
  intentMode: string,
  commandSource?: string,
): ArchitectTask {
  // Command source overrides
  if (commandSource) {
    switch (commandSource) {
      case "explainFile":
      case "explainSelection":
        return "explain";
      case "checkAdrCompliance":
      case "validateCurrentFile":
        return "validate";
      case "suggestNextAction":
        return "suggest";
    }
  }

  // Intent-based inference
  switch (intentMode) {
    case "active_file":
      return "explain";
    case "selection_only":
      return "explain";
    case "ask_dreamgraph":
      return "chat";
    default:
      return "chat";
  }
}
