"use strict";
/**
 * Prompt Assembler — composes the Architect system prompt from
 * core identity + task overlay + context block + autonomy/reporting contracts.
 *
 * @see TDD §7.5 (Prompt Architecture), §7.4 (Chat Flow)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assemblePrompt = assemblePrompt;
exports.inferTask = inferTask;
const architect_core_js_1 = require("./architect-core.js");
const architect_explain_js_1 = require("./architect-explain.js");
const architect_validate_js_1 = require("./architect-validate.js");
const architect_patch_js_1 = require("./architect-patch.js");
const architect_suggest_js_1 = require("./architect-suggest.js");
const autonomy_js_1 = require("../autonomy.js");
const autonomy_contract_js_1 = require("../autonomy-contract.js");
const reporting_js_1 = require("../reporting.js");
/* ------------------------------------------------------------------ */
/*  Overlay selection                                                 */
/* ------------------------------------------------------------------ */
const TASK_OVERLAYS = {
    explain: architect_explain_js_1.ARCHITECT_EXPLAIN,
    validate: architect_validate_js_1.ARCHITECT_VALIDATE,
    patch: architect_patch_js_1.ARCHITECT_PATCH,
    suggest: architect_suggest_js_1.ARCHITECT_SUGGEST,
    chat: "", // Free-form chat — no extra overlay
};
/* ------------------------------------------------------------------ */
/*  Context block formatting                                          */
/* ------------------------------------------------------------------ */
/**
 * Format the EditorContextEnvelope into a markdown context block
 * that the Architect can reference.
 */
function formatContextBlock(envelope) {
    const parts = ["## Context"];
    // Instance & workspace
    if (envelope.instanceId) {
        parts.push(`- **Instance:** ${envelope.instanceId}`);
    }
    parts.push(`- **Workspace:** ${envelope.workspaceRoot}`);
    parts.push(`- **Intent:** ${envelope.intentMode} (confidence: ${envelope.intentConfidence.toFixed(2)})`);
    // Active file
    if (envelope.activeFile) {
        const af = envelope.activeFile;
        const locationHint = af.selection?.summary
            ? `selection anchor: ${af.selection.summary}`
            : `cursor anchor near the current focus point (approximate only; may drift)`;
        parts.push(`- **Active file:** \`${af.path}\` (${af.languageId}, ${af.lineCount} lines, ${locationHint})`);
        if (af.selection) {
            parts.push(`- **Selection anchor:** ${af.selection.summary}`);
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
/**
 * Assemble the Architect system prompt from core + task overlay + context block.
 *
 * @param task - The task type (explain, validate, patch, suggest, chat)
 * @param envelope - Editor context envelope (may be null for config-only calls)
 * @param contextText - Optional assembled context text (from ContextBuilder.assembleContextBlock)
 * @param additionalInstructions - Optional additional instructions appended after the context
 * @param autonomyState - Optional autonomy state to inject policy/contract blocks
 * @param provider - Optional LLM provider name to inject provider-specific discipline
 */
function assemblePrompt(task, envelope, contextText, additionalInstructions, autonomyState, provider) {
    const parts = [architect_core_js_1.ARCHITECT_CORE];
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
    parts.push((0, reporting_js_1.getReportingInstructionBlock)());
    // Autonomy contract (injected when autonomy is enabled)
    const autonomyBlock = (0, autonomy_js_1.getAutonomyInstructionBlock)(autonomyState);
    if (autonomyBlock) {
        parts.push(autonomyBlock);
        parts.push((0, autonomy_contract_js_1.getStructuredResponseContractBlock)());
    }
    // Provider-specific discipline — Anthropic models (Claude) tend to execute
    // many tool calls without pausing, which corrupts code on large tasks.
    // This block enforces a surgical, slice-based work pattern.
    if (provider === 'anthropic') {
        parts.push(getAnthropicDisciplineBlock());
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
function inferTask(intentMode, commandSource) {
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
/* ------------------------------------------------------------------ */
/*  Anthropic Pacing Discipline                                       */
/* ------------------------------------------------------------------ */
/**
 * Returns an instruction block that constrains Anthropic (Claude) models
 * to work in short, surgical passes instead of attempting to rewrite
 * entire files or fire many tool calls without pausing.
 *
 * This prevents two classes of corruption:
 * 1. Racing modify_entity calls on the same file (now also guarded by mutex)
 * 2. Whole-class replacement that drops unrelated members
 */
function getAnthropicDisciplineBlock() {
    return `## Tool Discipline (CRITICAL — enforced by the system)

### Surgical Edits — Never Replace Entire Large Entities
- When editing a class, interface, or module with many members, target the SPECIFIC member using \`parentEntity\`.
  Example: \`{ "entity": "SaveCommand", "parentEntity": "EntryViewModel" }\`
- NEVER regenerate an entire class just to change one method. The tool will REJECT replacements that drop unrelated members.
- If you need to change multiple members in the same class, make separate \`modify_entity\` calls for each member.

### One File At A Time — Breathe Between Passes
- Complete all edits to one file before moving to the next.
- After modifying a file, call \`run_command\` to verify it compiles before editing the next file.
- Do NOT fire multiple \`modify_entity\` calls targeting the same file in parallel — they are serialised by a mutex and the second call will see stale symbol positions if the first changed line counts.

### Slice-Based Work Pattern
- Break large tasks into slices of 1–3 files each.
- After each slice: verify (build/test), report what changed, then assess next steps.
- If a slice fails verification, fix it before starting the next slice.
- Present recommended next actions after each slice so the user can steer.

### Read Before Write
- Always \`read_local_file\` the target entity/section BEFORE calling \`modify_entity\`.
- This ensures you have the current content, not a cached/stale version from earlier in the conversation.`;
}
//# sourceMappingURL=index.js.map