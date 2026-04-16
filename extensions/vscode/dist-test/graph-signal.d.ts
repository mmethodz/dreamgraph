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
    tensions: Array<{
        id: string;
        description: string;
        severity: string;
    }>;
    insights: Array<{
        type: string;
        insight: string;
        confidence: number;
    }>;
    adrs: Array<{
        id: string;
        title: string;
        status: string;
    }>;
    features: Array<{
        id: string;
        name: string;
    }>;
}
export declare class GraphSignalProvider implements vscode.Disposable {
    private readonly _mcpClient;
    private readonly _daemonClient;
    private _disposables;
    private _cache;
    private _debounceTimer;
    /** The most recent signal for the active file */
    private _currentSignal;
    /** Event: fired when graph signal is available for the active file */
    private readonly _onSignal;
    readonly onSignal: vscode.Event<FileGraphSignal>;
    /** Status bar item showing graph awareness */
    private _statusItem;
    constructor(_mcpClient: McpClient, _daemonClient: DaemonClient);
    get currentSignal(): FileGraphSignal | null;
    /**
     * Get cached signal for a specific file path (relative to workspace).
     */
    getCachedSignal(relativePath: string): FileGraphSignal | null;
    private _onFileChanged;
    private _fetchSignal;
    private _updateStatusBar;
    private _setNoSignal;
    private _buildSummary;
    /**
     * Invalidate cached signals (e.g., after graph-modifying operations).
     */
    invalidateCache(): void;
    dispose(): void;
}
//# sourceMappingURL=graph-signal.d.ts.map