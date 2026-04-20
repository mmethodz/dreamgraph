/**
 * DreamGraph Chat Panel — M5 WebviewPanel controller.
 *
 * Owns all chat state (messages, streaming, model selection).
 * The webview is a dumb renderer — the extension host is the single source of truth.
 *
 * Chat history is persisted in ChatMemory and re-hydrated whenever the webview
 * is recreated or becomes visible again, so switching to another tool tab does
 * not erase the conversation.
 */
import * as vscode from 'vscode';
import type { ChatMemory } from './chat-memory';
import type { GraphSignalProvider } from './graph-signal';
import { type ArchitectLlm } from './architect-llm';
import type { McpClient } from './mcp-client';
import type { ContextBuilder } from './context-builder';
import type { ChangedFilesView } from './changed-files-view';
type ChatRole = 'user' | 'assistant' | 'system';
interface ActionExecutionRecord {
    timestamp: string;
    actionType: string;
    sourceMessageId: string;
    outcome: 'completed' | 'failed' | 'cancelled';
    detail?: string;
}
export declare class ChatPanel implements vscode.WebviewViewProvider, vscode.Disposable {
    private readonly context;
    static readonly viewType = "dreamgraph.chatView";
    private view;
    private readonly disposables;
    private readonly messages;
    private memory?;
    private graphSignal?;
    private architectLlm?;
    private contextBuilder?;
    private mcpClient?;
    private _restoringAnchors;
    private changedFilesView?;
    private currentInstanceId;
    private streaming;
    private abortController;
    private streamingContent;
    private steeringQueue;
    private draftText;
    private attachments;
    /** Messages buffered while the webview was hidden. Flushed on rehydrate. */
    private _pendingMessages;
    /** Cached browser build of markdown-it. Loaded once at first getHtml() call. */
    private _markdownItSource;
    /** Cached browser build of DOMPurify. Loaded once at first getHtml() call. */
    private _domPurifySource;
    /** Cached URI to bundled webview runtime for Slice 3 Option C migration. */
    private _webviewBundleUri;
    private _lastToolTrace;
    private _lastVerdict;
    private _actionLog;
    private _actionStateByMessage;
    private _hoverActionStateByMessage;
    /** Autonomy session state — tracks mode, pass budget, and continuation policy. */
    private _autonomyState;
    /** Whether autonomy continuation is actively enabled for this session. */
    private _autonomyEnabled;
    /** The last set of recommended actions from a pass analysis. */
    private _lastRecommendedActions;
    /** Whether an autonomy continuation loop is currently running. */
    private _autonomyContinuing;
    private static readonly MAX_RENDERED_MESSAGE_CHARS;
    private static readonly MAX_ENTITY_LINKS_PER_MESSAGE;
    private static readonly ACTION_ALLOWLIST;
    private static readonly MAX_TEXT_ATTACHMENT_BYTES;
    private static readonly MAX_IMAGE_ATTACHMENT_BYTES;
    /** Hard timeout per LLM provider request (ms). Prevents infinite hangs. */
    private static readonly REQUEST_TIMEOUT_MS;
    /** Per-tool timeout overrides (ms). Tools not listed use _default. */
    private static readonly TOOL_TIMEOUT_MS;
    private static readonly TEXT_EXTENSIONS;
    private static readonly IMAGE_MIME_BY_EXT;
    private static readonly TOOL_RESULT_LIMITS;
    private static _toolResultLimit;
    constructor(context: vscode.ExtensionContext);
    setGraphSignal(provider: GraphSignalProvider): void;
    setMemory(memory: ChatMemory): void;
    setArchitectLlm(llm: ArchitectLlm): void;
    setContextBuilder(cb: ContextBuilder): void;
    setMcpClient(mcp: McpClient): void;
    setChangedFilesProvider(provider: ChangedFilesView): void;
    setInstance(instanceId: string): void;
    get isVisible(): boolean;
    addExternalMessage(role: ChatRole, content: string): void;
    open(): void;
    resolveWebviewView(webviewView: vscode.WebviewView, _context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): Promise<void>;
    clearMessages(): Promise<void>;
    dispose(): void;
    private handleUserMessage;
    private _buildUserContentBlocks;
    private _attachmentSummaryForUserMessage;
    private _pickAttachments;
    private _syncAttachments;
    private _handlePastedImage;
    private abortGeneration;
    /**
     * Create a child AbortSignal that fires on EITHER user abort OR timeout.
     * Returns a dispose function that MUST be called when the request completes
     * to prevent timer leaks.
     */
    private _createRequestSignal;
    /**
     * Reset ALL streaming-related state in one place.
     * Sends cleanup messages to the webview so the UI never stays stuck.
     */
    private resetStreamState;
    private rehydrateWebview;
    private postState;
    getActionLogForTest(): ActionExecutionRecord[];
    private _createMessageId;
    private _roleMetaFor;
    private _formatAnchorFooterStatus;
    private _contextFooterFor;
    private _applyRenderLimits;
    private _buildMessageActions;
    private _detectImplicitEntities;
    private _formatImplicitEntityNotice;
    private _copyMessage;
    private _pinMessage;
    private _runMessageAction;
    /**
     * Post a message to the webview. If the webview is currently hidden or
     * disposed, critical messages are buffered and replayed on the next
     * rehydrateWebview() call to prevent silent loss of stream-end/error events.
     */
    private postMessage;
    private persistMessages;
    private _persistMessagesWithCanonicalAnchorRefresh;
    private restoreMessages;
    private _sendModelUpdate;
    private _checkApiKeyWarning;
    private _changeProvider;
    private _changeModel;
    private static readonly MAX_TOOL_ITERATIONS;
    private static readonly MAX_RETRIES;
    private static readonly MAX_VERIFICATION_BATCH_SIZE;
    private static readonly VERIFICATION_TIMEOUT_MS;
    /** Maximum number of autonomous continuation passes to prevent runaway loops. */
    private static readonly MAX_AUTONOMY_PASSES;
    /** Re-read autonomy settings from VS Code configuration and apply. */
    private _syncAutonomyFromSettings;
    /** Called from extension.ts when configuration changes. */
    applyAutonomySettings(): void;
    private _detectAutonomyRequest;
    private _setAutonomyMode;
    private _resetAutonomy;
    private _broadcastAutonomyStatus;
    private _handleAutonomyPassComplete;
    private _runAutonomyContinuationPass;
    private _executeRecommendedAction;
    private _executeAllRecommendedActions;
    private static readonly SECRET_PATTERNS;
    /** Cap on accumulated streaming content to prevent context window overflow
     *  when the agent runs many iterations. Content beyond this is still executed
     *  but not accumulated into streamingContent (the webview already received it). */
    private static readonly MAX_STREAMING_CONTENT_CHARS;
    /** Call callWithTools with automatic retry on 429 rate-limit errors. */
    private _callWithToolsRetry;
    private static _toolTimeoutMs;
    private runAgenticLoop;
    /**
     * Load markdown-it and DOMPurify browser builds from node_modules.
     * Results are cached on the instance. Falls back gracefully if files
     * are missing (e.g. corrupt .vsix or dev environment without npm install).
     */
    private _loadLibrarySources;
    private _getWebviewBundleUri;
    private _redactSecrets;
    private _executeMessageActionTool;
    private _summarizeToolArgs;
    private _deriveVerdict;
    private _extractFilesAffected;
    private _verifyEntities;
    private getHtml;
}
export {};
//# sourceMappingURL=chat-panel.d.ts.map