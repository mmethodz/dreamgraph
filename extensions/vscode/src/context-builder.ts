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

  /* ---- Main Assembly ---- */

  /**
   * Build a full context envelope for the current editor state.
   * Optionally accepts a user prompt for intent detection.
   */
  async buildEnvelope(
    prompt?: string,
    commandSource?: string,
  ): Promise<EditorContextEnvelope> {
    const editor = vscode.window.activeTextEditor;
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

    // Detect intent
    const intentInput: IntentDetectionInput = {
      prompt: prompt ?? "",
      hasSelection: editor ? !editor.selection.isEmpty : false,
      selectionLineCount: editor
        ? editor.selection.end.line - editor.selection.start.line + 1
        : 0,
      commandSource,
    };
    const { mode, confidence } = detectIntent(intentInput);

    // Build base envelope
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
            selection: editor.selection.isEmpty
              ? null
              : {
                  startLine: editor.selection.start.line + 1,
                  endLine: editor.selection.end.line + 1,
                  text: editor.document.getText(editor.selection),
                },
          }
        : null,
      visibleFiles: vscode.window.visibleTextEditors.map((e) =>
        vscode.workspace.asRelativePath(e.document.uri),
      ),
      changedFiles: vscode.workspace.textDocuments
        .filter((d) => d.isDirty)
        .map((d) => vscode.workspace.asRelativePath(d.uri)),
      pinnedFiles: [],
      graphContext: null,
      intentMode: mode,
      intentConfidence: confidence,
    };

    // Populate graph context when needed (lazy — §3.2)
    if (this._shouldFetchGraphContext(mode)) {
      envelope.graphContext = await this._fetchGraphContext(envelope);
    }

    return envelope;
  }

  /* ---- File Content Read ---- */

  /**
   * Read the full content of the active file.
   * Returns null if no active editor.
   */
  readActiveFileContent(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    return editor.document.getText();
  }

  /**
   * Read the current selection text.
   * Returns null if no selection.
   */
  readSelectionContent(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) return null;
    return editor.document.getText(editor.selection);
  }

  /**
   * Read a file by path (relative to workspace root).
   */
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

  /* ---- Graph Context Fetching (§3.5) ---- */

  private _shouldFetchGraphContext(_mode: IntentMode): boolean {
    // Always fetch graph context — this is the core advantage.
    // The graph knows things about the code that generic AI doesn't.
    return true;
  }

  private async _fetchGraphContext(
    envelope: EditorContextEnvelope,
  ): Promise<EditorContextEnvelope["graphContext"]> {
    const graphCtx: NonNullable<EditorContextEnvelope["graphContext"]> = {
      relatedFeatures: [],
      relatedWorkflows: [],
      applicableAdrs: [],
      uiPatterns: [],
      activeTensions: 0,
      cognitiveState: "unknown",
      apiSurface: null,
      // Deep graph signals
      tensions: [],
      dreamInsights: [],
      causalChains: [],
      temporalPatterns: [],
      dataModelEntities: [],
    };

    // Try daemon REST endpoint first (batched, efficient)
    if (envelope.activeFile) {
      const result = await this._daemonClient.getGraphContext({
        file_path: envelope.activeFile.path,
        include_adrs: true,
        include_ui: true,
        include_api_surface: true,
        include_tensions: true,
      });

      if (result) {
        graphCtx.relatedFeatures = result.features.map(
          (f) => `${f.id} (${f.name})`,
        );
        graphCtx.relatedWorkflows = result.workflows.map(
          (w) => `${w.id} (${w.name})`,
        );
        graphCtx.applicableAdrs = result.adrs.map(
          (a) => `${a.id} (${a.title})`,
        );
        graphCtx.uiPatterns = result.ui_elements.map((u) => u.name);
        graphCtx.activeTensions = result.tensions.length;
        graphCtx.tensions = result.tensions.map((t) => ({
          id: t.id,
          description: t.description,
          severity: t.severity,
        }));
        if (result.api_surface) {
          graphCtx.apiSurface = result.api_surface;
        }
      }
    }

    // Fetch deep graph signals in parallel via MCP tools —
    // these are the knowledge edges that generic AI doesn't have.
    const deepFetches = await Promise.allSettled([
      this._fetchDreamInsights(),
      this._fetchCausalInsights(),
      this._fetchTemporalInsights(),
      this._fetchDataModelEntities(envelope.activeFile?.path),
      this._fetchCognitiveStatus(),
    ]);

    // Dream insights
    if (deepFetches[0].status === "fulfilled" && deepFetches[0].value) {
      graphCtx.dreamInsights = deepFetches[0].value;
    }
    // Causal chains
    if (deepFetches[1].status === "fulfilled" && deepFetches[1].value) {
      graphCtx.causalChains = deepFetches[1].value;
    }
    // Temporal patterns
    if (deepFetches[2].status === "fulfilled" && deepFetches[2].value) {
      graphCtx.temporalPatterns = deepFetches[2].value;
    }
    // Data model entities
    if (deepFetches[3].status === "fulfilled" && deepFetches[3].value) {
      graphCtx.dataModelEntities = deepFetches[3].value;
    }
    // Cognitive status
    if (deepFetches[4].status === "fulfilled" && deepFetches[4].value) {
      graphCtx.cognitiveState = deepFetches[4].value;
    }

    return graphCtx;
  }

  /* ---- Deep Graph Signal Fetchers ---- */

  private async _fetchDreamInsights(): Promise<
    Array<{ type: string; insight: string; confidence: number; source?: string }>
  > {
    try {
      const result = await this._mcpClient.callTool("get_dream_insights", {});
      const data = typeof result === "string" ? JSON.parse(result) : result;
      if (data?.ok && Array.isArray(data.data?.insights)) {
        return data.data.insights.slice(0, 10).map((i: Record<string, unknown>) => ({
          type: String(i.type ?? "insight"),
          insight: String(i.insight ?? i.description ?? i.text ?? ""),
          confidence: Number(i.confidence ?? 0.5),
          source: i.source ? String(i.source) : undefined,
        }));
      }
      if (Array.isArray(data?.insights)) {
        return data.insights.slice(0, 10).map((i: Record<string, unknown>) => ({
          type: String(i.type ?? "insight"),
          insight: String(i.insight ?? i.description ?? i.text ?? ""),
          confidence: Number(i.confidence ?? 0.5),
          source: i.source ? String(i.source) : undefined,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  private async _fetchCausalInsights(): Promise<
    Array<{ from: string; to: string; relationship: string; confidence: number }>
  > {
    try {
      const result = await this._mcpClient.callTool("get_causal_insights", {});
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const chains = data?.ok ? data.data?.chains ?? data.data?.insights : data?.chains ?? data?.insights;
      if (Array.isArray(chains)) {
        return chains.slice(0, 15).map((c: Record<string, unknown>) => ({
          from: String(c.from ?? c.source ?? ""),
          to: String(c.to ?? c.target ?? ""),
          relationship: String(c.relationship ?? c.type ?? "influences"),
          confidence: Number(c.confidence ?? 0.5),
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  private async _fetchTemporalInsights(): Promise<
    Array<{ pattern: string; frequency: string; last_seen?: string }>
  > {
    try {
      const result = await this._mcpClient.callTool("get_temporal_insights", {});
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const patterns = data?.ok ? data.data?.patterns ?? data.data?.insights : data?.patterns ?? data?.insights;
      if (Array.isArray(patterns)) {
        return patterns.slice(0, 8).map((p: Record<string, unknown>) => ({
          pattern: String(p.pattern ?? p.description ?? ""),
          frequency: String(p.frequency ?? p.recurrence ?? "unknown"),
          last_seen: p.last_seen ? String(p.last_seen) : undefined,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  private async _fetchDataModelEntities(
    filePath?: string,
  ): Promise<Array<{ id: string; name: string; storage: string }>> {
    try {
      const args: Record<string, unknown> = {};
      if (filePath) args.entity_name = filePath.split("/").pop()?.replace(/\.\w+$/, "") ?? "";
      const result = await this._mcpClient.callTool("search_data_model", args);
      const data = typeof result === "string" ? JSON.parse(result) : result;
      const entities = data?.ok ? data.data?.matches ?? data.data?.entities : data?.matches ?? data?.entities;
      if (Array.isArray(entities)) {
        return entities.slice(0, 10).map((e: Record<string, unknown>) => ({
          id: String(e.id ?? ""),
          name: String(e.name ?? ""),
          storage: String(e.storage ?? e.store ?? "unknown"),
        }));
      }
      return [];
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

  /* ---- Token Budget Assembly (§3.7) ---- */

  /**
   * Assemble context sections into a single text block, respecting token budget.
   * Returns the assembled context and budget metadata.
   */
  assembleContextBlock(
    envelope: EditorContextEnvelope,
    fileContent: string | null,
    additionalSections: Map<string, string>,
  ): { text: string; usedTokens: number; totalTokens: number; trimmedSections: string[] } {
    const budget = this._options.maxContextTokens;
    const trimmedSections: string[] = [];

    // Priority-ordered sections (§3.7)
    const sections: Array<{ name: string; content: string; priority: number }> = [];

    // Priority 1: Selection text
    if (envelope.activeFile?.selection?.text) {
      sections.push({
        name: "Selection",
        content: `## Selected Code\n\`\`\`${envelope.activeFile.languageId}\n${envelope.activeFile.selection.text}\n\`\`\``,
        priority: 1,
      });
    }

    // Priority 2: Active file
    if (fileContent) {
      sections.push({
        name: "Active File",
        content: `## Active File: ${envelope.activeFile?.path ?? "unknown"}\n\`\`\`${envelope.activeFile?.languageId ?? ""}\n${fileContent}\n\`\`\``,
        priority: 2,
      });
    }

    // Priority 3: ADRs
    const adrs = additionalSections.get("adrs");
    if (adrs) {
      sections.push({ name: "ADRs", content: adrs, priority: 3 });
    }

    // Priority 4: API surface
    const apiSurface = additionalSections.get("apiSurface");
    if (apiSurface) {
      sections.push({ name: "API Surface", content: apiSurface, priority: 4 });
    }

    // Priority 5: UI patterns
    const uiPatterns = additionalSections.get("uiPatterns");
    if (uiPatterns) {
      sections.push({ name: "UI Patterns", content: uiPatterns, priority: 5 });
    }

    // Priority 6: Features/workflows
    const features = additionalSections.get("features");
    if (features) {
      sections.push({ name: "Features/Workflows", content: features, priority: 6 });
    }

    // Priority 7: Tensions
    const tensions = additionalSections.get("tensions");
    if (tensions) {
      sections.push({ name: "Tensions", content: tensions, priority: 7 });
    }

    // Priority 8: System overview
    const overview = additionalSections.get("overview");
    if (overview) {
      sections.push({ name: "System Overview", content: overview, priority: 8 });
    }

    // Sort by priority (ascending = highest priority first)
    sections.sort((a, b) => a.priority - b.priority);

    // Assemble within budget
    let usedTokens = 0;
    const includedParts: string[] = [];

    for (const section of sections) {
      const sectionTokens = estimateTokens(section.content);
      if (usedTokens + sectionTokens <= budget) {
        includedParts.push(section.content);
        usedTokens += sectionTokens;
      } else {
        // Active file gets special trimming (§3.7 rule 2)
        if (section.name === "Active File" && fileContent) {
          const trimmed = this._trimActiveFile(
            fileContent,
            envelope,
            budget - usedTokens,
          );
          if (trimmed) {
            includedParts.push(trimmed);
            usedTokens += estimateTokens(trimmed);
          } else {
            trimmedSections.push(section.name);
          }
        } else {
          trimmedSections.push(section.name);
        }
      }
    }

    // Add trimming note if anything was dropped (§3.7 rule 5)
    if (trimmedSections.length > 0) {
      const note = `\n[Context note: ${trimmedSections.join(", ")} trimmed due to token budget]\n`;
      includedParts.push(note);
      usedTokens += estimateTokens(note);
    }

    return {
      text: includedParts.join("\n\n"),
      usedTokens,
      totalTokens: budget,
      trimmedSections,
    };
  }

  /* ---- Active File Trimming (§3.7 rule 2) ---- */

  private _trimActiveFile(
    fileContent: string,
    envelope: EditorContextEnvelope,
    remainingBudget: number,
  ): string | null {
    if (remainingBudget <= 100) return null; // not enough for anything useful

    const lines = fileContent.split("\n");
    const cursorLine = (envelope.activeFile?.cursorLine ?? 1) - 1;

    // Extract: (a) function/class around cursor (~50 lines), (b) imports, (c) header
    const parts: string[] = [];

    // Header (first 20 lines)
    const header = lines.slice(0, Math.min(20, lines.length)).join("\n");
    parts.push(header);

    // Import block (lines starting with import/from/require)
    const imports = lines
      .filter((l) => /^\s*(import |from |require\(|const .* = require)/.test(l))
      .join("\n");
    if (imports.length > 0) {
      parts.push("// ... imports ...\n" + imports);
    }

    // Function/class around cursor (25 lines before, 25 after)
    const contextStart = Math.max(0, cursorLine - 25);
    const contextEnd = Math.min(lines.length, cursorLine + 25);
    const cursorContext = lines.slice(contextStart, contextEnd).join("\n");
    parts.push(`// ... around cursor (line ${cursorLine + 1}) ...\n` + cursorContext);

    const assembled = `## Active File: ${envelope.activeFile?.path ?? "unknown"} (trimmed)\n\`\`\`${envelope.activeFile?.languageId ?? ""}\n${parts.join("\n\n")}\n\`\`\``;

    if (estimateTokens(assembled) <= remainingBudget) {
      return assembled;
    }

    // If even trimmed version is too big, just cursor context
    const minimal = `## Active File: ${envelope.activeFile?.path ?? "unknown"} (trimmed — cursor context only)\n\`\`\`${envelope.activeFile?.languageId ?? ""}\n${cursorContext}\n\`\`\``;
    if (estimateTokens(minimal) <= remainingBudget) {
      return minimal;
    }

    return null;
  }
}
