/**
 * DreamGraph Graph Signal — Proactive file-change context pre-fetching.
 *
 * When the user switches files, this module pre-fetches graph context
 * (features, tensions, insights, ADRs) for the new file and caches it.
 * This means the Architect starts every conversation already knowing
 * what the graph says about the current code — a fundamental advantage
 * over generic AI that only sees file content.
 *
 * Also provides status bar signals: if the graph knows interesting things
 * about the current file (active tensions, recent dream insights, ADRs),
 * the user sees it immediately without asking.
 */

import * as vscode from "vscode";
import type { McpClient } from "./mcp-client.js";
import type { DaemonClient } from "./daemon-client.js";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface FileGraphSignal {
  filePath: string;
  fetchedAt: Date;
  featureCount: number;
  workflowCount: number;
  adrCount: number;
  tensionCount: number;
  insightCount: number;
  /** One-line summary for status bar / hover */
  summary: string;
  /** Structured data for context injection */
  tensions: Array<{ id: string; description: string; severity: string }>;
  insights: Array<{ type: string; insight: string; confidence: number }>;
  adrs: Array<{ id: string; title: string; status: string }>;
  features: Array<{ id: string; name: string }>;
}

/* ------------------------------------------------------------------ */
/*  Graph Signal Provider                                             */
/* ------------------------------------------------------------------ */

export class GraphSignalProvider implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  private _cache = new Map<string, FileGraphSignal>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** The most recent signal for the active file */
  private _currentSignal: FileGraphSignal | null = null;

  /** Event: fired when graph signal is available for the active file */
  private readonly _onSignal = new vscode.EventEmitter<FileGraphSignal>();
  readonly onSignal: vscode.Event<FileGraphSignal> = this._onSignal.event;

  /** Status bar item showing graph awareness */
  private _statusItem: vscode.StatusBarItem;

  constructor(
    private readonly _mcpClient: McpClient,
    private readonly _daemonClient: DaemonClient,
  ) {
    this._statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      90,
    );
    this._statusItem.command = "dreamgraph.showGraphSignal";
    this._statusItem.tooltip = "DreamGraph: Graph context for current file";

    // Watch active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this._onFileChanged(editor.document.uri);
        }
      }),
    );

    // Initial fetch for current file
    if (vscode.window.activeTextEditor) {
      this._onFileChanged(vscode.window.activeTextEditor.document.uri);
    }
  }

  /* ---- Accessors ---- */

  get currentSignal(): FileGraphSignal | null {
    return this._currentSignal;
  }

  /**
   * Get cached signal for a specific file path (relative to workspace).
   */
  getCachedSignal(relativePath: string): FileGraphSignal | null {
    return this._cache.get(relativePath) ?? null;
  }

  /* ---- File Change Handler ---- */

  private _onFileChanged(uri: vscode.Uri): void {
    // Debounce — user switching quickly between files
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      void this._fetchSignal(uri);
    }, 300);
  }

  private async _fetchSignal(uri: vscode.Uri): Promise<void> {
    const relativePath = vscode.workspace.asRelativePath(uri);

    // Check cache (valid for 60 seconds)
    const cached = this._cache.get(relativePath);
    if (cached && Date.now() - cached.fetchedAt.getTime() < 60_000) {
      this._currentSignal = cached;
      this._updateStatusBar(cached);
      this._onSignal.fire(cached);
      return;
    }

    // Fetch from daemon
    try {
      if (!this._mcpClient.isConnected) return;

      const result = await this._daemonClient.getGraphContext({
        file_path: relativePath,
        include_adrs: true,
        include_tensions: true,
        include_ui: false,
        include_api_surface: false,
      });

      if (!result) {
        this._setNoSignal();
        return;
      }

      // Also try to get dream insights for this area (non-blocking)
      let insights: Array<{ type: string; insight: string; confidence: number }> = [];
      try {
        const insightResult = await this._mcpClient.callTool("get_dream_insights", {});
        const data = typeof insightResult === "string" ? JSON.parse(insightResult) : insightResult;
        const raw = data?.ok ? data.data?.insights : data?.insights;
        if (Array.isArray(raw)) {
          insights = raw.slice(0, 5).map((i: Record<string, unknown>) => ({
            type: String(i.type ?? "insight"),
            insight: String(i.insight ?? i.description ?? ""),
            confidence: Number(i.confidence ?? 0.5),
          }));
        }
      } catch {
        // Non-critical
      }

      const signal: FileGraphSignal = {
        filePath: relativePath,
        fetchedAt: new Date(),
        featureCount: result.features.length,
        workflowCount: result.workflows.length,
        adrCount: result.adrs.length,
        tensionCount: result.tensions.length,
        insightCount: insights.length,
        summary: this._buildSummary(result, insights),
        tensions: result.tensions.map((t) => ({
          id: t.id,
          description: t.description ?? t.summary ?? "",
          severity: t.severity ?? "",
        })),
        insights,
        adrs: result.adrs.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status,
        })),
        features: result.features.map((f) => ({
          id: f.id,
          name: f.name,
        })),
      };

      this._cache.set(relativePath, signal);
      this._currentSignal = signal;
      this._updateStatusBar(signal);
      this._onSignal.fire(signal);

      // Trim cache to 50 entries
      if (this._cache.size > 50) {
        const oldest = [...this._cache.entries()].sort(
          (a, b) => a[1].fetchedAt.getTime() - b[1].fetchedAt.getTime(),
        );
        for (let i = 0; i < oldest.length - 50; i++) {
          this._cache.delete(oldest[i][0]);
        }
      }
    } catch {
      this._setNoSignal();
    }
  }

  /* ---- Status Bar ---- */

  private _updateStatusBar(signal: FileGraphSignal): void {
    const parts: string[] = [];
    if (signal.tensionCount > 0) parts.push(`⚡${signal.tensionCount}`);
    if (signal.insightCount > 0) parts.push(`💡${signal.insightCount}`);
    if (signal.adrCount > 0) parts.push(`📋${signal.adrCount}`);
    if (signal.featureCount > 0) parts.push(`🔷${signal.featureCount}`);

    if (parts.length > 0) {
      this._statusItem.text = `$(brain) ${parts.join(" ")}`;
      this._statusItem.tooltip = `DreamGraph: ${signal.summary}`;
      this._statusItem.show();
    } else {
      this._statusItem.text = "$(brain) —";
      this._statusItem.tooltip = "DreamGraph: No graph context for this file";
      this._statusItem.show();
    }
  }

  private _setNoSignal(): void {
    this._currentSignal = null;
    this._statusItem.text = "$(brain) —";
    this._statusItem.tooltip = "DreamGraph: No graph context available";
    this._statusItem.show();
  }

  /* ---- Summary Builder ---- */

  private _buildSummary(
    result: { features: unknown[]; workflows: unknown[]; adrs: Array<{ id: string; title: string }>; tensions: Array<{ id: string; description?: string; summary?: string }> },
    insights: Array<{ type: string; insight: string }>,
  ): string {
    const parts: string[] = [];

    if (result.tensions.length > 0) {
      const tensionText = (result.tensions[0].description ?? result.tensions[0].summary ?? "").slice(0, 60);
      parts.push(`${result.tensions.length} tension${result.tensions.length > 1 ? "s" : ""}: ${tensionText}`);
    }
    if (insights.length > 0) {
      parts.push(`${insights.length} insight${insights.length > 1 ? "s" : ""}: ${insights[0].insight.slice(0, 60)}`);
    }
    if (result.adrs.length > 0) {
      parts.push(`${result.adrs.length} ADR${result.adrs.length > 1 ? "s" : ""} apply`);
    }
    if (result.features.length > 0) {
      parts.push(`${result.features.length} related feature${result.features.length > 1 ? "s" : ""}`);
    }

    return parts.length > 0 ? parts.join(" | ") : "No graph context for this file";
  }

  /**
   * Invalidate cached signals (e.g., after graph-modifying operations).
   */
  invalidateCache(): void {
    this._cache.clear();
    // Re-fetch for current file
    if (vscode.window.activeTextEditor) {
      this._onFileChanged(vscode.window.activeTextEditor.document.uri);
    }
  }

  /* ---- Dispose ---- */

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._statusItem.dispose();
    this._onSignal.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}
