/**
 * DreamGraph Context Builder — Layer 2 (Context Orchestration).
 *
 * Assembles EditorContextEnvelope from editor state + DreamGraph knowledge.
 * Implements the §3.4 Context Assembly Pipeline and §3.7 Token Budget.
 *
 * @see TDD §3.2 (Context Envelope), §3.4 (Assembly Pipeline), §3.5 (Knowledge Integration), §3.7 (Token Budget)
 */

import * as vscode from "vscode";
import type { McpClient } from "./mcp-client.js";
import type { DaemonClient, GraphContextResponse } from "./daemon-client.js";
import { detectIntent, type IntentDetectionInput } from "./intent-detector.js";
import type {
  EditorContextEnvelope,
  IntentMode,
  ResolvedInstance,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Token budget estimation (§3.7)                                    */
/* ------------------------------------------------------------------ */

/** Estimate token count using chars/4 heuristic (conservative). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function summarizeSelection(startLine: number, endLine: number): string {
  return startLine === endLine
    ? "selection near the current focus point (approximate anchor only; may drift)"
    : "selection spanning the current focus region (approximate anchor only; may drift)";
}

/* ------------------------------------------------------------------ */
/*  Context Builder                                                   */
/* ------------------------------------------------------------------ */

export interface ContextBuilderOptions {
  maxContextTokens: number;
  instance: ResolvedInstance | null;
}

export class ContextBuilder {
  private _mcpClient: McpClient;
  private _daemonClient: DaemonClient;
  private _options: ContextBuilderOptions;

  constructor(
    mcpClient: McpClient,
    daemonClient: DaemonClient,
    options: ContextBuilderOptions,
  ) {
    this._mcpClient = mcpClient;
    this._daemonClient = daemonClient;
    this._options = options;
  }

  updateOptions(options: Partial<ContextBuilderOptions>): void {
    Object.assign(this._options, options);
  }

  private _environmentMetrics: import("./types.js").ContextEnvironmentMetrics | null = null;
  private _previousStablePrefixHash: string | null = null;

    async buildEnvelope(
    prompt?: string,
    commandSource?: string,
  ): Promise<EditorContextEnvelope> {
    const editor = vscode.window.activeTextEditor;
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    const intentInput: IntentDetectionInput = {
      prompt: prompt ?? "",
      hasSelection: editor ? !editor.selection.isEmpty : false,
      selectionLineCount: editor
        ? editor.selection.end.line - editor.selection.start.line + 1
        : 0,
      commandSource,
    };
    const { mode, confidence } = detectIntent(intentInput);

    const hasSelection = editor ? !editor.selection.isEmpty : false;
    const selectionText =
      hasSelection && editor ? editor.document.getText(editor.selection) : null;

    // Phase 1: derive symbol-aware anchors (without graphContext — not resolved yet)
    const selectionAnchor = hasSelection && editor
      ? await this._deriveSelectionSemanticAnchor(editor, selectionText ?? undefined)
      : undefined;
    const cursorAnchor = editor
      ? await this._deriveCursorSemanticAnchor(editor)
      : undefined;

    const environmentModule = await import("./environment-context.js");
    const environmentSnapshot = workspaceRoot
      ? await environmentModule.buildEnvironmentContextSnapshot(workspaceRoot)
      : null;
    const environmentEntries = environmentModule.selectEnvironmentContextForFile(
      environmentSnapshot,
      editor ? vscode.workspace.asRelativePath(editor.document.uri) : null,
    );

    const envelope: EditorContextEnvelope = {
      workspaceRoot,
      instanceId: this._options.instance?.uuid ?? null,
      activeFile: editor
        ? {
            path: vscode.workspace.asRelativePath(editor.document.uri),
            languageId: editor.document.languageId,
            lineCount: editor.document.lineCount,
            cursorLine: editor.selection.active.line + 1,
            cursorColumn: editor.selection.active.character + 1,
            cursorSummary:
              cursorAnchor?.label ??
              "cursor within the current working symbol or focus region (approximate anchor only; may drift)",
            cursorAnchor,
            selection: hasSelection
              ? {
                  startLine: editor.selection.start.line + 1,
                  endLine: editor.selection.end.line + 1,
                  text: selectionText ?? "",
                  summary:
                    selectionAnchor?.label ??
                    "selection within the current working symbol or focus region (approximate anchor only; may drift)",
                  anchor: selectionAnchor,
                }
              : null,
          }
        : null,
      visibleFiles: vscode.window.visibleTextEditors.map((e) =>
        vscode.workspace.asRelativePath(e.document.uri),
      ),
      changedFiles: vscode.workspace.textDocuments
        .filter((d) => d.isDirty)
        .map((d) => vscode.workspace.asRelativePath(d.uri)),
      pinnedFiles: [],
      environmentContext: environmentSnapshot
        ? {
            workspaceRuntime: environmentSnapshot.workspaceRuntime,
            workspacePackageManager: environmentSnapshot.workspacePackageManager,
            entries: environmentEntries,
          }
        : null,
      graphContext: null,
      intentMode: mode,
      intentConfidence: confidence,
    };

    if (environmentSnapshot) {
      const renderResult = environmentModule.renderEnvironmentContextBlockWithMetrics(
        environmentSnapshot,
        envelope.activeFile?.path ?? null,
        this._environmentMetrics
          ? {
              hash: this._environmentMetrics.hash,
              stablePrefixHash: this._environmentMetrics.stablePrefixHash,
            }
          : null,
      );
      this._environmentMetrics = renderResult.metrics;
    } else {
      this._environmentMetrics = null;
    }

    // Phase 2: resolve graph context (evidence-driven)
    const plan = await this.createContextPlan(envelope, prompt, commandSource);
    if (plan.requiredEvidence.length > 0 || plan.optionalEvidence.length > 0) {
      envelope.graphContext = await this.resolveGraphContext(envelope, plan);
    }

    // Phase 3: one-pass anchor promotion — now that graphContext is available,
    // upgrade any symbol-level anchors to canonical graph identity (entity/workflow/ADR/UI).
    // This is the single promotion pass; _deriveSymbolAnchor's inline promotion only
    // fires when graphContext is pre-supplied, which it is not during Phase 1.
    if (envelope.graphContext && envelope.activeFile) {
      if (envelope.activeFile.cursorAnchor) {
        envelope.activeFile.cursorAnchor = await this._promoteAnchor(
          envelope.activeFile.cursorAnchor,
          envelope.graphContext,
        );
        // Keep cursorSummary in sync with promoted label
        envelope.activeFile.cursorSummary =
          envelope.activeFile.cursorAnchor.label;
      }
      if (envelope.activeFile.selection?.anchor) {
        envelope.activeFile.selection.anchor = await this._promoteAnchor(
          envelope.activeFile.selection.anchor,
          envelope.graphContext,
        );
        // Keep summary in sync with promoted label
        envelope.activeFile.selection.summary =
          envelope.activeFile.selection.anchor.label;
      }

      this._applyCanonicalAnchorIdsToGraphContext(envelope);
    }

    return envelope;
  }

  async rehydrateStoredAnchors<T extends { anchor?: import("./types.js").SemanticAnchor }>(
    messages: T[],
    graphContext: NonNullable<EditorContextEnvelope["graphContext"]> | null,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const message of messages) {
      if (!message.anchor) {
        out.push(message);
        continue;
      }
      const migrated = await this.resolveAnchorMigration(message.anchor, graphContext);
      out.push({ ...message, anchor: migrated });
    }
    return out;
  }

  readActiveFileContent(options?: {
    allowFullFile?: boolean;
    reason?: string;
    explicitUserRequest?: boolean;
    debugMode?: boolean;
  }): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    if (
      !options?.allowFullFile &&
      !options?.explicitUserRequest &&
      !options?.debugMode
    ) {
      return null;
    }
    return editor.document.getText();
  }

  readSelectionContent(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return null;
    return editor.document.getText(editor.selection);
  }

  async readFile(relativePath: string): Promise<string | null> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) return null;
    try {
      const uri = vscode.Uri.joinPath(workspaceRoot, relativePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      return doc.getText();
    } catch {
      return null;
    }
  }

  async createContextPlan(
    envelope: EditorContextEnvelope,
    prompt?: string,
    commandSource?: string,
  ): Promise<import("./types.js").ContextPlan> {
    return this._createContextPlan(envelope, prompt, commandSource);
  }

  async resolveGraphContext(
    envelope: EditorContextEnvelope,
    plan: import("./types.js").ContextPlan,
  ): Promise<EditorContextEnvelope["graphContext"]> {
    return this._resolveGraphContext(envelope, plan);
  }

  /**
   * Shared budget-allocation loop (§3.7).
   *
   * Iterates a pre-sorted evidence list and partitions items into included vs omitted
   * without exceeding `usableBudget` tokens. When `codeRetryOptions` is provided, a
   * code item that would bust the budget gets a `_trimActiveFile` retry before being
   * marked omitted — this preserves the `assembleContextBlock` behaviour.
   */
  private _applyBudget(
    evidence: import("./types.js").EvidenceItem[],
    usableBudget: number,
    codeRetryOptions?: { fileContent: string; envelope: EditorContextEnvelope },
  ): {
    included: import("./types.js").EvidenceItem[];
    omitted: Array<{
      title: string;
      reason: string;
      required: boolean;
      kind?: import("./types.js").ContextEvidenceKind;
    }>;
    used: number;
  } {
    const included: import("./types.js").EvidenceItem[] = [];
    const omitted: Array<{
      title: string;
      reason: string;
      required: boolean;
      kind?: import("./types.js").ContextEvidenceKind;
    }> = [];
    let used = 0;

    for (const item of evidence) {
      if (used + item.tokenCost <= usableBudget) {
        included.push(item);
        used += item.tokenCost;
      } else if (codeRetryOptions && item.kind === "code") {
        const trimmed = this._trimActiveFile(
          codeRetryOptions.fileContent,
          codeRetryOptions.envelope,
          usableBudget - used,
        );
        if (trimmed) {
          const trimmedCost = estimateTokens(trimmed);
          included.push({ ...item, content: trimmed, tokenCost: trimmedCost });
          used += trimmedCost;
        } else {
          omitted.push({
            title: item.title,
            reason: "code excerpt could not be trimmed within remaining budget",
            required: item.required,
            kind: item.kind,
          });
        }
      } else {
        omitted.push({
          title: item.title,
          reason: item.required
            ? "required evidence exceeded the current usable budget and needs a narrower retrieval plan"
            : "omitted to preserve minimum sufficient context within budget",
          required: item.required,
          kind: item.kind,
        });
      }
    }

    return { included, omitted, used };
  }

    async buildReasoningPacket(
    envelope: EditorContextEnvelope,
    options?: {
      prompt?: string;
      commandSource?: string;
      additionalSections?: Map<string, string>;
    },
  ): Promise<import("./types.js").ReasoningPacket> {
    const plan = await this.createContextPlan(
      envelope,
      options?.prompt,
      options?.commandSource,
    );
    const graphContext = envelope.graphContext ?? await this.resolveGraphContext(envelope, plan);
    const hydratedEnvelope: EditorContextEnvelope = {
      ...envelope,
      graphContext,
    };

    const fileContent = this._readPlannedCode(hydratedEnvelope, plan);
    const evidence = this._collectEvidenceItems(
      hydratedEnvelope,
      fileContent,
      options?.additionalSections ?? new Map(),
      plan,
    );

    const budget = plan.budgetPolicy.maxTokens;
    const reserved = plan.budgetPolicy.reserveTokens;
    const usableBudget = Math.max(200, budget - reserved);

    const { included, omitted, used } = this._applyBudget(evidence, usableBudget);
    const instrumentationResult = await import("./context-builder.instrumentation.js").then((m) =>
      m.buildContextInstrumentation(
        included,
        omitted,
        this._environmentMetrics,
        this._previousStablePrefixHash,
      ),
    );
    this._previousStablePrefixHash = instrumentationResult.stablePrefixHash;

    return {
      task: {
        intentMode: plan.intentMode,
        summary: plan.taskSummary,
        commandSource: options?.commandSource,
      },
      primaryAnchor: plan.primaryAnchor,
      secondaryAnchors: plan.secondaryAnchors,
      evidence: included,
      omitted,
      confidence: hydratedEnvelope.intentConfidence,
      tokenUsage: {
        used,
        budget,
        reserved,
      },
      instrumentation: instrumentationResult.instrumentation,
    };
  }

    assembleContextBlock(
    envelope: EditorContextEnvelope,
    fileContent: string | null,
    additionalSections: Map<string, string>,
  ): {
    text: string;
    usedTokens: number;
    totalTokens: number;
    trimmedSections: string[];
  } {
    const plan = this._createFallbackPlan(envelope);
    const evidence = this._collectEvidenceItems(
      envelope,
      fileContent,
      additionalSections,
      plan,
    );
    const budget = plan.budgetPolicy.maxTokens;

    const { included, omitted, used: usedTokens } = this._applyBudget(
      evidence,
      budget,
      fileContent && envelope.activeFile
        ? { fileContent, envelope }
        : undefined,
    );

    const includedParts = included.map((item) => item.content);
    const trimmedSections = omitted.map((entry) => entry.title);

    if (trimmedSections.length > 0) {
      const note = `\n[Context note: ${trimmedSections.join(", ")} omitted or reduced to stay within the evidence budget]\n`;
      includedParts.push(note);
    }

    return {
      text: includedParts.join("\n\n"),
      usedTokens,
      totalTokens: budget,
      trimmedSections,
    };
  }

    renderReasoningPacket(
    packet: import("./types.js").ReasoningPacket,
  ): {
    text: string;
    usedTokens: number;
    totalTokens: number;
    trimmedSections: string[];
  } {
    const parts: string[] = [];
    parts.push(
      `## Task Framing\nIntent mode: ${packet.task.intentMode}\nTask: ${packet.task.summary}`,
    );
    if (packet.primaryAnchor) {
      const a = packet.primaryAnchor;
      const promotionNote = a.canonicalId
        ? ` [→ ${a.canonicalKind ?? "entity"}:${a.canonicalId}` +
          (a.migrationStatus && a.migrationStatus !== "native" ? ` (${a.migrationStatus})` : "") +
          `]`
        : a.approximate
          ? " ⚠ approximate anchor"
          : "";
      parts.push(`## Primary Anchor\n${a.label}${promotionNote}`);
    }
    if (packet.secondaryAnchors.length > 0) {
      const lines = packet.secondaryAnchors.map((a) => {
        const promotionNote = a.canonicalId
          ? ` [→ ${a.canonicalKind ?? "entity"}:${a.canonicalId}` +
            (a.migrationStatus && a.migrationStatus !== "native" ? ` (${a.migrationStatus})` : "") +
            `]`
          : a.approximate
            ? " ⚠ approximate"
            : "";
        return `- ${a.label}${promotionNote}`;
      });
      parts.push(`## Secondary Anchors\n${lines.join("\n")}`);
    }
    for (const item of packet.evidence) {
      if (item.kind === "task") continue;
      parts.push(item.content);
    }
    if (packet.omitted.length > 0) {
      parts.push(
        `## Omitted Context\n${packet.omitted
          .map((entry) => `- ${entry.title}: ${entry.reason}`)
          .join("\n")}`,
      );
    }

    return {
      text: parts.join("\n\n"),
      usedTokens: packet.tokenUsage.used,
      totalTokens: packet.tokenUsage.budget,
      trimmedSections: packet.omitted.map((entry) => entry.title),
    };
  }

      private _readPlannedCode(
    envelope: EditorContextEnvelope,
    plan: import("./types.js").ContextPlan,
  ): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const preferredScope = plan.codeReadPlan.find((step) => step.required)?.scope
      ?? plan.codeReadPlan[0]?.scope;

    if (preferredScope === "selection") {
      return this.readSelectionContent();
    }

    if (preferredScope === "focused_excerpt") {
      const fileContent = editor.document.getText();
      const excerptBudget = Math.floor(plan.budgetPolicy.maxTokens * 0.4);
      return this._trimActiveFile(fileContent, envelope, excerptBudget);
    }

    if (preferredScope === "active_file" && plan.budgetPolicy.allowFullActiveFile) {
      return this.readActiveFileContent({
        allowFullFile: true,
        reason: "Planner-authorized full file read.",
      });
    }

    return null;
  }

  private async _createContextPlan(
    envelope: EditorContextEnvelope,
    prompt?: string,
    commandSource?: string,
  ): Promise<import("./types.js").ContextPlan> {
    const promptLower = (prompt ?? "").toLowerCase();
    const filePath = envelope.activeFile?.path ?? "current file";
    const primaryAnchor = this._resolvePrimaryAnchor(envelope);
    const secondaryAnchors = this._resolveSecondaryAnchors(envelope, primaryAnchor);

    const isAdr = commandSource === "checkAdrCompliance" || promptLower.includes("adr");
    const isExplain = commandSource === "explainFile" || promptLower.includes("explain");
    const isBug =
      promptLower.includes("bug") ||
      promptLower.includes("error") ||
      promptLower.includes("failing") ||
      promptLower.includes("fix");
    const isUi =
      promptLower.includes("ui") ||
      promptLower.includes("component") ||
      promptLower.includes("view") ||
      promptLower.includes("panel");
    const isModify =
      promptLower.includes("change") ||
      promptLower.includes("update") ||
      promptLower.includes("modify") ||
      promptLower.includes("refactor") ||
      promptLower.includes("implement");
    const isArchitecture =
      envelope.intentMode === "ask_dreamgraph" ||
      promptLower.includes("architecture") ||
      promptLower.includes("workflow") ||
      promptLower.includes("system");
    const forceEnvironment = envelope.intentMode === "active_file" || isExplain || isModify || isBug || isUi;

    const requiredEvidence = new Set<import("./types.js").ContextEvidenceKind>();
    const optionalEvidence = new Set<import("./types.js").ContextEvidenceKind>();
    const codeReadPlan: import("./types.js").CodeReadPlan[] = [];

    if (envelope.activeFile?.selection?.text) {
      codeReadPlan.push({
        scope: "selection",
        reason: "User selection is the most immediate semantic anchor.",
        anchorLabel: envelope.activeFile.selection.anchor?.label ?? envelope.activeFile.selection.summary,
        required: true,
      });
      requiredEvidence.add("code");
    }

    if (isAdr) {
      requiredEvidence.add("adr");
      requiredEvidence.add("api");
      optionalEvidence.add("tension");
      optionalEvidence.add("feature");
      codeReadPlan.push({
        scope: envelope.activeFile?.selection ? "selection" : "focused_excerpt",
        reason: "ADR validation needs the local implementation surface, not the full file.",
        anchorLabel: primaryAnchor?.label,
        required: true,
      });
    } else if (isBug) {
      requiredEvidence.add("tension");
      requiredEvidence.add("causal");
      optionalEvidence.add("temporal");
      optionalEvidence.add("api");
      codeReadPlan.push({
        scope: envelope.activeFile?.selection ? "selection" : "focused_excerpt",
        reason: "Bug diagnosis should stay near the failing symbol or current working region.",
        anchorLabel: primaryAnchor?.label,
        required: true,
      });
    } else if (isUi) {
      requiredEvidence.add("ui");
      optionalEvidence.add("workflow");
      optionalEvidence.add("tension");
      codeReadPlan.push({
        scope: envelope.activeFile?.selection ? "selection" : "focused_excerpt",
        reason: "UI work should be grounded in the active UI anchor without dumping the whole file.",
        anchorLabel: primaryAnchor?.label,
        required: Boolean(envelope.activeFile),
      });
    } else if (isModify) {
      requiredEvidence.add("api");
      requiredEvidence.add("adr");
      optionalEvidence.add("tension");
      optionalEvidence.add("feature");
      codeReadPlan.push({
        scope: envelope.activeFile?.selection ? "selection" : "focused_excerpt",
        reason: "Modification work needs the contract surface and the nearest implementation anchor.",
        anchorLabel: primaryAnchor?.label,
        required: Boolean(envelope.activeFile),
      });
    } else if (isArchitecture || isExplain) {
      requiredEvidence.add("feature");
      requiredEvidence.add("workflow");
      optionalEvidence.add("adr");
      optionalEvidence.add("tension");
      optionalEvidence.add("cognitive_status");
      if (isArchitecture) {
        optionalEvidence.add("causal");
      }
      if (isExplain && envelope.activeFile) {
        codeReadPlan.push({
          scope: envelope.activeFile.selection ? "selection" : "focused_excerpt",
          reason: "Explanation should use the nearest anchored code slice, not the whole file.",
          anchorLabel: primaryAnchor?.label,
          required: true,
        });
        requiredEvidence.add("code");
      }
    } else if (envelope.activeFile) {
      optionalEvidence.add("feature");
      optionalEvidence.add("api");
      codeReadPlan.push({
        scope: envelope.activeFile.selection ? "selection" : "focused_excerpt",
        reason: "Fallback plan uses a focused local anchor only.",
        anchorLabel: primaryAnchor?.label,
        required: false,
      });
    }

    return {
      intentMode: envelope.intentMode,
      taskSummary:
        prompt?.trim() ||
        commandSource ||
        `Context plan for ${filePath}`,
      primaryAnchor,
      secondaryAnchors,
      requiredEvidence: [...requiredEvidence],
      optionalEvidence: [...optionalEvidence],
      codeReadPlan,
      budgetPolicy: {
        maxTokens: this._options.maxContextTokens,
        reserveTokens: Math.min(1200, Math.floor(this._options.maxContextTokens * 0.2)),
        allowFullActiveFile: false,
        includeOptionalEvidence: envelope.intentConfidence >= 0.5,
      },
      environmentPolicy: {
        forceInclude: forceEnvironment,
        softTokenCeiling: 220,
        hardTokenCeiling: 320,
        scopeLimit: 2,
      },
    };
  }

  private _createFallbackPlan(
    envelope: EditorContextEnvelope,
  ): import("./types.js").ContextPlan {
    const primaryAnchor = this._resolvePrimaryAnchor(envelope);

    return {
      intentMode: envelope.intentMode,
      taskSummary: envelope.activeFile?.path ?? "current context",
      primaryAnchor,
      secondaryAnchors: this._resolveSecondaryAnchors(envelope, primaryAnchor),
      requiredEvidence: envelope.activeFile?.selection?.text ? ["code"] : [],
      optionalEvidence: ["feature", "workflow", "adr", "api", "ui", "tension"],
      codeReadPlan: envelope.activeFile
        ? [
            {
              scope: envelope.activeFile.selection ? "selection" : "focused_excerpt",
              reason: "Fallback context keeps the active anchor small and local.",
              anchorLabel:
                envelope.activeFile.selection?.anchor?.label ??
                envelope.activeFile.selection?.summary ??
                envelope.activeFile.cursorAnchor?.label ??
                envelope.activeFile.cursorSummary,
              required: Boolean(envelope.activeFile.selection?.text),
            },
          ]
        : [],
      budgetPolicy: {
        maxTokens: this._options.maxContextTokens,
        reserveTokens: Math.min(1200, Math.floor(this._options.maxContextTokens * 0.2)),
        allowFullActiveFile: false,
        includeOptionalEvidence: true,
      },
      environmentPolicy: {
        forceInclude: envelope.intentMode === "active_file",
        softTokenCeiling: 220,
        hardTokenCeiling: 320,
        scopeLimit: 2,
      },
    };
  }

    private async _resolveGraphContext(
    envelope: EditorContextEnvelope,
    plan: import("./types.js").ContextPlan,
  ): Promise<EditorContextEnvelope["graphContext"]> {
    const graphCtx: NonNullable<EditorContextEnvelope["graphContext"]> = {
      relatedFeatures: [],
      relatedWorkflows: [],
      applicableAdrs: [],
      uiPatterns: [],
      activeTensions: 0,
      cognitiveState: "unknown",
      apiSurface: null,
      tensions: [],
      dreamInsights: [],
      causalChains: [],
      temporalPatterns: [],
      dataModelEntities: [],
    };

    const needs = new Set<import("./types.js").ContextEvidenceKind>([
      ...plan.requiredEvidence,
      ...(plan.budgetPolicy.includeOptionalEvidence ? plan.optionalEvidence : []),
    ]);

    if (
      envelope.activeFile &&
      ["feature", "workflow", "adr", "ui", "api", "tension"].some((k) =>
        needs.has(k as import("./types.js").ContextEvidenceKind),
      )
    ) {
      const requestBase = {
        file_path: envelope.activeFile.path,
        include_adrs: needs.has("adr"),
        include_ui: needs.has("ui"),
        include_api_surface: needs.has("api"),
        include_tensions: needs.has("tension"),
      };

      // Pass 1: file-path match — always runs.
      const result = await this._daemonClient.getGraphContext(requestBase);

      if (result) {
        // Use per-entity relevance scores from the daemon. Constants are fallbacks
        // only when the daemon omits the field (e.g. older daemon versions).
        graphCtx.relatedFeatures = result.features.map((f) => ({
          id: f.id,
          name: f.name,
          relevance: f.relevance ?? 0.9,
        }));
        graphCtx.relatedWorkflows = result.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          relevance: w.relevance ?? 0.8,
        }));
        graphCtx.applicableAdrs = result.adrs.map((a) => ({
          id: a.id,
          title: a.title,
          relevance: a.relevance ?? 1,
        }));
        graphCtx.uiPatterns = result.ui_elements.map((u) => ({
          id: u.id,
          name: u.name,
          relevance: u.relevance ?? 0.85,
        }));
        graphCtx.activeTensions = result.tensions.length;
        graphCtx.tensions = result.tensions.map((t) => ({
          id: t.id,
          description: t.description ?? t.summary ?? "",
          severity: t.severity ?? "",
          relevance: t.relevance ?? t.urgency ?? 1,
        }));
        if (needs.has("api") && result.api_surface) {
          graphCtx.apiSurface = result.api_surface;
        }

        // Pass 2: anchor-targeted ID lookup.
        //
        // The pre-promotion anchor (Phase 1) carries a symbolPath
        // (e.g. "ContextBuilder._resolveGraphContext") but no canonicalId yet —
        // Phase 3 promotion hasn't run. We run the same scored matching logic
        // used in _promoteAnchor against the Pass 1 feature set to find the
        // best candidate ID. If the score exceeds PRESCORE_THRESHOLD, we issue
        // a second call with feature_ids:[candidateId] so the daemon uses its
        // exact-match path (relevance: 1.0) and returns any linked entities
        // (workflows, ADRs) scoped to that feature rather than the whole file.
        // Newly returned entities are merged in; duplicates are upgraded in-place.
        const anchor =
          envelope.activeFile.selection?.anchor ??
          envelope.activeFile.cursorAnchor;

        const preScored = anchor
          ? this._preScoreFeatureId(anchor, result.features)
          : null;

        if (preScored && preScored.score >= 0.75) {
          const targeted = await this._daemonClient.getGraphContext({
            ...requestBase,
            feature_ids: [preScored.id],
          }).catch(() => null);

          if (targeted) {
            // Merge features — upgrade relevance to 1.0 for the direct match;
            // append any new features not already returned by Pass 1.
            const existingFeatureIds = new Set(graphCtx.relatedFeatures.map((f) => f.id));
            for (const f of targeted.features) {
              if (existingFeatureIds.has(f.id)) {
                // Upgrade the relevance score for the direct-matched feature.
                const existing = graphCtx.relatedFeatures.find((e) => e.id === f.id);
                if (existing) existing.relevance = f.relevance ?? 1.0;
              } else {
                graphCtx.relatedFeatures.push({
                  id: f.id,
                  name: f.name,
                  relevance: f.relevance ?? 1.0,
                });
              }
            }
            // Merge workflows — append any feature-linked workflows not in Pass 1.
            const existingWorkflowIds = new Set(graphCtx.relatedWorkflows.map((w) => w.id));
            for (const w of targeted.workflows) {
              if (!existingWorkflowIds.has(w.id)) {
                graphCtx.relatedWorkflows.push({
                  id: w.id,
                  name: w.name,
                  relevance: w.relevance ?? 0.9,
                });
              }
            }
            // Merge ADRs scoped to the target feature.
            const existingAdrIds = new Set(graphCtx.applicableAdrs.map((a) => a.id));
            for (const a of targeted.adrs) {
              if (!existingAdrIds.has(a.id)) {
                graphCtx.applicableAdrs.push({
                  id: a.id,
                  title: a.title,
                  relevance: a.relevance ?? 1.0,
                });
              }
            }
          }
        }
      }
    }

    const deepFetches: Array<Promise<unknown>> = [];
    const deepKinds: import("./types.js").ContextEvidenceKind[] = [];

    if (needs.has("causal")) {
      deepFetches.push(this._fetchCausalInsights());
      deepKinds.push("causal");
    }
    if (needs.has("temporal")) {
      deepFetches.push(this._fetchTemporalInsights());
      deepKinds.push("temporal");
    }
    if (needs.has("data_model")) {
      deepFetches.push(this._fetchDataModelEntities(envelope));
      deepKinds.push("data_model");
    }
    if (needs.has("cognitive_status")) {
      deepFetches.push(this._fetchCognitiveStatus());
      deepKinds.push("cognitive_status");
    }
    if (needs.has("feature") || needs.has("workflow")) {
      deepFetches.push(this._fetchDreamInsights());
      deepKinds.push("feature");
    }

    const settled = await Promise.allSettled(deepFetches);
    settled.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const kind = deepKinds[index];
      if (kind === "causal") {
        graphCtx.causalChains = result.value as NonNullable<EditorContextEnvelope["graphContext"]>["causalChains"];
      } else if (kind === "temporal") {
        graphCtx.temporalPatterns = result.value as NonNullable<EditorContextEnvelope["graphContext"]>["temporalPatterns"];
      } else if (kind === "data_model") {
        graphCtx.dataModelEntities = result.value as NonNullable<EditorContextEnvelope["graphContext"]>["dataModelEntities"];
      } else if (kind === "cognitive_status") {
        graphCtx.cognitiveState = (result.value as string | null) ?? "unknown";
      } else if (kind === "feature") {
        graphCtx.dreamInsights = result.value as NonNullable<EditorContextEnvelope["graphContext"]>["dreamInsights"];
      }
    });

    return graphCtx;
  }

  private async _fetchDreamInsights(): Promise<
    Array<{
      type: string;
      insight: string;
      confidence: number;
      source?: string;
      relevance?: number;
    }>
  > {
    try {
      const result = await this._mcpClient.callTool("get_dream_insights", {});
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const raw = data?.ok ? data.data?.insights : data?.insights;
      if (!Array.isArray(raw)) return [];
      return raw.slice(0, 8).map((i: Record<string, unknown>) => ({
        type: String(i.type ?? "insight"),
        insight: String(i.insight ?? i.description ?? i.text ?? ""),
        confidence: Number(i.confidence ?? 0.5),
        source: i.source ? String(i.source) : undefined,
        relevance: Number(i.relevance ?? 0.7),
      }));
    } catch {
      return [];
    }
  }

  private async _fetchCausalInsights(): Promise<
    Array<{
      from: string;
      to: string;
      relationship: string;
      confidence: number;
      relevance?: number;
    }>
  > {
    try {
      const result = await this._mcpClient.callTool("get_causal_insights", {});
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const chains = data?.ok
        ? data.data?.chains ?? data.data?.insights
        : data?.chains ?? data?.insights;
      if (!Array.isArray(chains)) return [];
      return chains.slice(0, 12).map((c: Record<string, unknown>) => ({
        from: String(c.from ?? c.source ?? ""),
        to: String(c.to ?? c.target ?? ""),
        relationship: String(c.relationship ?? c.type ?? "influences"),
        confidence: Number(c.confidence ?? 0.5),
        relevance: Number(c.relevance ?? 0.75),
      }));
    } catch {
      return [];
    }
  }

  private async _fetchTemporalInsights(): Promise<
    Array<{
      pattern: string;
      frequency: string;
      last_seen?: string;
      relevance?: number;
    }>
  > {
    try {
      const result = await this._mcpClient.callTool("get_temporal_insights", {});
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const patterns = data?.ok
        ? data.data?.patterns ?? data.data?.insights
        : data?.patterns ?? data?.insights;
      if (!Array.isArray(patterns)) return [];
      return patterns.slice(0, 8).map((p: Record<string, unknown>) => ({
        pattern: String(p.pattern ?? p.description ?? ""),
        frequency: String(p.frequency ?? p.recurrence ?? "unknown"),
        last_seen: p.last_seen ? String(p.last_seen) : undefined,
        relevance: Number(p.relevance ?? 0.65),
      }));
    } catch {
      return [];
    }
  }

  private async _fetchDataModelEntities(
    envelope: EditorContextEnvelope,
  ): Promise<Array<{ id: string; name: string; storage: string; relevance?: number }>> {
    try {
      const anchor =
        envelope.activeFile?.selection?.anchor?.symbolPath ??
        envelope.activeFile?.selection?.anchor?.label ??
        envelope.activeFile?.cursorAnchor?.symbolPath ??
        envelope.activeFile?.cursorAnchor?.label ??
        envelope.activeFile?.path ??
        envelope.visibleFiles[0] ??
        "";
      const result = await this._mcpClient.callTool("search_data_model", {
        entity_name: anchor,
      });
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const entities = data?.ok
        ? data.data?.matches ?? data.data?.entities
        : data?.matches ?? data?.entities;
      if (!Array.isArray(entities)) return [];
      return entities.slice(0, 8).map((e: Record<string, unknown>) => ({
        id: String(e.id ?? ""),
        name: String(e.name ?? ""),
        storage: String(e.storage ?? e.store ?? "unknown"),
        relevance: Number(e.relevance ?? 0.7),
      }));
    } catch {
      return [];
    }
  }

  private async _fetchCognitiveStatus(): Promise<string | null> {
    try {
      const status = await this._mcpClient.getCognitiveStatus();
      if (status && typeof status === "object" && "current_state" in status) {
        return (status as { current_state: string }).current_state;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Pre-scores anchor identity against the Pass-1 daemon feature list using the
   * same matchScore logic as _promoteAnchor. Returns the best candidate feature
   * ID and its score, or null when no candidate clears the minimum bar (0.5).
   *
   * Used by _resolveGraphContext to decide whether a targeted Pass-2 call
   * with feature_ids:[candidateId] is worth making (threshold: 0.75).
   *
   * Deliberately synchronous and allocation-light — called on every turn.
   */
  private _preScoreFeatureId(
    anchor: import("./types.js").SemanticAnchor,
    features: Array<{ id: string; name: string }>,
  ): { id: string; score: number } | null {
    const symbolPath = anchor.symbolPath ?? anchor.label ?? "";
    const symbolName = symbolPath.includes(".")
      ? symbolPath.split(".").pop()!
      : symbolPath;
    const nameLower = symbolName.toLowerCase();

    const matchScore = (candidate: string): number => {
      const c = candidate.toLowerCase();
      if (c === nameLower) return 1.0;
      if (c.startsWith(nameLower) || nameLower.startsWith(c)) return 0.75;
      if (c.includes(nameLower) || nameLower.includes(c)) return 0.5;
      return 0;
    };

    let best: { id: string; score: number } | null = null;
    for (const f of features) {
      const score = Math.max(matchScore(f.id), matchScore(f.name));
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { id: f.id, score };
      }
    }
    return best;
  }

  private _applyCanonicalAnchorIdsToGraphContext(
    envelope: EditorContextEnvelope,
  ): void {
    const graphContext = envelope.graphContext;
    if (!graphContext) return;

    const anchors = [
      envelope.activeFile?.cursorAnchor,
      envelope.activeFile?.selection?.anchor,
    ].filter(
      (
        anchor,
      ): anchor is import("./types.js").SemanticAnchor & { canonicalId: string } =>
        Boolean(anchor?.canonicalId),
    );

    for (const anchor of anchors) {
      const feature = graphContext.relatedFeatures.find((f) => f.id === anchor.canonicalId);
      if (feature) {
        feature.relevance = Math.max(feature.relevance ?? 0, 1);
      } else if (anchor.canonicalKind === "entity") {
        graphContext.relatedFeatures.unshift({
          id: anchor.canonicalId,
          name: anchor.label,
          relevance: 1,
        });
      }
    }
  }

  private _resolvePrimaryAnchor(
    envelope: EditorContextEnvelope,
  ): import("./types.js").SemanticAnchor | undefined {
    if (envelope.activeFile?.selection?.anchor) {
      return envelope.activeFile.selection.anchor;
    }
    if (envelope.activeFile?.selection?.summary) {
      return {
        kind: "selection",
        label: envelope.activeFile.selection.summary,
        path: envelope.activeFile.path,
        approximate: true,
        source: "heuristic",
      };
    }
    if (envelope.activeFile?.cursorAnchor) {
      return envelope.activeFile.cursorAnchor;
    }
    if (envelope.activeFile) {
      return {
        kind: "file",
        label: envelope.activeFile.cursorSummary,
        path: envelope.activeFile.path,
        approximate: true,
        source: "heuristic",
      };
    }
    return undefined;
  }

  private _resolveSecondaryAnchors(
    envelope: EditorContextEnvelope,
    primaryAnchor?: import("./types.js").SemanticAnchor,
  ): import("./types.js").SemanticAnchor[] {
    const anchors: import("./types.js").SemanticAnchor[] = [];
    if (
      envelope.activeFile?.cursorAnchor &&
      primaryAnchor?.label !== envelope.activeFile.cursorAnchor.label
    ) {
      anchors.push(envelope.activeFile.cursorAnchor);
    } else if (envelope.activeFile && primaryAnchor?.path !== envelope.activeFile.path) {
      anchors.push({
        kind: "file",
        label: envelope.activeFile.cursorSummary,
        path: envelope.activeFile.path,
        approximate: true,
        source: "heuristic",
      });
    }
    for (const file of envelope.visibleFiles.slice(0, 3)) {
      if (file !== envelope.activeFile?.path) {
        anchors.push({
          kind: "file",
          label: `visible file ${file}`,
          path: file,
          approximate: true,
          source: "heuristic",
        });
      }
    }
    return anchors;
  }

    private _collectEvidenceItems(
    envelope: EditorContextEnvelope,
    fileContent: string | null,
    additionalSections: Map<string, string>,
    plan: import("./types.js").ContextPlan,
  ): import("./types.js").EvidenceItem[] {
    const items: import("./types.js").EvidenceItem[] = [];

    const priorityRank = (
      item: import("./types.js").EvidenceItem,
    ): number => {
      switch (item.kind) {
        case "task":
          return 0;
        case "code":
          return 1;
        case "adr":
        case "api":
          return 2;
        case "environment":
          return 3;
        case "feature":
        case "workflow":
        case "ui":
          return 4;
        case "tension":
        case "causal":
        case "temporal":
        case "data_model":
        case "cognitive_status":
          return 5;
        case "note":
          return 6;
        default:
          return 7;
      }
    };

    /** Aggregate relevance from a list of graph entities that each carry a relevance score.
     *  Returns the max score, falling back to a supplied default when the list is empty. */
    const aggregateRelevance = (
      entities: Array<{ relevance?: number }>,
      fallback: number,
    ): number =>
      entities.length > 0
        ? Math.max(...entities.map((e) => e.relevance ?? fallback))
        : fallback;

    const taskContent = `## Task Framing\nIntent mode: ${plan.intentMode}\nTask: ${plan.taskSummary}\nPrimary anchor: ${plan.primaryAnchor?.label ?? "none"}`;
    items.push({
      kind: "task",
      title: "Task Framing",
      content: taskContent,
      relevance: 1,
      confidence: envelope.intentConfidence,
      anchor: plan.primaryAnchor?.label,
      tokenCost: estimateTokens(taskContent),
      required: true,
    });

    if (envelope.activeFile?.selection?.text) {
      const anchorLabel =
        envelope.activeFile.selection.anchor?.label ?? envelope.activeFile.selection.summary;
      const content = `## Verified Code Anchor\nAnchor: ${anchorLabel}\n\`\`\`${envelope.activeFile.languageId}\n${envelope.activeFile.selection.text}\n\`\`\``;
      items.push({
        kind: "code",
        title: "Verified Code Anchor",
        content,
        relevance: 1,
        anchor: anchorLabel,
        tokenCost: estimateTokens(content),
        required: true,
      });
    } else if (fileContent && envelope.activeFile) {
      const excerpt = this._trimActiveFile(
        fileContent,
        envelope,
        Math.floor(plan.budgetPolicy.maxTokens * 0.35),
      );
      if (excerpt) {
        items.push({
          kind: "code",
          title: "Focused Code Excerpt",
          content: excerpt,
          relevance: 0.85,
          anchor:
            envelope.activeFile.cursorAnchor?.label ?? envelope.activeFile.cursorSummary,
          tokenCost: estimateTokens(excerpt),
          required: plan.codeReadPlan.some(
            (p: import("./types.js").CodeReadPlan) => p.required,
          ),
        });
      }
    }

    if (envelope.graphContext?.applicableAdrs.length) {
      const entities = envelope.graphContext.applicableAdrs;
      const content = `## Relevant ADRs\n${entities
        .map((a) => `- ${a.id}: ${a.title}`)
        .join("\n")}`;
      items.push({
        kind: "adr",
        title: "Relevant ADRs",
        content,
        relevance: aggregateRelevance(entities, 0.95),
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("adr"),
      });
    }

    if (envelope.graphContext?.apiSurface) {
      const content = `## Relevant API Surface\n${JSON.stringify(envelope.graphContext.apiSurface, null, 2)}`;
      items.push({
        kind: "api",
        title: "Relevant API Surface",
        content,
        relevance: 0.9,
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("api"),
      });
    }

    if (envelope.environmentContext?.entries?.length) {
      const entries = envelope.environmentContext.entries.slice(
        0,
        plan.environmentPolicy?.scopeLimit ?? 2,
      );
      const contentLines: string[] = ["## Environment Context"];
      if (envelope.environmentContext.workspaceRuntime) {
        contentLines.push(`Workspace runtime: ${envelope.environmentContext.workspaceRuntime}`);
      }
      if (envelope.environmentContext.workspacePackageManager) {
        contentLines.push(
          `Package manager: ${envelope.environmentContext.workspacePackageManager}`,
        );
      }
      for (const entry of entries) {
        contentLines.push(
          `- \`${entry.scope}\`: ${entry.runtime}; ${entry.moduleSystem}; ${entry.role}`,
        );
        if (entry.framework) {
          contentLines.push(`  - Framework: ${entry.framework}`);
        }
        if (entry.boundaries[0]) {
          contentLines.push(`  - Boundary: ${entry.boundaries[0]}`);
        }
        if (entry.keyDependencies.length > 0) {
          contentLines.push(
            `  - Dependencies: ${entry.keyDependencies.slice(0, 3).join(", ")}`,
          );
        }
      }

      let content = contentLines.join("\n");
      let tokenCost = estimateTokens(content);
      if (tokenCost > (plan.environmentPolicy?.hardTokenCeiling ?? 320)) {
        const minimalLines: string[] = ["## Environment Context"];
        for (const entry of entries) {
          minimalLines.push(`- \`${entry.scope}\`: ${entry.role}`);
        }
        content = minimalLines.join("\n");
        tokenCost = estimateTokens(content);
      }

      if (tokenCost <= (plan.environmentPolicy?.hardTokenCeiling ?? 320)) {
        const aboveSoftCeiling = tokenCost > (plan.environmentPolicy?.softTokenCeiling ?? 220);
        items.push({
          kind: "environment",
          title: "Environment Context",
          content,
          relevance: aboveSoftCeiling ? 0.74 : 0.86,
          tokenCost,
          required: plan.environmentPolicy?.forceInclude ?? false,
        });
      }
    }

    if (
      envelope.graphContext?.relatedFeatures.length ||
      envelope.graphContext?.relatedWorkflows.length
    ) {
      const features = envelope.graphContext?.relatedFeatures ?? [];
      const workflows = envelope.graphContext?.relatedWorkflows ?? [];
      const featureLines = features.map((f) => `- feature ${f.id}: ${f.name}`);
      const workflowLines = workflows.map((w) => `- workflow ${w.id}: ${w.name}`);
      const content = `## Related Graph Contracts\n${[
        ...featureLines,
        ...workflowLines,
      ].join("\n")}`;
      items.push({
        kind: "feature",
        title: "Related Graph Contracts",
        content,
        relevance: aggregateRelevance([...features, ...workflows], 0.82),
        tokenCost: estimateTokens(content),
        required:
          plan.requiredEvidence.includes("feature") ||
          plan.requiredEvidence.includes("workflow"),
      });
    }

    if (envelope.graphContext?.uiPatterns.length) {
      const entities = envelope.graphContext.uiPatterns;
      const content = `## UI Registry Matches\n${entities
        .map((u) => `- ${u.id ? `${u.id}: ` : ""}${u.name}`)
        .join("\n")}`;
      items.push({
        kind: "ui",
        title: "UI Registry Matches",
        content,
        relevance: aggregateRelevance(entities, 0.8),
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("ui"),
      });
    }

    if (envelope.graphContext?.tensions.length) {
      const entities = envelope.graphContext.tensions;
      const content = `## Active Tensions\n${entities
        .map((t) => `- [${t.severity}] ${t.description}`)
        .join("\n")}`;
      items.push({
        kind: "tension",
        title: "Active Tensions",
        content,
        relevance: aggregateRelevance(entities, 0.88),
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("tension"),
      });
    }

    if (envelope.graphContext?.causalChains.length) {
      const content = `## Causal Signals\n${envelope.graphContext.causalChains
        .map((c) => `- ${c.from} -> ${c.to} (${c.relationship})`)
        .join("\n")}`;
      items.push({
        kind: "causal",
        title: "Causal Signals",
        content,
        relevance: 0.78,
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("causal"),
      });
    }

    if (envelope.graphContext?.temporalPatterns.length) {
      const content = `## Temporal Signals\n${envelope.graphContext.temporalPatterns
        .map((p) => `- ${p.pattern} (${p.frequency})`)
        .join("\n")}`;
      items.push({
        kind: "temporal",
        title: "Temporal Signals",
        content,
        relevance: 0.7,
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("temporal"),
      });
    }

    if (envelope.graphContext?.dataModelEntities.length) {
      const entities = envelope.graphContext.dataModelEntities;
      const content = `## Data Model Matches\n${entities
        .map((d) => `- ${d.id}: ${d.name} [${d.storage}]`)
        .join("\n")}`;
      items.push({
        kind: "data_model",
        title: "Data Model Matches",
        content,
        relevance: aggregateRelevance(entities, 0.7),
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("data_model"),
      });
    }

    if (envelope.graphContext?.cognitiveState) {
      const content = `## Cognitive State\nCurrent state: ${envelope.graphContext.cognitiveState}`;
      items.push({
        kind: "cognitive_status",
        title: "Cognitive State",
        content,
        relevance: 0.55,
        tokenCost: estimateTokens(content),
        required: plan.requiredEvidence.includes("cognitive_status"),
      });
    }

    for (const [name, content] of additionalSections.entries()) {
      items.push({
        kind: "note",
        title: name,
        content,
        relevance: 0.4,
        tokenCost: estimateTokens(content),
        required: false,
      });
    }

    return items.sort((a, b) => {
      const priorityDiff = priorityRank(a) - priorityRank(b);
      if (priorityDiff !== 0) return priorityDiff;
      if (a.required !== b.required) return a.required ? -1 : 1;
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  }

    private _trimActiveFile(
    fileContent: string,
    envelope: EditorContextEnvelope,
    remainingBudget: number,
  ): string | null {
    if (remainingBudget <= 100) return null;

    const lines = fileContent.split("\n");
    const cursorLine = (envelope.activeFile?.cursorLine ?? 1) - 1;

    // Prefer the anchor stored on the active selection; fall back to the cursor anchor.
    const activeAnchor =
      envelope.activeFile?.selection?.anchor ??
      envelope.activeFile?.cursorAnchor;

    const anchorLabel =
      activeAnchor?.label ??
      envelope.activeFile?.selection?.summary ??
      envelope.activeFile?.cursorSummary ??
      "current file focus area (approximate anchor only; may drift)";

    // --- Window selection ------------------------------------------------
    // Priority 1: symbol-bounded window from the language server range.
    //   The symbol range is the authoritative extent of the containing symbol.
    //   We add a small padding (SYMBOL_PADDING lines) on each side so that
    //   JSDoc/decorators above and closing braces below are included.
    //
    // Priority 2: fixed ±CURSOR_FALLBACK_RADIUS window around the cursor.
    //   Used when no language-server range is available (heuristic anchors,
    //   archived anchors, or symbol provider not loaded yet).
    // ---------------------------------------------------------------------
    const SYMBOL_PADDING = 3;
    const CURSOR_FALLBACK_RADIUS = 20;

    let contextStart: number;
    let contextEnd: number;

    if (activeAnchor?.symbolRange) {
      // Symbol-bounded: use the actual symbol extent with padding.
      contextStart = Math.max(0, activeAnchor.symbolRange.startLine - SYMBOL_PADDING);
      contextEnd   = Math.min(lines.length, activeAnchor.symbolRange.endLine + SYMBOL_PADDING + 1);
    } else {
      // Cursor-fallback: fixed radius around the cursor position.
      contextStart = Math.max(0, cursorLine - CURSOR_FALLBACK_RADIUS);
      contextEnd   = Math.min(lines.length, cursorLine + CURSOR_FALLBACK_RADIUS);
    }

    const cursorContext = lines.slice(contextStart, contextEnd).join("\n");

    // Annotate the excerpt header so the LLM knows whether the window is
    // symbol-bounded or approximate.
    const windowNote = activeAnchor?.symbolRange
      ? `lines ${contextStart + 1}–${contextEnd} (symbol-bounded)`
      : `lines ${contextStart + 1}–${contextEnd} (cursor ±${CURSOR_FALLBACK_RADIUS}, approximate)`;

    const minimal =
      `## Focused Code Excerpt\n` +
      `Active file: ${envelope.activeFile?.path ?? "unknown"} — ${windowNote}\n` +
      `Active anchor: ${anchorLabel}\n` +
      `\`\`\`${envelope.activeFile?.languageId ?? ""}\n${cursorContext}\n\`\`\``;

    return estimateTokens(minimal) <= remainingBudget ? minimal : null;
  }

  private async _deriveSelectionSemanticAnchor(
    editor: vscode.TextEditor,
    selectionText?: string,
  ): Promise<import("./types.js").SemanticAnchor | undefined> {
    const symbolAnchor = await this._deriveSymbolAnchor(editor, editor.selection.active);
    if (symbolAnchor) {
      return {
        ...symbolAnchor,
        kind: "selection",
        approximate: false,
      };
    }

    const doc = editor.document;
    const lineText = doc.lineAt(editor.selection.active.line).text.trim();
    const excerpt = (selectionText ?? lineText)
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
    if (excerpt.length > 0) {
      return {
        kind: "selection",
        label: `selection near file-local logic \"${excerpt}\"`,
        path: vscode.workspace.asRelativePath(doc.uri),
        excerpt,
        approximate: true,
        source: "heuristic",
      };
    }

    return {
      kind: "selection",
      label: "selection within the current working symbol or focus region (approximate anchor only; may drift)",
      path: vscode.workspace.asRelativePath(doc.uri),
      approximate: true,
      source: "heuristic",
    };
  }

  private async _deriveCursorSemanticAnchor(
    editor: vscode.TextEditor,
  ): Promise<import("./types.js").SemanticAnchor | undefined> {
    const symbolAnchor = await this._deriveSymbolAnchor(editor, editor.selection.active);
    if (symbolAnchor) {
      return symbolAnchor;
    }

    const lineText = editor.document.lineAt(editor.selection.active.line).text.trim();
    if (lineText.length > 0) {
      const excerpt = lineText.replace(/\s+/g, " ").slice(0, 80);
      return {
        kind: "file",
        label: `cursor near file-local logic \"${excerpt}\" (approximate anchor only; may drift)`,
        path: vscode.workspace.asRelativePath(editor.document.uri),
        excerpt,
        approximate: true,
        source: "heuristic",
      };
    }

    return {
      kind: "file",
      label: "cursor within the current working symbol or focus region (approximate anchor only; may drift)",
      path: vscode.workspace.asRelativePath(editor.document.uri),
      approximate: true,
      source: "heuristic",
    };
  }

      private async _deriveSymbolAnchor(
    editor: vscode.TextEditor,
    position: vscode.Position,
    graphContext?: NonNullable<EditorContextEnvelope["graphContext"]> | null,
  ): Promise<import("./types.js").SemanticAnchor | undefined> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        editor.document.uri,
      );
      const match = this._findBestSymbolAtPosition(symbols ?? [], position);
      if (!match) return undefined;
      const symbolPath = this._buildSymbolPath(match.path);
      const baseAnchor: import("./types.js").SemanticAnchor = {
        kind: "symbol",
        label: `selection within symbol ${symbolPath}`,
        path: vscode.workspace.asRelativePath(editor.document.uri),
        symbolPath,
        approximate: false,
        source: "symbol_provider",
        migrationStatus: "native",
        confidence: 0.95,
        // Store the symbol's actual line range so _trimActiveFile can use a
        // symbol-bounded window instead of a fixed ±20-line cursor window.
        symbolRange: {
          startLine: match.symbol.range.start.line,
          endLine: match.symbol.range.end.line,
        },
      };
      // Attempt graph promotion immediately if graph context is available
      if (graphContext) {
        return this._promoteAnchor(baseAnchor, graphContext);
      }
      return baseAnchor;
    } catch {
      return undefined;
    }
  }

  private _findBestSymbolAtPosition(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position,
    path: vscode.DocumentSymbol[] = [],
  ): { symbol: vscode.DocumentSymbol; path: vscode.DocumentSymbol[] } | undefined {
    for (const symbol of symbols) {
      if (symbol.range.contains(position)) {
        const currentPath = [...path, symbol];
        const child = this._findBestSymbolAtPosition(symbol.children, position, currentPath);
        return child ?? { symbol, path: currentPath };
      }
    }
    return undefined;
  }

    private _buildSymbolPath(path: vscode.DocumentSymbol[]): string {
    return path.map((symbol) => symbol.name).join(".");
  }

  /* ------------------------------------------------------------------ */
  /*  Anchor promotion — symbol path → graph entity ID                  */
  /* ------------------------------------------------------------------ */

  /**
   * Tries to match a symbol-level anchor to a graph entity (feature, workflow,
   * ADR, UI registry element). If a match is found, the anchor is upgraded with
   * canonicalId + canonicalKind and migrationStatus = "promoted".
   *
   * Resolution order (mirrors recommended anchor hierarchy):
   *   1. Graph entity IDs matched by name or symbol path
   *   2. Workflow IDs
   *   3. ADR IDs
   *   4. UI registry IDs
   *   5. No match → anchor returned unchanged (native / heuristic)
   */
      private async _promoteAnchor(
    anchor: import("./types.js").SemanticAnchor,
    graphContext: Awaited<ReturnType<typeof this._resolveGraphContext>>,
  ): Promise<import("./types.js").SemanticAnchor> {
    if (!graphContext) return anchor;

    const symbolPath = anchor.symbolPath ?? anchor.label ?? "";
    const symbolName = symbolPath.includes(".")
      ? symbolPath.split(".").pop()!
      : symbolPath;
    const nameLower = symbolName.toLowerCase();

    /** Score a candidate string against the symbol name.
     *  Returns 0 (no match) → 1 (exact) with intermediate values for prefix / substring. */
    const matchScore = (candidate: string): number => {
      const c = candidate.toLowerCase();
      if (c === nameLower) return 1.0;           // exact
      if (c.startsWith(nameLower) || nameLower.startsWith(c)) return 0.75; // prefix
      if (c.includes(nameLower) || nameLower.includes(c)) return 0.5;      // substring
      return 0;
    };

    /** Minimum score required to accept a promotion. Prevents noise from short token overlap. */
    const PROMOTION_THRESHOLD = 0.5;

    type Candidate =
      | { kind: "entity"; score: number; entity: (typeof graphContext.relatedFeatures)[number] }
      | { kind: "workflow"; score: number; entity: (typeof graphContext.relatedWorkflows)[number] }
      | { kind: "adr"; score: number; entity: (typeof graphContext.applicableAdrs)[number] }
      | { kind: "ui"; score: number; entity: (typeof graphContext.uiPatterns)[number] };

    const candidates: Candidate[] = [];

    for (const f of graphContext.relatedFeatures) {
      const score = Math.max(matchScore(f.id), matchScore(f.name));
      if (score >= PROMOTION_THRESHOLD) candidates.push({ kind: "entity", score, entity: f });
    }
    for (const w of graphContext.relatedWorkflows) {
      const score = Math.max(matchScore(w.id), matchScore(w.name));
      if (score >= PROMOTION_THRESHOLD) candidates.push({ kind: "workflow", score, entity: w });
    }
    for (const a of graphContext.applicableAdrs) {
      const score = Math.max(matchScore(a.id), matchScore(a.title));
      if (score >= PROMOTION_THRESHOLD) candidates.push({ kind: "adr", score, entity: a });
    }
    for (const u of graphContext.uiPatterns) {
      const score = Math.max(matchScore(u.id ?? ""), matchScore(u.name));
      if (score >= PROMOTION_THRESHOLD) candidates.push({ kind: "ui", score, entity: u });
    }

    if (candidates.length === 0) return anchor;

    // Pick the highest-scoring candidate; tie-break by declaration order (entity > workflow > adr > ui)
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    const confidenceDelta = best.score >= 1.0 ? 0.2 : best.score >= 0.75 ? 0.15 : 0.1;

    switch (best.kind) {
      case "entity":
        return {
          ...anchor,
          canonicalId: best.entity.id,
          canonicalKind: "entity",
          label: `feature:${best.entity.id} (${best.entity.name})`,
          migrationStatus: "promoted",
          confidence: Math.min(1, (anchor.confidence ?? 0.7) + confidenceDelta),
          source: anchor.source,
        };
      case "workflow":
        return {
          ...anchor,
          canonicalId: best.entity.id,
          canonicalKind: "workflow",
          label: `workflow:${best.entity.id} (${best.entity.name})`,
          migrationStatus: "promoted",
          confidence: Math.min(1, (anchor.confidence ?? 0.7) + confidenceDelta),
        };
      case "adr":
        return {
          ...anchor,
          canonicalId: best.entity.id,
          canonicalKind: "adr",
          label: `adr:${best.entity.id} (${best.entity.title})`,
          migrationStatus: "promoted",
          confidence: Math.min(1, (anchor.confidence ?? 0.7) + confidenceDelta),
        };
      case "ui":
        return {
          ...anchor,
          canonicalId: best.entity.id ?? best.entity.name,
          canonicalKind: "ui",
          label: `ui:${best.entity.id ?? best.entity.name} (${best.entity.name})`,
          migrationStatus: "promoted",
          confidence: Math.min(1, (anchor.confidence ?? 0.7) + confidenceDelta),
        };
    }
  }

  /**
   * Applies legacy migration rules to an anchor whose prior symbolPath / canonicalId
   * is being re-evaluated against current graph context and VS Code symbol reality.
   *
   * Rules (matches the recommended migration policy):
   *   - Exact symbol match              → migrationStatus = "native" (already correct)
   *   - Symbol name found, path changed → migrationStatus = "rebound", update symbolPath
   *   - Partial name match only         → migrationStatus = "drifted", lower confidence
   *   - No match found anywhere         → migrationStatus = "archived", historical = true
   */
  private _migrateAnchor(
    anchor: import("./types.js").SemanticAnchor,
    currentSymbols: vscode.DocumentSymbol[],
    currentFilePath: string,
  ): import("./types.js").SemanticAnchor {
    const targetSymbolPath = anchor.symbolPath;
    if (!targetSymbolPath) return anchor;

    // Walk the symbol tree looking for the anchor's symbol by name
    const findByPath = (
      symbols: vscode.DocumentSymbol[],
      parts: string[],
    ): vscode.DocumentSymbol | undefined => {
      const [head, ...tail] = parts;
      const match = symbols.find((s) => s.name === head);
      if (!match) return undefined;
      if (tail.length === 0) return match;
      return findByPath(match.children, tail);
    };

    const findByLeafName = (
      symbols: vscode.DocumentSymbol[],
      leafName: string,
      path: vscode.DocumentSymbol[] = [],
    ): { symbol: vscode.DocumentSymbol; path: vscode.DocumentSymbol[] } | undefined => {
      for (const s of symbols) {
        if (s.name === leafName) return { symbol: s, path: [...path, s] };
        const child = findByLeafName(s.children, leafName, [...path, s]);
        if (child) return child;
      }
      return undefined;
    };

    const pathParts = targetSymbolPath.split(".");
    const leafName = pathParts[pathParts.length - 1];

    // Exact path match → already correct, mark native
    const exactMatch = findByPath(currentSymbols, pathParts);
    if (exactMatch) {
      return {
        ...anchor,
        migrationStatus: "native",
        confidence: Math.min(1, (anchor.confidence ?? 0.8) + 0.1),
        historical: false,
      };
    }

    // Leaf name found elsewhere in the tree → symbol moved, rebind
    const movedMatch = findByLeafName(currentSymbols, leafName);
    if (movedMatch) {
      const newPath = this._buildSymbolPath(movedMatch.path);
      return {
        ...anchor,
        symbolPath: newPath,
        label: anchor.label.replace(targetSymbolPath, newPath),
        path: currentFilePath,
        migrationStatus: "rebound",
        confidence: Math.min(0.85, (anchor.confidence ?? 0.7)),
        historical: false,
      };
    }

    // Partial / fuzzy match → heavy drift, lower confidence
    const fuzzyMatch = currentSymbols.some((s) =>
      s.name.toLowerCase().includes(leafName.toLowerCase()) ||
      leafName.toLowerCase().includes(s.name.toLowerCase()),
    );
    if (fuzzyMatch) {
      return {
        ...anchor,
        migrationStatus: "drifted",
        confidence: Math.max(0.2, (anchor.confidence ?? 0.5) - 0.25),
        approximate: true,
        historical: false,
      };
    }

    // No match → archive
    return {
      ...anchor,
      migrationStatus: "archived",
      confidence: Math.max(0.1, (anchor.confidence ?? 0.4) - 0.3),
      approximate: true,
      historical: true,
    };
  }

  /**
   * Public entry point: given an anchor (typically loaded from stored state or a
   * prior conversation turn), re-evaluate it against the current editor + graph
   * context and return a migrated + optionally promoted anchor.
   */
  async resolveAnchorMigration(
    anchor: import("./types.js").SemanticAnchor,
    graphContext: NonNullable<EditorContextEnvelope["graphContext"]> | null,
  ): Promise<import("./types.js").SemanticAnchor> {
    const editor = vscode.window.activeTextEditor;
    let migrated = anchor;

    // Step 1: migrate against current symbol tree if we're in the right file
    if (editor && anchor.path) {
      const currentPath = vscode.workspace.asRelativePath(editor.document.uri);
      if (currentPath === anchor.path && anchor.symbolPath) {
        try {
          const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            editor.document.uri,
          );
          migrated = this._migrateAnchor(anchor, symbols ?? [], currentPath);
        } catch {
          // Symbol provider unavailable — keep anchor as-is
        }
      }
    }

    // Step 2: attempt graph promotion on the (possibly migrated) anchor
    if (migrated.migrationStatus !== "archived") {
      migrated = await this._promoteAnchor(migrated, graphContext);
    }

    return migrated;
  }
}



