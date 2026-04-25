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
import { ContextCache } from "./context-cache.js";
import {
  fetchDreamInsights,
  fetchCausalInsights,
  fetchTemporalInsights,
  fetchDataModelEntities,
  fetchCognitiveStatus,
} from "./context-fetchers/deep-insights.js";
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

  /**
   * Per-instance caches for hot-path context lookups.
   *
   * `buildEnvelope` runs synchronously in front of every LLM call — every cache miss
   * here directly delays the first visible token (and the first tool call) in the
   * chat panel. The {@link ContextCache} owns:
   *  - environment-snapshot slot (5 min TTL)
   *  - deep-insights slot (30 s TTL — dreams/causal/temporal/cognitive)
   *  - process-wide context-fetch timeout counter (F-14 observability)
   *  - the cognitive-mutating-tool list that drives {@link maybeInvalidateForTool}
   *  - the hard MCP fetch ceiling (F-07)
   */
  private readonly _cache = new ContextCache();

  /** Read-only snapshot of context-fetch timeouts (tool -> count). */
  public static getContextFetchTimeoutStats(): Record<string, number> {
    return ContextCache.getTimeoutStats();
  }

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
      ? await this._getCachedEnvironmentSnapshot(workspaceRoot, environmentModule)
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

  private _isPatchLikeRequest(
    envelope: EditorContextEnvelope,
    plan: import("./types.js").ContextPlan,
  ): boolean {
    const task = `${plan.taskSummary} ${envelope.intentMode}`.toLowerCase();
    return [
      "fix",
      "patch",
      "edit",
      "change",
      "modify",
      "update",
      "refactor",
      "implement",
      "rewrite",
      "rename",
      "remove",
      "replace",
      "compile",
      "build",
    ].some((keyword) => task.includes(keyword));
  }

  private async _buildImportContractEvidence(
  excerpt: string,
  envelope: EditorContextEnvelope,
  plan: import("./types.js").ContextPlan,
): Promise<import("./types.js").EvidenceItem | null> {
  if (!this._isPatchLikeRequest(envelope, plan)) {
    return null;
  }

  const importMatches = Array.from(
    excerpt.matchAll(/import\s+([^\n]*?)\s+from\s+["']([^"']+)["']/g),
  );
  if (importMatches.length === 0) {
    return null;
  }

  const summaries = await Promise.all(importMatches.slice(0, 4).map(async (match) => {
    const clause = match[1].replace(/\s+/g, ' ').trim();
    const modulePath = match[2];
    const verified = await this._resolveImportContractSummary(modulePath, envelope);
    if (verified) return `- ${verified}`;
    const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)\s*(,|$)/);
    const namedMatch = clause.match(/\{([^}]+)\}/);
    const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);

    const pieces: string[] = [];
    if (defaultMatch) pieces.push(`default=${defaultMatch[1]}`);
    if (namespaceMatch) pieces.push(`namespace=* as ${namespaceMatch[1]}`);
    if (namedMatch) {
      const named = namedMatch[1]
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', ');
      if (named) pieces.push(`named={${named}}`);
    }

    return `- ${modulePath}: observed clause ${pieces.length > 0 ? pieces.join('; ') : clause}`;
  }));

  const content = [
    '## Import Contracts',
    'Verified import contracts for the current patch target:',
    ...summaries,
    'Use only imported symbols evidenced here unless you verify additional exports with tools.',
  ].join('\n');

  return {
    kind: 'import_contract',
    title: 'Import contracts',
    content,
    relevance: 0.92,
    confidence: summaries.some((line) => !line.includes('observed clause')) ? 0.82 : 0.6,
    anchor: envelope.activeFile?.path,
    tokenCost: estimateTokens(content),
    required: true,
  };
}

  private async _buildTypeContractEvidence(
  excerpt: string,
  envelope: EditorContextEnvelope,
  plan: import("./types.js").ContextPlan,
): Promise<import("./types.js").EvidenceItem | null> {
  if (!this._isPatchLikeRequest(envelope, plan)) {
    return null;
  }

  const referencedTypes = new Set<string>();
  for (const match of excerpt.matchAll(/\b(?:type|interface|implements|extends|as)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    referencedTypes.add(match[1]);
  }
  for (const match of excerpt.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s*(?:<[^>]+>)?/g)) {
    const candidate = match[1];
    if (['Promise', 'Array', 'Map', 'Set', 'Record', 'ReturnType', 'Awaited', 'Partial', 'Required', 'Readonly'].includes(candidate)) {
      continue;
    }
    referencedTypes.add(candidate);
  }

  if (referencedTypes.size === 0) {
    return null;
  }

  const verifiedSummaries = await Promise.all(
    Array.from(referencedTypes).slice(0, 6).map((typeName) => this._resolveTypeContractSummary(typeName, envelope)),
  );

  const typeSummaries = Array.from(referencedTypes)
    .slice(0, 6)
    .map((typeName, index) => verifiedSummaries[index]
      ? `- verified contract: ${verifiedSummaries[index]}`
      : `- referenced type: ${typeName}`);

  const objectShapeHints = Array.from(
    excerpt.matchAll(/\b([a-zA-Z_][\w]*)\s*:\s*(["'`][^"'`]+["'`]|true|false|\d+|[A-Za-z_][\w<>]*)/g),
  )
    .slice(0, 8)
    .map((match) => `- field candidate: ${match[1]} = ${match[2]}`);

  const contentLines = [
    '## Type Contracts',
    'Verified and observed type contracts for the current patch target:',
    ...typeSummaries,
  ];
  if (objectShapeHints.length > 0) {
    contentLines.push('Observed object-shape/value hints in the excerpt:');
    contentLines.push(...objectShapeHints);
  }
  contentLines.push('Match returned object literals and discriminants to these evidenced contracts; do not invent new union or enum members.');

  const content = contentLines.join('\n');

  return {
    kind: 'type_contract',
    title: 'Type contracts',
    content,
    relevance: 0.92,
    confidence: verifiedSummaries.some(Boolean) ? 0.84 : 0.62,
    anchor: envelope.activeFile?.path,
    tokenCost: estimateTokens(content),
    required: true,
  };
}

  private async _buildLocalConventionEvidence(
  excerpt: string,
  envelope: EditorContextEnvelope,
): Promise<import("./types.js").EvidenceItem | null> {
  const activePath = envelope.activeFile?.path ?? '';
  const workspaceRoot = envelope.workspaceRoot ?? '';

  // Resolve the directory of the active file to find siblings.
  const activeDir = activePath.includes('/') || activePath.includes('\\')
    ? activePath.replace(/[/\\][^/\\]+$/, '')
    : '';

  if (!activeDir || !workspaceRoot) return null;

  const conventions: string[] = [];

  // Scan sibling TS/JS files for shared response patterns.
  const siblingPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\berror\s*\(/, label: 'failure responses use error(...)' },
    { pattern: /\bsuccess\s*\(/, label: 'success responses use success(...)' },
    { pattern: /\bToolResponse\s*</, label: 'return type is ToolResponse<T>' },
    { pattern: /\bthrow\s+new\s+Error/, label: 'errors thrown as new Error(...)' },
    { pattern: /\breturn\s+\{\s*ok\s*:/, label: 'result shape is { ok, ... }' },
    { pattern: /\breturn\s+\{\s*success\s*:/, label: 'result shape is { success, ... }' },
  ];

  try {
    const fs = await import('fs');
    const nodePath = await import('path');

    // Resolve absolute directory path.
    const absoluteDir = nodePath.default.isAbsolute(activeDir)
      ? activeDir
      : nodePath.default.join(workspaceRoot, activeDir);

    if (!fs.default.existsSync(absoluteDir)) return null;

    const siblingFiles = fs.default.readdirSync(absoluteDir)
      .filter((f: string) => /\.(ts|js|tsx|jsx)$/.test(f) && nodePath.default.join(absoluteDir, f) !== activePath)
      .slice(0, 6);

    const patternHits = new Map<string, number>();
    for (const file of siblingFiles) {
      try {
        const siblingPath = nodePath.default.join(absoluteDir, file);
        const content = fs.default.readFileSync(siblingPath, 'utf-8').slice(0, 8000);
        for (const { pattern, label } of siblingPatterns) {
          if (pattern.test(content)) {
            patternHits.set(label, (patternHits.get(label) ?? 0) + 1);
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Only report patterns observed in at least 2 siblings (strong convention).
    for (const [label, count] of patternHits.entries()) {
      if (count >= 2 || siblingFiles.length <= 2) {
        conventions.push(`- ${label} (seen in ${count}/${siblingFiles.length} siblings)`);
      }
    }
  } catch {
    return null;
  }

  // Also extract patterns from the excerpt itself as baseline.
  if (conventions.length === 0) {
    for (const { pattern, label } of [
      { pattern: /\berror\s*\(/, label: 'failure responses appear to use error(...)' },
      { pattern: /\bsuccess\s*\(/, label: 'success responses appear to use success(...)' },
    ]) {
      if (pattern.test(excerpt)) conventions.push(`- ${label} (observed in current file)`);
    }
  }

  if (conventions.length === 0) return null;

  const moduleFamily = activePath.replace(workspaceRoot, '').replace(/\\/g, '/').replace(/^\//, '');
  const content = [
    '## Local Conventions',
    `Conventions observed in sibling implementations near ${moduleFamily}:`,
    ...conventions,
    'Prefer these patterns over introducing new ones.',
  ].join('\n');

  return {
    kind: 'local_convention',
    title: 'Local conventions',
    content,
    relevance: 0.82,
    confidence: 0.75,
    anchor: activePath,
    tokenCost: estimateTokens(content),
    required: false,
  };
}

  private async _resolveImportContractSummary(
    modulePath: string,
    envelope: EditorContextEnvelope,
  ): Promise<string | null> {
    const activePath = envelope.activeFile?.path;
    if (!activePath) {
      return null;
    }

    const resolvedPath = this._resolveImportPath(activePath, modulePath);
    if (!resolvedPath) {
      return null;
    }

    const exportedSymbols = await this._collectModuleExportSymbols(resolvedPath);
    if (exportedSymbols.length === 0) {
      return `${modulePath} → ${resolvedPath}: module located, but no verified exports were extracted`;
    }

    return `${modulePath} → ${resolvedPath}: verified exports {${exportedSymbols.slice(0, 10).join(', ')}}`;
  }

  private async _resolveTypeContractSummary(
    typeName: string,
    envelope: EditorContextEnvelope,
  ): Promise<string | null> {
    const activePath = envelope.activeFile?.path;
    if (!activePath) {
      return null;
    }

    const candidateFiles = await this._candidateTypeFiles(activePath, typeName);
    for (const filePath of candidateFiles) {
      const summary = await this._extractTypeContractFromFile(filePath, typeName);
      if (summary) {
        return `${typeName} @ ${filePath}: ${summary}`;
      }
    }

    return null;
  }

  private _resolveImportPath(activePath: string, modulePath: string): string | null {
    if (!modulePath.startsWith('.')) {
      return null;
    }

    const normalizedActive = activePath.replace(/\\/g, '/');
    const segments = normalizedActive.split('/');
    segments.pop();

    for (const segment of modulePath.split('/')) {
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (segments.length === 0) {
          return null;
        }
        segments.pop();
      } else {
        segments.push(segment);
      }
    }

    return segments.join('/');
  }

  private async _collectModuleExportSymbols(resolvedPath: string): Promise<string[]> {
    const candidatePaths = this._moduleCandidatePaths(resolvedPath);
    for (const candidatePath of candidatePaths) {
      const content = await this.readFile(candidatePath);
      if (!content) {
        continue;
      }

      const exports = new Set<string>();
      for (const match of content.matchAll(/export\s+(?:async\s+)?(?:class|function|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
        exports.add(match[1]);
      }
      for (const match of content.matchAll(/export\s*\{([^}]+)\}/g)) {
        for (const piece of match[1].split(',')) {
          const cleaned = piece.trim();
          if (!cleaned) {
            continue;
          }
          const aliased = cleaned.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (aliased) {
            exports.add(aliased[2] ?? aliased[1]);
          }
        }
      }
      if (/export\s+default\s+/m.test(content)) {
        exports.add('default');
      }

      if (exports.size > 0) {
        return Array.from(exports);
      }
    }

    return [];
  }

  private _moduleCandidatePaths(resolvedPath: string): string[] {
    const normalized = resolvedPath.replace(/\\/g, '/');
    const hasExtension = /\.[A-Za-z0-9]+$/.test(normalized);
    if (hasExtension) {
      return [normalized];
    }

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const candidates = extensions.map((ext) => `${normalized}${ext}`);
    for (const ext of extensions) {
      candidates.push(`${normalized}/index${ext}`);
    }
    return candidates;
  }

  private async _candidateTypeFiles(activePath: string, typeName: string): Promise<string[]> {
    const candidates = new Set<string>();
    const activeContent = await this.readFile(activePath);
    if (activeContent) {
      for (const match of activeContent.matchAll(/import\s+[^\n]*\b(?:type\s+)?[^\n]*\bfrom\s+["']([^"']+)["']/g)) {
        const resolved = this._resolveImportPath(activePath, match[1]);
        if (resolved) {
          for (const candidate of this._moduleCandidatePaths(resolved)) {
            candidates.add(candidate);
          }
        }
      }
    }

    candidates.add(activePath);
    return Array.from(candidates).slice(0, 12);
  }

  private async _extractTypeContractFromFile(filePath: string, typeName: string): Promise<string | null> {
    const content = await this.readFile(filePath);
    if (!content) {
      return null;
    }

    const interfaceRegex = new RegExp(`export\\s+interface\\s+${typeName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
    const typeRegex = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([\\s\\S]*?);`, 'm');
    const enumRegex = new RegExp(`export\\s+enum\\s+${typeName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');

    const interfaceMatch = content.match(interfaceRegex);
    if (interfaceMatch) {
      const fields = interfaceMatch[1]
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join('; ');
      return `interface fields ${fields}`;
    }

    const typeMatch = content.match(typeRegex);
    if (typeMatch) {
      return `type alias ${typeMatch[1].replace(/\s+/g, ' ').trim().slice(0, 200)}`;
    }

    const enumMatch = content.match(enumRegex);
    if (enumMatch) {
      const members = enumMatch[1]
        .split('\n')
        .map((line) => line.trim().replace(/,$/, ''))
        .filter(Boolean)
        .slice(0, 10)
        .join(', ');
      return `enum members ${members}`;
    }

    return null;
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
    const evidence = await this._collectEvidenceItems(
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

    const evidenceParts = included.map((item) => item.content);
    const warningLines = omitted
      .filter((entry) => entry.required && (entry.kind === 'import_contract' || entry.kind === 'type_contract'))
      .map((entry) => `- Missing required ${entry.kind}: ${entry.reason}`);
    const safetyWarnings = warningLines.length > 0
      ? ['Patch safety warning: required contract evidence was omitted by budget or retrieval limits.', ...warningLines]
      : [];
    if (safetyWarnings.length > 0) {
      evidenceParts.unshift(['## Patch Safety', ...safetyWarnings].join('\n'));
    }
    const contextText = evidenceParts.join('\n\n');

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
      contextText,
      safetyWarnings,
      instrumentation: instrumentationResult.instrumentation,
    };
  }

    async assembleContextBlock(
  envelope: EditorContextEnvelope,
  fileContent: string | null,
  additionalSections: Map<string, string>,
): Promise<{
  text: string;
  usedTokens: number;
  totalTokens: number;
  trimmedSections: string[];
}> {
  const plan = this._createFallbackPlan(envelope);
  const evidence = await this._collectEvidenceItems(
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

  private _createContextPlan(
  envelope: EditorContextEnvelope,
  prompt?: string,
  commandSource?: string,
): import("./types.js").ContextPlan {
  const normalizedPrompt = (prompt ?? "").toLowerCase();
  const filePath = envelope.activeFile?.path ?? "current workspace";
  const languageId = envelope.activeFile?.languageId ?? "";
  const primaryAnchor = this._resolvePrimaryAnchor(envelope);
  const secondaryAnchors = this._resolveSecondaryAnchors(envelope, primaryAnchor);
  const requiredEvidence = new Set<import("./types.js").ContextEvidenceKind>();
  const optionalEvidence = new Set<import("./types.js").ContextEvidenceKind>();
  const codeReadPlan: import("./types.js").CodeReadPlan[] = [];

  const isAdr = /adr|architecture decision|guard.?rail/.test(normalizedPrompt);
  const isExplain = /explain|inspect|understand|how does|what does/.test(normalizedPrompt);
  const isBug = /bug|broken|error|failing|fails|failure|regression/.test(normalizedPrompt);
  const isUi = /ui|component|view|panel|webview|render/.test(normalizedPrompt);
  const isModify = /fix|patch|edit|change|modify|update|refactor|implement|rewrite|rename|remove|replace/.test(normalizedPrompt);
  const isBuildFix = /compile|build pass|make it compile|make build pass|type error/.test(normalizedPrompt);
  const isArchitecture = /architecture|system|design|workflow|feature/.test(normalizedPrompt);
  const isPatchLike = isModify || isBug || isBuildFix || ["applyPatch", "modifyCurrentFile", "fixCurrentFile"].includes(commandSource ?? "");
  const supportsContracts = languageId === "typescript" || languageId === "javascript" || languageId === "typescriptreact" || languageId === "javascriptreact";
  const selectedText = envelope.activeFile?.selection?.text ?? "";
  const anchorText = `${selectedText} ${primaryAnchor?.label ?? ""}`;
  const touchesImports = /\bimport\b|\bfrom\b/.test(selectedText) || /import|from/.test(normalizedPrompt);
  const touchesTypes = /\b[A-Z][A-Za-z0-9_]+\b/.test(anchorText) || /type|interface|union|enum|literal/.test(normalizedPrompt) || isBuildFix;

  requiredEvidence.add("task");

  if (envelope.activeFile) {
    codeReadPlan.push({
      scope: envelope.activeFile.selection ? "selection" : "focused_excerpt",
      reason: envelope.activeFile.selection
        ? "Selection is the most trustworthy local anchor for this request."
        : "Use a focused excerpt around the active symbol to keep code context small and local.",
      anchorLabel: primaryAnchor?.label,
      required: true,
    });
    requiredEvidence.add("code");
  }

  if (isPatchLike && supportsContracts) {
    if (touchesImports || selectedText.length === 0) {
      requiredEvidence.add("import_contract");
    }
    if (touchesTypes) {
      requiredEvidence.add("type_contract");
    }
    optionalEvidence.add("api");
    // Convention-heavy paths get local_convention to ground the model in sibling patterns.
    const conventionHeavyPath = /src[/\\]tools[/\\]|src[/\\]server[/\\]|extensions[/\\]vscode[/\\]src[/\\]/.test(filePath ?? "");
    if (conventionHeavyPath) {
      optionalEvidence.add("local_convention");
    }
  }

  if (isAdr) {
    requiredEvidence.add("adr");
  }

  if (isUi) {
    optionalEvidence.add("ui");
  }

  if (isArchitecture || isExplain || isModify) {
    optionalEvidence.add("feature");
    optionalEvidence.add("workflow");
  }

  if (isBug || isBuildFix) {
    optionalEvidence.add("tension");
    optionalEvidence.add("api");
  }

  const forceEnvironment = envelope.intentMode === "active_file" || isBuildFix;
  if (forceEnvironment) {
    optionalEvidence.add("environment");
  }

  if (!isAdr && !isUi && !isArchitecture && !isExplain && !isModify && !isBug) {
    optionalEvidence.add("feature");
    optionalEvidence.add("workflow");
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
      deepFetches.push(fetchCausalInsights(this._cache, this._mcpClient));
      deepKinds.push("causal");
    }
    if (needs.has("temporal")) {
      deepFetches.push(fetchTemporalInsights(this._cache, this._mcpClient));
      deepKinds.push("temporal");
    }
    if (needs.has("data_model")) {
      deepFetches.push(fetchDataModelEntities(envelope, this._mcpClient));
      deepKinds.push("data_model");
    }
    if (needs.has("cognitive_status")) {
      deepFetches.push(fetchCognitiveStatus(this._cache, this._mcpClient));
      deepKinds.push("cognitive_status");
    }
    if (needs.has("feature") || needs.has("workflow")) {
      deepFetches.push(fetchDreamInsights(this._cache, this._mcpClient));
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

  private async _getCachedEnvironmentSnapshot(
    workspaceRoot: string,
    environmentModule: typeof import("./environment-context.js"),
  ): Promise<import("./environment-context.js").EnvironmentContextSnapshot | null> {
    const cached = this._cache.getEnvSnapshot(workspaceRoot);
    if (cached !== undefined) return cached;
    const snapshot = await environmentModule.buildEnvironmentContextSnapshot(workspaceRoot);
    this._cache.setEnvSnapshot(workspaceRoot, snapshot);
    return snapshot;
  }

  /**
   * Invalidate the deep-insights cache so the next `buildEnvelope` re-fetches
   * dreams / causal / temporal / cognitive_status. Call after a graph-mutating
   * action so the chat panel does not assert "Verified" against stale state.
   */
  public invalidateDeepInsights(reason?: string): void {
    this._cache.invalidateDeepInsights(reason);
  }

  /**
   * Convenience: invalidate when a tool name is known to mutate cognitive state.
   * Returns true if the cache was invalidated.
   */
  public maybeInvalidateForTool(toolName: string): boolean {
    return this._cache.maybeInvalidateForTool(toolName);
  }

  /** Drop every cached slot. Useful on workspace change or daemon reconnect. */
  public clearAllCaches(): void {
    this._cache.clearAll();
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

    private async _collectEvidenceItems(
    envelope: EditorContextEnvelope,
    fileContent: string | null,
    additionalSections: Map<string, string>,
    plan: import("./types.js").ContextPlan,
  ): Promise<import("./types.js").EvidenceItem[]> {
    const evidence: import("./types.js").EvidenceItem[] = [];
    const excerpt = fileContent ?? envelope.activeFile?.selection?.text ?? '';

    evidence.push({
      kind: 'task',
      title: 'Task summary',
      content: `## Task\n${plan.taskSummary}`,
      relevance: 1,
      tokenCost: estimateTokens(plan.taskSummary),
      required: true,
    });

    if (excerpt) {
      evidence.push({
        kind: 'code',
        title: 'Code context',
        content: `## Code\n${excerpt}`,
        relevance: 0.98,
        anchor: envelope.activeFile?.path,
        tokenCost: estimateTokens(excerpt) + 3,
        required: plan.requiredEvidence.includes('code'),
      });

      const importEvidence = await this._buildImportContractEvidence(excerpt, envelope, plan);
      if (importEvidence && plan.requiredEvidence.includes('import_contract')) {
        evidence.push(importEvidence);
      }
      const typeEvidence = await this._buildTypeContractEvidence(excerpt, envelope, plan);
      if (typeEvidence && plan.requiredEvidence.includes('type_contract')) {
        evidence.push(typeEvidence);
      }
      if (plan.optionalEvidence.includes('local_convention') || plan.requiredEvidence.includes('local_convention')) {
        const conventionEvidence = await this._buildLocalConventionEvidence(excerpt, envelope);
        if (conventionEvidence) evidence.push(conventionEvidence);
      }
    }

    for (const [title, content] of additionalSections.entries()) {
      evidence.push({
        kind: 'note',
        title,
        content,
        relevance: 0.5,
        tokenCost: estimateTokens(content),
        required: false,
      });
    }

    return evidence.sort((a, b) => {
      const priority = (kind: import("./types.js").ContextEvidenceKind): number => {
        switch (kind) {
          case 'task': return 0;
          case 'code': return 1;
          case 'import_contract':
          case 'type_contract':
          case 'local_convention':
          case 'adr':
          case 'api': return 2;
          case 'environment': return 3;
          case 'feature':
          case 'workflow':
          case 'ui': return 4;
          case 'tension':
          case 'causal':
          case 'temporal':
          case 'data_model':
          case 'cognitive_status': return 5;
          case 'note':
          default: return 6;
        }
      };
      return priority(a.kind) - priority(b.kind) || b.relevance - a.relevance;
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



