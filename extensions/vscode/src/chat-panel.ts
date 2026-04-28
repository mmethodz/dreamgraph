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
import * as path from 'path';
import * as fs from 'fs';
import type { ChatMemory, PersistedMessage } from './chat-memory';
import { getStyles } from './webview/styles.js';
import { getRenderScript } from './webview/render-markdown.js';
import { getEntityLinksScript } from './webview/entity-links.js';
import { getCardRendererScript } from './webview/card-renderer.js';
import type { GraphSignalProvider } from './graph-signal';
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  type ArchitectContentBlock,
  type ArchitectLlm,
  type ArchitectMessage,
  type ArchitectModelCapabilities,
  type ArchitectProvider,
  type ToolDefinition,
} from './architect-llm';
import type { McpClient } from './mcp-client';
import type { ContextBuilder } from './context-builder';
import type { ChangedFilesView, ChangeType } from './changed-files-view';
import { LOCAL_TOOL_DEFINITIONS, isLocalTool, executeLocalTool } from './local-tools.js';
import { assemblePrompt, inferTask } from './prompts/index.js';
import { selectToolGroups } from './tool-groups.js';
import {
  createAutonomyState,
  deriveAutonomyStatusView,
  type AutonomyState,
  type AutonomyInstructionState,
  type RecommendedAction,
} from './autonomy.js';
import { analyzePass, advanceAutonomyStateIfContinued, buildContinuationPrompt } from './autonomy-loop.js';
import { extractStructuredPassEnvelope } from './autonomy-structured.js';
import { getAutonomyMode, getAutonomyPassBudget, parseAutonomyRequest } from './reporting.js';
import * as helpers from './chat-panel/helpers.js';
import {
  type ImplicitEntityDetectionResult,
  type VerdictBanner,
  type ToolTraceEntry,
} from './chat-panel/helpers.js';
import {
  REQUEST_TIMEOUT_MS as TIMEOUT_REQUEST_MS,
  getLlmTimeoutMs as _getLlmTimeoutMsPure,
  isTimeoutError as _isTimeoutErrorPure,
  buildTimeoutRecoveryPrompt as _buildTimeoutRecoveryPromptPure,
  createTimeoutAbortSignal,
} from './chat-panel/timeout.js';

type ChatRole = 'user' | 'assistant' | 'system';

/* ------------------------------------------------------------------ */
/*  Conversation-history bounding                                     */
/* ------------------------------------------------------------------ */
/**
 * Per-message char caps for what we send to the LLM (display copies are kept full).
 * Without these, a 20-message slice of structured-envelope assistant replies +
 * code-laden user prompts can easily exceed 300KB on its own — before the system
 * prompt and tool schemas are even added — and overflow the request-budget brake.
 */
const HISTORY_RECENT_KEEP = 2;        // Last N messages keep full content.
const HISTORY_RECENT_MAX_CHARS = 16_000;
const HISTORY_OLDER_MAX_CHARS = 4_000;

function _truncateHistoryMessage(content: string, cap: number): string {
  if (content.length <= cap) return content;
  const head = content.slice(0, cap);
  return `${head}\n\n[... ${(content.length - cap).toLocaleString()} chars omitted from history to bound LLM input ...]`;
}

function buildBoundedConversationMessages(
  messages: Array<{ role: ChatRole; content: string }>,
  maxRecent: number = 20,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const filtered = messages.filter((m) => m.role === 'user' || m.role === 'assistant') as Array<{ role: 'user' | 'assistant'; content: string }>;
  const sliced = filtered.slice(-maxRecent);
  const recentStart = sliced.length - HISTORY_RECENT_KEEP;
  return sliced.map((m, i) => {
    const cap = i >= recentStart ? HISTORY_RECENT_MAX_CHARS : HISTORY_OLDER_MAX_CHARS;
    return { role: m.role, content: _truncateHistoryMessage(m.content, cap) };
  });
}

/**
 * Replaces the `content` of tool_result blocks in older user-role messages
 * with a short stub. Keeps the last `keepLastPairs` assistant→tool_result
 * pairs intact (those are still being reasoned over). Older results stay
 * in the message array (so tool_use_id references remain valid) but no
 * longer carry their full payload.
 */
function _elideStaleToolResults(rawMessages: unknown[], keepLastPairs: number): void {
  // Find indices of user-role messages whose content looks like tool_result blocks.
  const toolResultIdx: number[] = [];
  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i] as { role?: string; content?: unknown };
    if (m?.role === 'user' && Array.isArray(m.content) && m.content.length > 0 && (m.content[0] as { type?: string })?.type === 'tool_result') {
      toolResultIdx.push(i);
    }
  }
  if (toolResultIdx.length <= keepLastPairs) return;
  const elideUpTo = toolResultIdx.length - keepLastPairs;
  // Threshold below which we leave the content fully intact — small tool results
  // are cheap and stripping them removes essential reasoning context.
  const ELIDE_MIN_CHARS = 2_000;
  // Head/tail snippet sizes preserve enough of the result that the model still
  // remembers what the call returned (signature, key fields, error tail) rather
  // than facing an opaque "[elided]" marker that forces it to re-issue the call.
  const HEAD_KEEP = 800;
  const TAIL_KEEP = 400;
  for (let n = 0; n < elideUpTo; n++) {
    const idx = toolResultIdx[n];
    const msg = rawMessages[idx] as { content: Array<{ type: string; tool_use_id: string; content: string; is_error?: boolean }> };
    msg.content = msg.content.map((b) => {
      if (typeof b.content !== 'string' || b.content.length <= ELIDE_MIN_CHARS) return b;
      const omitted = b.content.length - HEAD_KEEP - TAIL_KEEP;
      const head = b.content.slice(0, HEAD_KEEP);
      const tail = b.content.slice(-TAIL_KEEP);
      return {
        ...b,
        content: `${head}\n\n[... ${omitted.toLocaleString()} chars elided from earlier pass ...]\n\n${tail}`,
      };
    });
  }
}


interface ChatMessage {
  id?: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  fullContent?: string;
  instanceId?: string;
  implicitEntityNotice?: string;
  pinned?: boolean;
  sourceMessageId?: string;
  verdict?: VerdictBanner;
  toolTrace?: ToolTraceEntry[];
  anchor?: import('./types.js').SemanticAnchor;
}

interface MessageAction {
  id: string;
  label: string;
  kind: 'primary' | 'secondary';
  actionType: 'tool' | 'show_full';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  destructive?: boolean;
}

interface HoverActionState {
  copied?: boolean;
  pinned?: boolean;
}

interface ActionExecutionRecord {
  timestamp: string;
  actionType: string;
  sourceMessageId: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  detail?: string;
}

interface PromptAttachment {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  kind: 'text' | 'image';
  size: number;
  textContent?: string;
  dataBase64?: string;
  note?: string;
}

interface AttachmentPreview {
  id: string;
  name: string;
  kind: 'text' | 'image';
  mimeType: string;
  size: number;
  note?: string;
}

interface EntityVerification {
  status: 'verified' | 'latent' | 'unverified' | 'tension';
  confidence: number;
  lastValidated?: string;
}

type ExtensionToWebviewMessage =
  | { type: 'addMessage'; message: ChatMessage; actions?: MessageAction[]; roleMeta?: { title: string; subtitle?: string }; contextFooter?: string }
  | { type: 'messageActionState'; messageId: string; actionId: string; status: 'loading' | 'completed' | 'failed'; error?: string }
  | { type: 'stream-start' }
  | { type: 'stream-chunk'; chunk: string }
  | { type: 'stream-thinking'; active: boolean }
  | { type: 'stream-end'; done: boolean }
  | { type: 'tool-progress'; tool: string; message: string; progress?: number; total?: number }
  | { type: 'state'; state: { messages: ChatMessage[] } }
  | { type: 'updateModels'; providers: string[]; models: string[]; current: { provider: string; model: string }; capabilities: ArchitectModelCapabilities }
  | { type: 'setAttachments'; attachments: AttachmentPreview[] }
  | { type: 'error'; error: string }
  | { type: 'restoreDraft'; text: string }
  | { type: 'entityStatus'; requestId: string; results: Record<string, EntityVerification> }
  | { type: 'toolTrace'; calls: ToolTraceEntry[] }
  | { type: 'verdict'; verdict: VerdictBanner }
  | { type: 'autonomyStatus'; status: AutonomyStatusMessage }
  | { type: 'recommendedActions'; messageId: string; actions: RecommendedActionMessage[]; doAllEligible: boolean };

interface AutonomyStatusMessage {
  mode: string;
  countingActive: boolean;
  completed: number;
  remaining: number;
  totalAuthorized?: number;
  summary: string;
}

interface RecommendedActionMessage {
  id: string;
  label: string;
  rationale?: string;
}

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'runMessageAction'; messageId: string; actionId: string }
  | { type: 'retryMessage'; messageId: string }
  | { type: 'copyMessage'; messageId: string }
  | { type: 'pinMessage'; messageId: string }
  | { type: 'pickAttachments' }
  | { type: 'removeAttachment'; id: string }
  | { type: 'pasteImage'; dataBase64: string; mimeType: string }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'changeProvider'; provider: string }
  | { type: 'changeModel'; model: string }
  | { type: 'setApiKey' }
  | { type: 'saveDraft'; text: string }
  // Slice 1
  | { type: 'openExternalLink'; url: string }
  | { type: 'copyToClipboard'; text: string }
  // Slice 2
  | { type: 'navigateEntity'; uri: string }
  // Slice 4
  | { type: 'verifyEntities'; requestId: string; names: string[] }
  // Autonomy
  | { type: 'selectRecommendedAction'; actionId: string }
  | { type: 'doAllRecommendedActions' }
  | { type: 'envelopeAction'; label: string }
  | { type: 'envelopeDoAll'; labels: string[] }
  | { type: 'setAutonomyMode'; mode: string }
  | { type: 'resetAutonomy' };

export class ChatPanel implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'dreamgraph.chatView';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly messages: ChatMessage[] = [];
  private memory?: ChatMemory;
  private graphSignal?: GraphSignalProvider;
  private architectLlm?: ArchitectLlm;
  private contextBuilder?: ContextBuilder;
  private mcpClient?: McpClient;
  private contextInspector?: import('./context-inspector.js').ContextInspector;
  private _restoringAnchors = false;
  private changedFilesView?: ChangedFilesView;
  private currentInstanceId = 'default';
  private streaming = false;
  private abortController: AbortController | null = null;
  private streamingContent = '';
  private steeringQueue: string[] = [];
  private draftText = '';
  private attachments: PromptAttachment[] = [];
  /** Messages buffered while the webview was hidden. Flushed on rehydrate. */
  private _pendingMessages: ExtensionToWebviewMessage[] = [];

  /** Cached browser build of markdown-it. Loaded once at first getHtml() call. */
  private _markdownItSource: string | null = null;
  /** Cached browser build of DOMPurify. Loaded once at first getHtml() call. */
  private _domPurifySource: string | null = null;
  /** Cached URI to bundled webview runtime for Slice 3 Option C migration. */
  private _webviewBundleUri: string | null = null;
  private _lastToolTrace: ToolTraceEntry[] = [];
  private _lastVerdict: VerdictBanner | null = null;
  private _actionLog: ActionExecutionRecord[] = [];
  private _actionStateByMessage = new Map<string, Set<string>>();
  private _hoverActionStateByMessage = new Map<string, HoverActionState>();

  /** Autonomy session state — tracks mode, pass budget, and continuation policy. */
  private _autonomyState: AutonomyState = createAutonomyState(getAutonomyMode(), getAutonomyPassBudget());
  /** Whether autonomy continuation is actively enabled for this session. */
  private _autonomyEnabled = getAutonomyMode() !== 'cautious' || (getAutonomyPassBudget() ?? 0) > 0;
  /** The last set of recommended actions from a pass analysis. */
  private _lastRecommendedActions: RecommendedAction[] = [];
  /** Whether an autonomy continuation loop is currently running. */
  private _autonomyContinuing = false;
  /** Task state captured at loop stop time. Injected into the next turn's system prompt
   * so that "resume" re-enters from a known task position rather than a fresh context. */
  private _lastStopContext: { summary?: string; nextSteps: Array<{ label: string; rationale?: string }> } | null = null;

  private static readonly MAX_RENDERED_MESSAGE_CHARS = 100_000;
  private static readonly MAX_ENTITY_LINKS_PER_MESSAGE = 100;
  private static readonly ACTION_ALLOWLIST = new Set(['tool', 'show_full']);

  private static readonly MAX_TEXT_ATTACHMENT_BYTES = 100_000;
  private static readonly MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

  /** Hard timeout per LLM provider request (ms). Prevents infinite hangs.
   *  Re-exported from chat-panel/timeout.ts so existing call sites keep working. */
  private static readonly REQUEST_TIMEOUT_MS = TIMEOUT_REQUEST_MS;

  private static readonly TEXT_EXTENSIONS = new Set([
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.py', '.cs', '.java', '.go', '.rs', '.yml', '.yaml', '.xml', '.html', '.css', '.scss', '.sql', '.sh'
  ]);

  private static readonly IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };

  private static _toolResultLimit(toolName: string): number {
    return helpers.toolResultLimit(toolName);
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public setGraphSignal(provider: GraphSignalProvider): void { this.graphSignal = provider; }
  public setMemory(memory: ChatMemory): void { this.memory = memory; }
  public setArchitectLlm(llm: ArchitectLlm): void { this.architectLlm = llm; }
  public setContextBuilder(cb: ContextBuilder): void { this.contextBuilder = cb; }
  public setMcpClient(mcp: McpClient): void { this.mcpClient = mcp; }
  public setChangedFilesProvider(provider: ChangedFilesView): void { this.changedFilesView = provider; }
  public setContextInspector(inspector: import('./context-inspector.js').ContextInspector): void { this.contextInspector = inspector; }

  public setInstance(instanceId: string): void {
    if (this.currentInstanceId === instanceId) return;
    this.currentInstanceId = instanceId;
    void this.restoreMessages();
  }

  public get isVisible(): boolean { return this.view?.visible ?? false; }

  public addExternalMessage(role: ChatRole, content: string): void {
    const msg: ChatMessage = { id: this._createMessageId(), role, content, timestamp: new Date().toISOString(), instanceId: this.currentInstanceId };
    this.messages.push(msg);
    void this.persistMessages();
    void this.postMessage({ type: 'addMessage', message: msg, actions: this._buildMessageActions(msg), roleMeta: this._roleMetaFor(msg), contextFooter: this._contextFooterFor(msg) });
  }

  public open(): void { void vscode.commands.executeCommand('dreamgraph.chatView.focus'); }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    }, null, this.disposables);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.rehydrateWebview();
    }, null, this.disposables);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready':
          this._syncAutonomyFromSettings();
          await this.rehydrateWebview();
          if (!this.architectLlm?.currentConfig) await this.architectLlm?.loadConfig();
          this._sendModelUpdate();
          this._checkApiKeyWarning();
          await this._syncAttachments();
          break;
        case 'send':
          if (typeof message.text === 'string' && message.text.trim().length > 0) {
            if (this.streaming) {
              this.steeringQueue.push(message.text.trim());
              const steerMsg = `\n\n💬 *Steering: "${message.text.trim()}"*\n`;
              this.streamingContent += steerMsg;
              void this.postMessage({ type: 'stream-chunk', chunk: steerMsg });
            } else {
              await this.handleUserMessage(message.text.trim());
            }
          }
          break;
        case 'pickAttachments':
          await this._pickAttachments();
          break;
        case 'removeAttachment':
          this.attachments = this.attachments.filter((a) => a.id !== message.id);
          await this._syncAttachments();
          break;
        case 'pasteImage':
          await this._handlePastedImage(message.dataBase64, message.mimeType);
          break;
        case 'clear':
          await this.clearMessages();
          break;
        case 'stop':
          this.abortGeneration();
          break;
        case 'changeProvider':
          await this._changeProvider(message.provider as ArchitectProvider);
          break;
        case 'changeModel':
          if (message.model === '__custom__') {
            const custom = await vscode.window.showInputBox({ prompt: 'Enter a custom model name', placeHolder: 'e.g. claude-sonnet-4' });
            if (custom) await this._changeModel(custom); else this._sendModelUpdate();
          } else {
            await this._changeModel(message.model);
          }
          break;
        case 'setApiKey':
          await vscode.commands.executeCommand('dreamgraph.setArchitectApiKey');
          break;
        case 'saveDraft':
          this.draftText = message.text ?? '';
          break;
        case 'openExternalLink': {
          const url = (message as { type: 'openExternalLink'; url: string }).url;
          if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
            void vscode.env.openExternal(vscode.Uri.parse(url));
          }
          break;
        }
        case 'copyToClipboard': {
          const text = (message as { type: 'copyToClipboard'; text: string }).text;
          if (typeof text === 'string') {
            void vscode.env.clipboard.writeText(text);
          }
          break;
        }
        case 'navigateEntity': {
          // Slice 2 — entity URI navigation. Delegate to VS Code command if registered,
          // or fall back to opening a graph query for the referenced entity.
          const uri = (message as { type: 'navigateEntity'; uri: string }).uri;
          if (typeof uri === 'string' && /^[a-z-]+:\/\//.test(uri)) {
            const [scheme, rawName = ''] = uri.split('://');
            const name = decodeURIComponent(rawName);

            // file:// URIs open the file directly in the editor
            if (scheme === 'file') {
              const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
              const absPath = path.isAbsolute(name) ? name : path.resolve(ws, name);
              let opened = false;
              try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
                await vscode.window.showTextDocument(doc, { preview: true });
                opened = true;
              } catch {
                // Direct path failed — search workspace for the filename
              }
              if (!opened) {
                const basename = name.includes('/') ? name : `**/${name}`;
                const matches = await vscode.workspace.findFiles(basename, '**/node_modules/**', 5);
                if (matches.length === 1) {
                  const doc = await vscode.workspace.openTextDocument(matches[0]);
                  await vscode.window.showTextDocument(doc, { preview: true });
                } else if (matches.length > 1) {
                  const picked = await vscode.window.showQuickPick(
                    matches.map((m) => ({ label: vscode.workspace.asRelativePath(m), uri: m })),
                    { placeHolder: `Multiple matches for ${name}` },
                  );
                  if (picked) {
                    const doc = await vscode.workspace.openTextDocument(picked.uri);
                    await vscode.window.showTextDocument(doc, { preview: true });
                  }
                } else {
                  void vscode.window.showWarningMessage(`Could not open file: ${name}`);
                }
              }
              break;
            }

            vscode.commands.executeCommand('dreamgraph.navigateEntity', uri).then(
              undefined,
              async () => {
                const query = scheme === 'data-model'
                  ? `Search data model for ${name}`
                  : `Explain ${uri} in system context`;
                await this.handleUserMessage(query);
              },
            );
          }
          break;
        }
        case 'verifyEntities': {
          const { requestId, names } = message as { type: 'verifyEntities'; requestId: string; names: string[] };
          const results = await this._verifyEntities(names);
          await this.postMessage({ type: 'entityStatus', requestId, results });
          break;
        }
        case 'runMessageAction': {
          await this._runMessageAction(message.messageId, message.actionId);
          break;
        }
        case 'retryMessage': {
          const original = this.messages.find((m) => m.id === message.messageId && m.role === 'user');
          if (original) await this.handleUserMessage(original.content);
          break;
        }
        case 'copyMessage': {
          await this._copyMessage(message.messageId);
          break;
        }
        case 'pinMessage': {
          await this._pinMessage(message.messageId);
          break;
        }
        case 'selectRecommendedAction': {
          const actionMsg = message as { type: 'selectRecommendedAction'; actionId: string; label?: string; labels?: string[] };
          await this._executeRecommendedAction(actionMsg.actionId, actionMsg.label);
          break;
        }
        case 'doAllRecommendedActions': {
          const actionMsg = message as { type: 'doAllRecommendedActions'; labels?: string[] };
          await this._executeAllRecommendedActions(actionMsg.labels);
          break;
        }
        case 'envelopeAction': {
          const envMsg = message as { type: 'envelopeAction'; label: string };
          if (envMsg.label) await this.handleUserMessage(envMsg.label);
          break;
        }
        case 'envelopeDoAll': {
          const envAllMsg = message as { type: 'envelopeDoAll'; labels: string[] };
          const labels = Array.isArray(envAllMsg.labels) ? envAllMsg.labels : [];
          if (labels.length === 1) {
            await this.handleUserMessage(labels[0]);
          } else if (labels.length > 1) {
            const combined = `Execute these steps sequentially:\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
            await this.handleUserMessage(combined);
          }
          break;
        }
        case 'setAutonomyMode': {
          const modeMsg = message as { type: 'setAutonomyMode'; mode: string };
          this._setAutonomyMode(modeMsg.mode);
          break;
        }
        case 'resetAutonomy': {
          this._resetAutonomy();
          break;
        }
      }
    }, null, this.disposables);

    await this.rehydrateWebview();
  }

  public async clearMessages(): Promise<void> {
    this.messages.splice(0, this.messages.length);
    await this.persistMessages();
    await this.postState();
  }

  public dispose(): void {
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }

  async handleUserMessage(text: string): Promise<void> {
  if (this.streaming) {
    this.steeringQueue.push(text);
    return;
  }

  const trimmed = text.trim();
  if (!trimmed && this.attachments.length === 0) return;

  const provider = this.architectLlm?.provider ?? 'anthropic';
  const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(trimmed, 'chat') : null;
  const liveAnchor = envelope?.activeFile?.selection?.anchor ?? envelope?.activeFile?.cursorAnchor;
  const userMessage: ChatMessage = {
    id: this._createMessageId(),
    role: 'user',
    content: trimmed,
    fullContent: trimmed,
    timestamp: new Date().toISOString(),
    instanceId: this.currentInstanceId,
    anchor: liveAnchor,
  };
  this.messages.push(userMessage);
  if (this.contextBuilder) {
    await this._persistMessagesWithCanonicalAnchorRefresh(envelope);
  } else {
    await this.persistMessages();
  }

  this._lastToolTrace = [];
  this._lastVerdict = null;
  await this.postState();
  await this.postMessage({ type: 'toolTrace', calls: [] });
  this._autonomyEnabled = getAutonomyMode() !== 'cautious' || (getAutonomyPassBudget() ?? 0) > 0;
  this._autonomyState = createAutonomyState(getAutonomyMode(), getAutonomyPassBudget());
  this._lastRecommendedActions = [];
  this._autonomyContinuing = false;
  // Capture task continuation context before clearing it — it will be injected
  // into this turn's system prompt so "resume" re-enters from the known task position.
  const stopContextForThisTurn = this._lastStopContext;
  this._lastStopContext = null;
  this._broadcastAutonomyStatus();

  const autonomyRequest = parseAutonomyRequest(trimmed, this._autonomyState);
  if (
    autonomyRequest.mode !== this._autonomyState.mode ||
    autonomyRequest.totalAuthorizedPasses !== this._autonomyState.totalAuthorizedPasses
  ) {
    this._autonomyEnabled = true;
    this._autonomyState = {
      mode: autonomyRequest.mode,
      remainingAutoPasses: autonomyRequest.remainingAutoPasses,
      completedAutoPasses: autonomyRequest.completedAutoPasses,
      totalAuthorizedPasses: autonomyRequest.totalAuthorizedPasses,
    };
    this._broadcastAutonomyStatus();
  }

  if (!this.architectLlm || !this.contextBuilder || !envelope) {
    const missing = !this.architectLlm ? 'Architect LLM' : !this.contextBuilder ? 'ContextBuilder' : 'Context envelope';
    const assistantMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'assistant',
      content: `${missing} is not configured.`,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
      verdict: { level: 'speculative', summary: `${missing} unavailable` },
    };
    this.messages.push(assistantMessage);
    await this.persistMessages();
    await this.postState();
    return;
  }

  const task = inferTask(envelope.intentMode ?? 'ask_dreamgraph', undefined, trimmed);
  const contextResult = await this._buildPromptContext(task, envelope, trimmed, 'chat');

  await this._logContextToOutput(envelope, contextResult.reasoningPacket);

  const attachmentInstruction = this._attachmentSummaryForUserMessage();
  // If a previous autonomy loop stopped with task state, inject it as a
  // continuation context block so the model knows where to resume from.
  const continuationContext = stopContextForThisTurn
    ? this._formatStopContextBlock(stopContextForThisTurn)
    : '';
  const additionalInstructions = [attachmentInstruction, continuationContext].filter(Boolean).join('\n\n');
  const autonomyInstructionState = this._autonomyEnabled
    ? { ...this._autonomyState, enabled: true }
    : undefined;
  const prompt = assemblePrompt(
    task,
    envelope,
    contextResult.assembledContext,
    additionalInstructions || undefined,
    autonomyInstructionState,
    provider,
  );

  const conversation: ArchitectMessage[] = [
    { role: 'system', content: prompt.system },
    // Cap conversation history at the most recent 20 user/assistant turns AND
    // truncate per-message content (most-recent 2 keep up to 16KB, older capped at 4KB).
    // Without these caps a single prompt can pull in 200-600KB of prior assistant
    // envelopes + tool-trace text and tip the request into long-context pricing.
    ...buildBoundedConversationMessages(this.messages, 20)
      .map((message) => ({ role: message.role, content: message.content }) as ArchitectMessage),
  ];

  this.streaming = true;
  this.streamingContent = '';
  this.abortController = new AbortController();

  try {
    await this.postMessage({ type: 'stream-start' });

    let fullContent = '';
    const mcpTools = await this._listMcpToolsLazy();
    const allTools: ToolDefinition[] = [
      ...mcpTools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
      })),
      ...LOCAL_TOOL_DEFINITIONS.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema as Record<string, unknown>,
      })),
    ];

    // Tool whitelisting: send only an intent-appropriate subset (typically 6-14 tools)
    // instead of all 70+. The full schemas are ~82KB / ~20k tokens — sent on every
    // pass of the agentic loop. This is the dominant input-cost driver.
    const toolDecision = selectToolGroups({
      task,
      intentMode: envelope?.intentMode,
      prompt: trimmed,
      autonomy: this._autonomyEnabled,
      availableToolNames: allTools.map((t) => t.name),
    });
    const selectedSet = new Set(toolDecision.selected);
    const tools: ToolDefinition[] = allTools.filter((t) => selectedSet.has(t.name));
    this.contextInspector?.appendContextLine(
      `Tool selection: ${tools.length}/${allTools.length} tools — groups=[${toolDecision.groups.join(', ')}] mutating=${toolDecision.mutating} autonomy=${toolDecision.autonomy}; ${toolDecision.rationale}`,
    );

    if (tools.length > 0) {
      fullContent = await this.runAgenticLoop(conversation, tools);
    } else {
      const req = this._createRequestSignal(this._getLlmTimeoutMs({ mode: 'stream' }));
      try {
        await this.architectLlm.stream(conversation, (chunk: string) => {
          const safeChunk = this._redactSecrets(chunk);
          fullContent += safeChunk;
          this.streamingContent += safeChunk;
          void this.postMessage({ type: 'stream-chunk', chunk: safeChunk });
        }, req.signal);
      } finally {
        req.dispose();
      }
    }

    const cleaned = fullContent.trim() || '(No response)';
    const assistantMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'assistant',
      content: cleaned,
      fullContent: cleaned,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
      verdict: this._lastVerdict ?? undefined,
      toolTrace: this._lastToolTrace.length > 0 ? [...this._lastToolTrace] : undefined,
    };
    this.messages.push(assistantMessage);
    if (this.contextBuilder) {
      await this._persistMessagesWithCanonicalAnchorRefresh(envelope);
    } else {
      await this.persistMessages();
    }
    await this.postState();
    if (this._lastVerdict) {
      await this.postMessage({ type: 'verdict', verdict: this._lastVerdict });
    }
    await this.postMessage({ type: 'toolTrace', calls: this._lastToolTrace });
    if (this._autonomyEnabled && assistantMessage.id) {
      // Pass cleaned (with envelope intact) so the parser can extract goal_status etc.
      await this._handleAutonomyPassComplete(
        cleaned,
        assistantMessage.id,
        conversation,
        tools,
      );
    }
  } catch (err) {
    const recovered = await this._recoverFromLlmTimeout(err, trimmed, envelope);
    if (!recovered) {
      const message = err instanceof Error ? err.message : String(err);
      const assistantMessage: ChatMessage = {
        id: this._createMessageId(),
        role: 'assistant',
        content: `Error: ${message}`,
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
        verdict: { level: 'speculative', summary: 'Request failed before completion' },
        toolTrace: this._lastToolTrace.length > 0 ? [...this._lastToolTrace] : undefined,
      };
      this.messages.push(assistantMessage);
      await this.persistMessages();
      await this.postState();
      await this.postMessage({ type: 'error', error: message });
    }
  } finally {
    this.resetStreamState();
  }
}

  private async _buildPromptContext(
  task: ReturnType<typeof inferTask>,
  envelope: import('./types.js').EditorContextEnvelope,
  promptText?: string,
  commandSource?: string,
): Promise<{ assembledContext: string; reasoningPacket: import('./types.js').ReasoningPacket | null }> {
  if (!this.contextBuilder) {
    return { assembledContext: '', reasoningPacket: null };
  }

  if (task === 'patch') {
    const reasoningPacket = await this.contextBuilder.buildReasoningPacket(envelope, {
      prompt: promptText,
      commandSource,
    });
    return {
      assembledContext: this.contextBuilder.renderReasoningPacket(reasoningPacket).text,
      reasoningPacket,
    };
  }

  const assembled = await this.contextBuilder.assembleContextBlock(
    envelope,
    promptText ?? null,
    new Map(),
  );
  return {
    assembledContext: assembled.text,
    reasoningPacket: null,
  };
}

  private _buildUserContentBlocks(text: string): ArchitectContentBlock[] {
    const capabilities = this.architectLlm?.getModelCapabilities() ?? { textAttachments: false, imageAttachments: false };
    const blocks: ArchitectContentBlock[] = [{ type: 'text', text }];

    for (const attachment of this.attachments) {
      if (attachment.kind === 'text' && capabilities.textAttachments && attachment.textContent) {
        blocks.push({
          type: 'text',
          text: `Attached file: ${attachment.name}\nPath: ${attachment.path}\n\n${attachment.textContent}`,
        });
      } else if (attachment.kind === 'image' && capabilities.imageAttachments && attachment.dataBase64) {
        blocks.push({
          type: 'image',
          mimeType: attachment.mimeType,
          dataBase64: attachment.dataBase64,
          fileName: attachment.name,
        });
      } else if (attachment.kind === 'image') {
        blocks.push({ type: 'text', text: `[Image attachment omitted: current model does not support image input] ${attachment.name}` });
      }
    }

    return blocks;
  }

  private _attachmentSummaryForUserMessage(): string {
    if (this.attachments.length === 0) return '';
    const lines = this.attachments.map((a) => `- ${a.name} (${a.kind}${a.note ? `, ${a.note}` : ''})`);
    return `Attachments:\n${lines.join('\n')}`;
  }

  private async _pickAttachments(): Promise<void> {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Attach to Architect prompt',
      filters: {
        'Supported files': ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'py', 'cs', 'java', 'go', 'rs', 'yml', 'yaml', 'xml', 'html', 'css', 'scss', 'sql', 'sh', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
      },
    });
    if (!picks || picks.length === 0) return;

    const capabilities = this.architectLlm?.getModelCapabilities() ?? { textAttachments: false, imageAttachments: false };
    const next: PromptAttachment[] = [];
    const errors: string[] = [];

    for (const uri of picks) {
      try {
        const ext = path.extname(uri.fsPath).toLowerCase();
        const stat = await vscode.workspace.fs.stat(uri);
        const name = path.basename(uri.fsPath);
        const imageMime = ChatPanel.IMAGE_MIME_BY_EXT[ext];

        if (imageMime) {
          if (!capabilities.imageAttachments) {
            errors.push(`${name}: current model does not support image attachments.`);
            continue;
          }
          if (stat.size > ChatPanel.MAX_IMAGE_ATTACHMENT_BYTES) {
            errors.push(`${name}: image exceeds 5 MB limit.`);
            continue;
          }
          const bytes = await vscode.workspace.fs.readFile(uri);
          next.push({
            id: `${Date.now()}-${Math.random()}`,
            name,
            path: uri.fsPath,
            mimeType: imageMime,
            kind: 'image',
            size: stat.size,
            dataBase64: Buffer.from(bytes).toString('base64'),
          });
          continue;
        }

        if (ChatPanel.TEXT_EXTENSIONS.has(ext)) {
          if (!capabilities.textAttachments) {
            errors.push(`${name}: current model does not support text attachments.`);
            continue;
          }
          const bytes = await vscode.workspace.fs.readFile(uri);
          let textContent = Buffer.from(bytes).toString('utf8');
          let note: string | undefined;
          if (Buffer.byteLength(textContent, 'utf8') > ChatPanel.MAX_TEXT_ATTACHMENT_BYTES) {
            textContent = textContent.slice(0, ChatPanel.MAX_TEXT_ATTACHMENT_BYTES);
            note = 'truncated to 100 KB';
          }
          next.push({
            id: `${Date.now()}-${Math.random()}`,
            name,
            path: uri.fsPath,
            mimeType: 'text/plain',
            kind: 'text',
            size: stat.size,
            textContent,
            note,
          });
          continue;
        }

        errors.push(`${name}: unsupported file type.`);
      } catch (error) {
        errors.push(`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (next.length > 0) {
      this.attachments = [...this.attachments, ...next];
      await this._syncAttachments();
    }
    if (errors.length > 0) {
      void this.postMessage({ type: 'error', error: errors.join(' ') });
    }
  }

  private async _syncAttachments(): Promise<void> {
    await this.postMessage({
      type: 'setAttachments',
      attachments: this.attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, mimeType: a.mimeType, size: a.size, note: a.note })),
    });
  }

  private async _handlePastedImage(dataBase64: string, mimeType: string): Promise<void> {
    const capabilities = this.architectLlm?.getModelCapabilities() ?? { textAttachments: false, imageAttachments: false };
    if (!capabilities.imageAttachments) {
      void this.postMessage({ type: 'error', error: 'Current model does not support image attachments.' });
      return;
    }
    const rawSize = Math.ceil((dataBase64.length * 3) / 4);
    if (rawSize > ChatPanel.MAX_IMAGE_ATTACHMENT_BYTES) {
      void this.postMessage({ type: 'error', error: 'Pasted image exceeds 5 MB limit.' });
      return;
    }
    const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png';
    const name = `clipboard-${Date.now()}${ext}`;
    this.attachments.push({
      id: `${Date.now()}-${Math.random()}`,
      name,
      path: '',
      mimeType,
      kind: 'image',
      size: rawSize,
      dataBase64,
    });
    await this._syncAttachments();
  }

  private abortGeneration(): void { this.abortController?.abort(); }

  /**
   * Create a child AbortSignal that fires on EITHER user abort OR timeout.
   * Returns a dispose function that MUST be called when the request completes
   * to prevent timer leaks.
   */
  private _createRequestSignal(timeoutMs = ChatPanel.REQUEST_TIMEOUT_MS): { signal: AbortSignal; dispose: () => void } {
    return createTimeoutAbortSignal(this.abortController, timeoutMs);
  }

  private _getLlmTimeoutMs(options: { mode: 'stream' | 'tool'; toolCount?: number; reducedContext?: boolean }): number {
    return _getLlmTimeoutMsPure({ ...options, provider: this.architectLlm?.provider ?? 'anthropic' });
  }

  private _isTimeoutError(err: unknown): boolean {
    return _isTimeoutErrorPure(err);
  }

  private _buildTimeoutRecoveryPrompt(originalText: string): string {
    return _buildTimeoutRecoveryPromptPure(originalText);
  }

  private async _recoverFromLlmTimeout(
    err: unknown,
    originalText: string,
    envelope: import('./types.js').EditorContextEnvelope | null,
  ): Promise<boolean> {
    if (!this._isTimeoutError(err) || !this.architectLlm) return false;

    const provider = this.architectLlm.provider ?? 'unknown';
    const model = this.architectLlm.currentConfig?.model;
    const recoveryTimeoutMs = this._getLlmTimeoutMs({ mode: 'stream', reducedContext: true });
    const notice = `\n⚠️ LLM request timed out for provider \`${provider}\`. Retrying once with reduced context and a faster recovery strategy…\n`;
    this.streamingContent += notice;
    await this.postMessage({ type: 'stream-chunk', chunk: notice });

    const recoveryPrompt = this._buildTimeoutRecoveryPrompt(originalText);
    const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
    const autonomyInstruction: AutonomyInstructionState | undefined = this._autonomyEnabled
      ? { ...this._autonomyState, enabled: true }
      : undefined;
    const { system } = assemblePrompt(task, envelope, undefined, undefined, autonomyInstruction, provider);
    const recoveryMessages: ArchitectMessage[] = [{ role: 'system', content: system }];
    for (const msg of this.messages.slice(-8)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        recoveryMessages.push({ role: msg.role, content: msg.content });
      }
    }
    recoveryMessages.push({ role: 'user', content: recoveryPrompt });

    let fullContent = '';
    const req = this._createRequestSignal(recoveryTimeoutMs);
    try {
      await this.architectLlm.stream(recoveryMessages, (chunk: string) => {
        const safeChunk = this._redactSecrets(chunk);
        fullContent += safeChunk;
        this.streamingContent += safeChunk;
        void this.postMessage({ type: 'stream-chunk', chunk: safeChunk });
      }, req.signal);
    } catch (recoveryErr) {
      this._logTimeoutDiagnostics({
        provider,
        model,
        mode: 'stream',
        timeoutMs: recoveryTimeoutMs,
        recoveryAttempted: true,
        recovered: false,
        toolCount: 0,
        usedReducedContext: true,
        errorMessage: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
      });
      return false;
    } finally {
      req.dispose();
    }

    this._logTimeoutDiagnostics({
      provider,
      model,
      mode: 'stream',
      timeoutMs: recoveryTimeoutMs,
      recoveryAttempted: true,
      recovered: true,
      toolCount: 0,
      usedReducedContext: true,
      errorMessage: err instanceof Error ? err.message : String(err),
    });

    const redactedFullContent = this._redactSecrets(fullContent);
    const finalContent = this._applyRenderLimits(redactedFullContent);
    const implicitEntities = this._detectImplicitEntities(redactedFullContent);
    const implicitEntityNotice = implicitEntities.names.length > 0
      ? this._formatImplicitEntityNotice(implicitEntities)
      : undefined;

    const recoveredMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'assistant',
      content: finalContent.content,
      fullContent: redactedFullContent,
      implicitEntityNotice,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
      verdict: this._deriveVerdict(redactedFullContent, this._lastToolTrace) ?? undefined,
      toolTrace: this._lastToolTrace.length > 0 ? [...this._lastToolTrace] : undefined,
    };
    this.messages.push(recoveredMessage);
    await this.persistMessages();
    await this.postMessage({
      type: 'addMessage',
      message: recoveredMessage,
      actions: this._buildMessageActions(recoveredMessage),
      roleMeta: this._roleMetaFor(recoveredMessage),
      contextFooter: this._contextFooterFor(recoveredMessage),
    });
    return true;
  }

  /**
   * Reset ALL streaming-related state in one place.
   * Sends cleanup messages to the webview so the UI never stays stuck.
   */
  private resetStreamState(): void {
    this.streaming = false;
    this.streamingContent = '';
    this.steeringQueue = [];
    this.abortController = null;
    void this.postMessage({ type: 'stream-thinking', active: false });
    if (this._lastVerdict) {
      void this.postMessage({ type: 'verdict', verdict: this._lastVerdict });
    }
    void this.postMessage({ type: 'toolTrace', calls: this._lastToolTrace });
    void this.postMessage({ type: 'stream-end', done: true });
  }

  private async rehydrateWebview(): Promise<void> {
    await this.postState();
    if (this.draftText) await this.postMessage({ type: 'restoreDraft', text: this.draftText });
    await this._syncAttachments();
    if (this._autonomyEnabled) this._broadcastAutonomyStatus();
  }

  private async postState(): Promise<void> {
    await this.postMessage({ type: 'state', state: { messages: this.messages } });
  }

  public getActionLogForTest(): ActionExecutionRecord[] {
    return this._actionLog;
  }

  private _createMessageId(): string {
    return helpers.createMessageId();
  }

  private async _logContextToOutput(
  envelope: import('./types.js').EditorContextEnvelope | null,
  packet: import('./types.js').ReasoningPacket | null,
): Promise<void> {
  if (!envelope || !this.contextInspector) return;
  try {
    this.contextInspector.logContextRequestBoundary({
      instanceId: envelope.instanceId ?? undefined,
      intentMode: envelope.intentMode,
    });
    this.contextInspector.logEnvelope(envelope);
    if (packet) {
      this.contextInspector.logReasoningPacket(packet);
    }
  } catch {
    // Best-effort transparency logging only.
  }
}

  private _logTimeoutDiagnostics(event: {
    provider: string;
    model?: string;
    mode: 'stream' | 'tool';
    timeoutMs: number;
    recoveryAttempted: boolean;
    recovered: boolean;
    toolCount?: number;
    usedReducedContext?: boolean;
    errorMessage: string;
  }): void {
    try {
      this.contextInspector?.logTimeoutDiagnostics(event);
    } catch {
      // Best-effort diagnostics logging only.
    }
  }

    private _roleMetaFor(message: ChatMessage): { title: string; subtitle?: string } {
    if (message.role === 'assistant') {
      return { title: 'DreamGraph Architect', subtitle: 'Graph-grounded assistant' };
    }
    if (message.role === 'user') {
      return { title: 'You' };
    }
    return { title: 'System' };
  }

    private _formatAnchorFooterStatus(anchor: import('./types.js').SemanticAnchor): string {
      return helpers.formatAnchorFooterStatus(anchor);
    }

    private _contextFooterFor(message: ChatMessage): string {
    const scope = message.instanceId ?? this.currentInstanceId;
    const anchor = message.anchor;

    const anchorStatus = anchor ? this._formatAnchorFooterStatus(anchor) : undefined;

    if (message.role === 'assistant') {
      return `Instance: ${scope} • Actions require explicit click • Trace reflects real tool execution • Context packet logged to DreamGraph Context`;
    }
    if (message.role === 'user') {
      return anchorStatus ? `Instance: ${scope} • ${anchorStatus}` : `Instance: ${scope}`;
    }
    return `Instance: ${scope} • System message`;
  }

  private _applyRenderLimits(content: string): { content: string; truncated: boolean } {
    return helpers.applyRenderLimits(content, ChatPanel.MAX_RENDERED_MESSAGE_CHARS);
  }

  private _buildMessageActions(message: ChatMessage): MessageAction[] {
    const actions: MessageAction[] = [];
    if (message.role === 'assistant') {
      if (message.content.includes('[Response truncated]')) {
        actions.push({ id: 'show-full', label: 'Show full', kind: 'primary', actionType: 'show_full' });
      }
      if (this._lastToolTrace.length > 0) {
        actions.push({
          id: 'show-trace',
          label: 'Show tool trace',
          kind: 'secondary',
          actionType: 'tool',
          toolName: 'query_self_metrics',
          toolArgs: { flush_to_disk: false },
        });
      }
    }
    return actions;
  }

  private _detectImplicitEntities(content: string): ImplicitEntityDetectionResult {
    return helpers.detectImplicitEntities(content, ChatPanel.MAX_ENTITY_LINKS_PER_MESSAGE);
  }

  private _formatImplicitEntityNotice(result: ImplicitEntityDetectionResult): string {
    return helpers.formatImplicitEntityNotice(result);
  }

  private async _copyMessage(messageId: string): Promise<void> {
    const message = this.messages.find((entry) => entry.id === messageId);
    if (!message) {
      return;
    }
    await vscode.env.clipboard.writeText(message.fullContent ?? message.content);
    this._hoverActionStateByMessage.set(messageId, {
      ...(this._hoverActionStateByMessage.get(messageId) ?? {}),
      copied: true,
    });
  }

  private async _pinMessage(messageId: string): Promise<void> {
    const message = this.messages.find((entry) => entry.id === messageId);
    if (!message) {
      return;
    }
    message.pinned = !message.pinned;
    this._hoverActionStateByMessage.set(messageId, {
      ...(this._hoverActionStateByMessage.get(messageId) ?? {}),
      pinned: Boolean(message.pinned),
    });
    await this.persistMessages();
    await this.postState();
  }

  private async _runMessageAction(messageId: string, actionId: string): Promise<void> {
    const message = this.messages.find((m) => m.id === messageId);
    const action = message ? this._buildMessageActions(message).find((a) => a.id === actionId) : undefined;
    if (!message || !action || !ChatPanel.ACTION_ALLOWLIST.has(action.actionType)) {
      void vscode.window.showErrorMessage('Action unavailable.');
      this._actionLog.push({ timestamp: new Date().toISOString(), actionType: actionId, sourceMessageId: messageId, outcome: 'failed', detail: 'unavailable' });
      return;
    }

    await this.postMessage({ type: 'messageActionState', messageId, actionId, status: 'loading' });

    if (action.destructive) {
      const choice = await vscode.window.showWarningMessage(
        `Run destructive action "${action.label}"?`,
        { modal: true },
        'Run',
      );
      if (choice !== 'Run') {
        this._actionLog.push({ timestamp: new Date().toISOString(), actionType: action.actionType, sourceMessageId: messageId, outcome: 'cancelled', detail: action.id });
        await this.postMessage({ type: 'messageActionState', messageId, actionId, status: 'failed', error: 'Cancelled' });
        return;
      }
    }

    try {
      if (action.actionType === 'show_full') {
        if (!message.fullContent || message.fullContent === message.content) {
          throw new Error('Full response is not available for this message.');
        }
        message.content = message.fullContent;
        const implicitEntities = this._detectImplicitEntities(message.fullContent);
        message.implicitEntityNotice = implicitEntities.names.length > 0
          ? this._formatImplicitEntityNotice(implicitEntities)
          : undefined;
        await this.persistMessages();
        await this.postState();
        this._actionLog.push({ timestamp: new Date().toISOString(), actionType: action.actionType, sourceMessageId: messageId, outcome: 'completed', detail: action.id });
        await this.postMessage({ type: 'messageActionState', messageId, actionId, status: 'completed' });
        return;
      }

      if (action.actionType === 'tool') {
        if (!action.toolName) {
          throw new Error('Tool action is missing a tool name.');
        }
        const result = await this._executeMessageActionTool(action.toolName, action.toolArgs ?? {});
        const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        const toolMessage: ChatMessage = {
          id: this._createMessageId(),
          role: 'system',
          content: `Action result (${action.label})\n\n${this._redactSecrets(resultText)}`,
          timestamp: new Date().toISOString(),
          instanceId: this.currentInstanceId,
        };
        this.messages.push(toolMessage);
        await this.persistMessages();
        await this.postMessage({ type: 'addMessage', message: toolMessage, actions: this._buildMessageActions(toolMessage), roleMeta: this._roleMetaFor(toolMessage), contextFooter: this._contextFooterFor(toolMessage) });
        this._actionLog.push({ timestamp: new Date().toISOString(), actionType: action.actionType, sourceMessageId: messageId, outcome: 'completed', detail: action.toolName });
        await this.postMessage({ type: 'messageActionState', messageId, actionId, status: 'completed' });
        return;
      }

      throw new Error('Unsupported action type.');
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this._actionLog.push({ timestamp: new Date().toISOString(), actionType: action.actionType, sourceMessageId: messageId, outcome: 'failed', detail: messageText });
      await this.postMessage({ type: 'messageActionState', messageId, actionId, status: 'failed', error: messageText });
      void vscode.window.showErrorMessage(messageText);
    }
  }

  /**
   * Post a message to the webview. If the webview is currently hidden or
   * disposed, critical messages are buffered and replayed on the next
   * rehydrateWebview() call to prevent silent loss of stream-end/error events.
   */
  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    if (this.view?.webview) {
      // Flush any buffered messages first so order is preserved
      if (this._pendingMessages.length > 0) {
        const pending = this._pendingMessages.splice(0);
        for (const m of pending) {
          try { await this.view.webview.postMessage(m); } catch { /* view may have gone */ }
        }
      }
      await this.view.webview.postMessage(message);
    } else {
      // Buffer stream-end and error messages so they are not silently lost
      // when the webview is hidden (e.g. user switched panel). Streaming
      // chunks are intentionally dropped — they would be stale on reconnect.
      const type = (message as { type: string }).type;
      if (type === 'stream-end' || type === 'stream-thinking' || type === 'error' || type === 'addMessage') {
        this._pendingMessages.push(message);
      }
    }
  }

  private async persistMessages(): Promise<void> {
    if (!this.memory) return;
    await this.memory.save(this.currentInstanceId, this.messages as PersistedMessage[]);
  }

  private async _persistMessagesWithCanonicalAnchorRefresh(
    envelope: import('./types.js').EditorContextEnvelope | null,
  ): Promise<void> {
    if (!this.memory) return;

    const canonicalAnchor = envelope?.activeFile?.selection?.anchor ?? envelope?.activeFile?.cursorAnchor;
    if (canonicalAnchor?.canonicalId) {
      for (let index = this.messages.length - 1; index >= 0; index -= 1) {
        const message = this.messages[index];
        if (message.role !== 'user' || !message.anchor) continue;
        if (message.instanceId && message.instanceId !== this.currentInstanceId) continue;
        if (message.anchor.canonicalId) break;
        if (message.anchor.path !== canonicalAnchor.path) continue;
        this.messages[index] = {
          ...message,
          anchor: {
            ...message.anchor,
            canonicalId: canonicalAnchor.canonicalId,
            canonicalKind: canonicalAnchor.canonicalKind,
            migrationStatus: canonicalAnchor.migrationStatus ?? message.anchor.migrationStatus ?? 'promoted',
            confidence: Math.max(message.anchor.confidence ?? 0, canonicalAnchor.confidence ?? 0),
            label: canonicalAnchor.label,
          },
        };
        break;
      }
    }

    await this.persistMessages();
  }

  private async restoreMessages(): Promise<void> {
    if (!this.memory) return;
    const saved = await this.memory.load(this.currentInstanceId);
    let scoped = (saved as ChatMessage[]).filter((message) => !message.instanceId || message.instanceId === this.currentInstanceId);

    if (this.contextBuilder && !this._restoringAnchors) {
      this._restoringAnchors = true;
      try {
        const graphContext = await this.contextBuilder.resolveGraphContext(
          {
            workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
            instanceId: this.currentInstanceId,
            activeFile: null,
            visibleFiles: [],
            changedFiles: [],
            pinnedFiles: [],
            environmentContext: null,
            graphContext: null,
            intentMode: 'manual',
            intentConfidence: 0,
          },
          {
            intentMode: 'manual',
            taskSummary: 'Rehydrate stored chat anchors',
            primaryAnchor: undefined,
            secondaryAnchors: [],
            requiredEvidence: [],
            optionalEvidence: ['feature', 'workflow', 'adr', 'ui'],
            codeReadPlan: [],
            budgetPolicy: {
              maxTokens: 0,
              reserveTokens: 0,
              allowFullActiveFile: false,
              includeOptionalEvidence: true,
            },
          },
        );
        scoped = await this.contextBuilder.rehydrateStoredAnchors(scoped, graphContext);
      } catch {
        // Rehydration is best-effort; keep stored anchors unchanged on failure
      } finally {
        this._restoringAnchors = false;
      }
    }

    this.messages.splice(0, this.messages.length, ...scoped.map((message) => ({ ...message, instanceId: message.instanceId ?? this.currentInstanceId })));
    this._hoverActionStateByMessage.clear();
    await this.postState();
  }

  private _sendModelUpdate(): void {
    const provider = this.architectLlm?.currentConfig?.provider ?? '';
    const model = this.architectLlm?.currentConfig?.model ?? '';
    const models = provider === 'anthropic' ? ANTHROPIC_MODELS
      : provider === 'openai' ? OPENAI_MODELS
      : [];
    const capabilities = this.architectLlm?.getModelCapabilities(provider as ArchitectProvider, model) ?? { textAttachments: false, imageAttachments: false };
    void this.postMessage({
      type: 'updateModels',
      providers: ['anthropic', 'openai', 'ollama'],
      models,
      current: { provider, model },
      capabilities,
    });
  }

  private _checkApiKeyWarning(): void {
    // noop preserved behavior if implemented elsewhere
  }

  private async _changeProvider(provider: ArchitectProvider): Promise<void> {
    // Update in-memory config immediately so _sendModelUpdate reads the new value.
    if (this.architectLlm) {
      const models = provider === 'anthropic' ? ANTHROPIC_MODELS
        : provider === 'openai' ? OPENAI_MODELS
        : [];
      const defaultModel = models[0] ?? '';
      const apiKey = (provider !== 'ollama')
        ? (await this.architectLlm.getApiKey(provider) ?? '')
        : '';
      this.architectLlm.applyConfig({
        provider,
        model: defaultModel,
        baseUrl: '',
        apiKey,
      });
    }
    this._sendModelUpdate();
    await this._syncAttachments();
    // Persist to settings in background (do NOT call loadConfig — it would race)
    const cfg = vscode.workspace.getConfiguration('dreamgraph.architect');
    const defaultModel = this.architectLlm?.currentConfig?.model ?? '';
    void cfg.update('provider', provider, vscode.ConfigurationTarget.Global);
    if (defaultModel) void cfg.update('model', defaultModel, vscode.ConfigurationTarget.Global);
  }

  private async _changeModel(model: string): Promise<void> {
    // Update in-memory config immediately so _sendModelUpdate reads the new value.
    if (this.architectLlm) {
      const prev = this.architectLlm.currentConfig;
      this.architectLlm.applyConfig({
        provider: prev?.provider ?? '' as ArchitectProvider,
        model,
        baseUrl: prev?.baseUrl ?? '',
        apiKey: prev?.apiKey ?? '',
      });
    }
    this._sendModelUpdate();
    await this._syncAttachments();
    // Persist to settings in background (do NOT call loadConfig — it would race)
    void vscode.workspace.getConfiguration('dreamgraph.architect').update('model', model, vscode.ConfigurationTarget.Global);
  }

  private static readonly MAX_TOOL_ITERATIONS = 32;
  private static readonly MAX_RETRIES = 3;
  private static readonly MAX_VERIFICATION_BATCH_SIZE = 50;
  private static readonly VERIFICATION_TIMEOUT_MS = 5_000;
  /** Maximum number of autonomous continuation passes to prevent runaway loops. */
  private static readonly MAX_AUTONOMY_PASSES = 20;

  /* ------------------------------------------------------------------ */
  /*  Autonomy — session state & continuation loop                      */
  /* ------------------------------------------------------------------ */

  /** Re-read autonomy settings from VS Code configuration and apply. */
  private _syncAutonomyFromSettings(): void {
    const mode = getAutonomyMode();
    const budget = getAutonomyPassBudget();
    this._autonomyState = createAutonomyState(mode, budget);
    this._autonomyEnabled = mode !== 'cautious' || (budget ?? 0) > 0;
    if (this._autonomyEnabled) this._broadcastAutonomyStatus();
  }

  /** Called from extension.ts when configuration changes. */
  public applyAutonomySettings(): void {
    this._syncAutonomyFromSettings();
  }

  private _detectAutonomyRequest(text: string): void {
    const lower = text.toLowerCase();
    const hasAutonomyKeyword = /\b(autonomous|eager|conscientious|cautious)\b/.test(lower)
      || /next\s+\d+\s+passes|for\s+\d+\s+passes/.test(lower)
      || /\bautonomous(ly)?\b/.test(lower)
      || /\bstay\s+cautious\b/.test(lower);

    if (!hasAutonomyKeyword) return;

    const parsed = parseAutonomyRequest(text, this._autonomyState);
    this._autonomyState = {
      mode: parsed.mode,
      remainingAutoPasses: parsed.remainingAutoPasses,
      completedAutoPasses: parsed.completedAutoPasses,
      totalAuthorizedPasses: parsed.totalAuthorizedPasses,
    };
    this._autonomyEnabled = true;
    this._broadcastAutonomyStatus();
  }

  private _setAutonomyMode(mode: string): void {
    const valid = ['cautious', 'conscientious', 'eager', 'autonomous'] as const;
    const m = valid.find((v) => v === mode);
    if (!m) return;
    this._autonomyState = { ...this._autonomyState, mode: m };
    this._autonomyEnabled = true;
    this._broadcastAutonomyStatus();
  }

  private _resetAutonomy(): void {
    this._autonomyState = createAutonomyState('cautious');
    this._autonomyEnabled = false;
    this._autonomyContinuing = false;
    this._lastRecommendedActions = [];
    this._broadcastAutonomyStatus();
  }

  private _broadcastAutonomyStatus(): void {
    const status = deriveAutonomyStatusView(this._autonomyState);
    void this.postMessage({
      type: 'autonomyStatus',
      status: {
        mode: status.mode,
        countingActive: status.countingActive,
        completed: status.completed,
        remaining: status.remaining,
        totalAuthorized: status.totalAuthorized,
        summary: status.summary,
      },
    });
  }

  private async _handleAutonomyPassComplete(
    content: string,
    messageId: string,
    llmMessages: ArchitectMessage[],
    tools: ToolDefinition[],
  ): Promise<void> {
    // Extract structured envelope and build recommended actions
    const envelope = extractStructuredPassEnvelope(content);
    const actions: RecommendedAction[] = envelope.nextSteps;
    this._lastRecommendedActions = actions;

    // Run pass analysis to get continuation decision
    const result = analyzePass(this._autonomyState, { content, actions, envelope });

    // Note: action chips are rendered inline by the SUMMARY envelope card
    // (see card-renderer.ts renderEnvelope). No separate broadcast needed —
    // it would duplicate the buttons below the assistant message.

    if (result.decision.shouldContinue && !this.abortController?.signal.aborted) {
      // Advance state and continue
      this._autonomyState = advanceAutonomyStateIfContinued(this._autonomyState, result.decision);
      this._broadcastAutonomyStatus();

      // Safety: cap autonomous continuation
      if (this._autonomyState.completedAutoPasses >= ChatPanel.MAX_AUTONOMY_PASSES) {
        const stopMsg: ChatMessage = {
          id: this._createMessageId(),
          role: 'system',
          content: `Autonomy safety limit reached (${ChatPanel.MAX_AUTONOMY_PASSES} passes). ${result.decision.reason}`,
          timestamp: new Date().toISOString(),
          instanceId: this.currentInstanceId,
        };
        this.messages.push(stopMsg);
        await this.persistMessages();
        await this.postMessage({ type: 'addMessage', message: stopMsg, actions: [], roleMeta: this._roleMetaFor(stopMsg), contextFooter: undefined });
        return;
      }

      // Post continuation notice
      const selectedAction = result.actionSet.actions.find((a) => a.id === result.selectedActionId);
      const statusView = deriveAutonomyStatusView(this._autonomyState);
      const noticeText = `*${result.decision.reason}*${selectedAction ? ` Next: ${selectedAction.label}.` : ''} ${statusView.countingActive ? `[${statusView.summary}]` : ''}`;
      const notice: ChatMessage = {
        id: this._createMessageId(),
        role: 'system',
        content: noticeText,
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
      };
      this.messages.push(notice);
      await this.persistMessages();
      await this.postMessage({ type: 'addMessage', message: notice, actions: [], roleMeta: this._roleMetaFor(notice), contextFooter: undefined });

      // Trigger next pass
      const continuationPrompt = result.nextPrompt ?? buildContinuationPrompt(selectedAction?.label);
      await this._runAutonomyContinuationPass(continuationPrompt, llmMessages, tools);
    } else {
      // Stopped — persist task state so the next turn can resume from a known position.
      this._lastStopContext = {
        summary: envelope.summary,
        nextSteps: result.actionSet.actions.slice(0, 3).map((a) => ({ label: a.label, rationale: a.rationale })),
      };
      this._broadcastAutonomyStatus();
      if (result.decision.reason) {
        const statusView = deriveAutonomyStatusView(this._autonomyState);
        const stopText = `${result.decision.reason}${statusView.countingActive ? ` [${statusView.summary}]` : ''}`;
        const stopMsg: ChatMessage = {
          id: this._createMessageId(),
          role: 'system',
          content: stopText,
          timestamp: new Date().toISOString(),
          instanceId: this.currentInstanceId,
        };
        this.messages.push(stopMsg);
        await this.persistMessages();
        await this.postMessage({ type: 'addMessage', message: stopMsg, actions: [], roleMeta: this._roleMetaFor(stopMsg), contextFooter: undefined });
      }
    }
  }

  private async _runAutonomyContinuationPass(
    prompt: string,
    baseLlmMessages: ArchitectMessage[],
    tools: ToolDefinition[],
  ): Promise<void> {
    if (this._autonomyContinuing) {
      console.warn('[DreamGraph] _runAutonomyContinuationPass: re-entrant call dropped — a continuation is already in progress.');
      // F-08: surface the dropped re-entrant call so the user knows their
      // input wasn't lost silently. Soft notification — no modal.
      void this.postMessage({
        type: 'tool-progress',
        tool: 'autonomy',
        message: 'A continuation pass is already running — additional trigger ignored.',
      });
      return; // prevent re-entrancy
    }
    this._autonomyContinuing = true;

    try {
      // Build continuation message
      const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(prompt) : null;
      const liveAnchor = envelope?.activeFile?.selection?.anchor ?? envelope?.activeFile?.cursorAnchor;
      const userMessage: ChatMessage = {
        id: this._createMessageId(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
        anchor: liveAnchor,
      };
      this.messages.push(userMessage);
      await this._persistMessagesWithCanonicalAnchorRefresh(envelope);

      this.streaming = true;
      this.streamingContent = '';
      this._lastToolTrace = [];
      this._lastVerdict = null;
      this.abortController = new AbortController();

      const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
      const autonomyInstruction: AutonomyInstructionState = { ...this._autonomyState, enabled: true };
      const provider = this.architectLlm?.provider ?? undefined;
      // Build full context for the continuation pass so the model has the same
      // grounding it would have in a normal user-initiated turn.
      const contextResult = envelope
        ? await this._buildPromptContext(task, envelope, prompt, 'continuation')
        : { assembledContext: '', reasoningPacket: null };
      const { system } = assemblePrompt(task, envelope, contextResult.assembledContext || undefined, undefined, autonomyInstruction, provider);

      const llmMessages: ArchitectMessage[] = [{ role: 'system', content: system }];
      // Bounded history: same caps as handleUserMessage (last 20 turns, per-message char caps).
      for (const msg of buildBoundedConversationMessages(this.messages, 20)) {
        llmMessages.push({ role: msg.role, content: msg.content });
      }

      await this.postMessage({ type: 'stream-start' });

      let fullContent = '';
      if (tools.length > 0) {
        fullContent = await this.runAgenticLoop(llmMessages, tools);
      } else {
        const req = this._createRequestSignal();
        try {
          await this.architectLlm!.stream(llmMessages, (chunk: string) => {
            const safeChunk = this._redactSecrets(chunk);
            fullContent += safeChunk;
            this.streamingContent += safeChunk;
            void this.postMessage({ type: 'stream-chunk', chunk: safeChunk });
          }, req.signal);
        } finally {
          req.dispose();
        }
      }

      const redactedFullContent = this._redactSecrets(fullContent);
      this._lastVerdict = this._deriveVerdict(redactedFullContent, this._lastToolTrace);
      const finalContent = this._applyRenderLimits(redactedFullContent);
      const implicitEntities = this._detectImplicitEntities(redactedFullContent);
      const implicitEntityNotice = implicitEntities.names.length > 0
        ? this._formatImplicitEntityNotice(implicitEntities)
        : undefined;

      const assistantMessage: ChatMessage = {
        id: this._createMessageId(),
        role: 'assistant',
        content: finalContent.content,
        fullContent: redactedFullContent,
        implicitEntityNotice,
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
        verdict: this._lastVerdict ?? undefined,
        toolTrace: this._lastToolTrace.length > 0 ? [...this._lastToolTrace] : undefined,
      };
      this.messages.push(assistantMessage);
      await this.persistMessages();

      await this.postMessage({ type: 'stream-end', done: true });

      if (this._lastVerdict) {
        await this.postMessage({ type: 'verdict', verdict: this._lastVerdict });
      }
      if (this._lastToolTrace.length > 0) {
        await this.postMessage({ type: 'toolTrace', calls: [...this._lastToolTrace] });
      }

      await this.postMessage({
        type: 'addMessage',
        message: assistantMessage,
        actions: this._buildMessageActions(assistantMessage),
        roleMeta: this._roleMetaFor(assistantMessage),
        contextFooter: this._contextFooterFor(assistantMessage),
      });

      // Recursively analyze the new pass
      this._autonomyContinuing = false;
      await this._handleAutonomyPassComplete(redactedFullContent, assistantMessage.id ?? '', llmMessages, tools);
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const displayText = isAbort ? 'Autonomous continuation stopped.' : `Error during continuation: ${errorText}`;
      const errMsg: ChatMessage = { id: this._createMessageId(), role: 'system', content: displayText, timestamp: new Date().toISOString(), instanceId: this.currentInstanceId };
      this.messages.push(errMsg);
      await this.persistMessages();
      await this.postMessage({ type: 'addMessage', message: errMsg, actions: [], roleMeta: this._roleMetaFor(errMsg), contextFooter: undefined });
    } finally {
      this._autonomyContinuing = false;
      this.resetStreamState();
    }
  }

  /**
   * Strip the structured pass envelope JSON fence from content before displaying.
   * The fence is parsed by extractStructuredPassEnvelope and should not render in chat.
   * Only strips blocks that contain the autonomy contract fields (goal_status).
   */
  private _stripStructuredEnvelope(content: string): string {
    return helpers.stripStructuredEnvelope(content);
  }

  private _formatStopContextBlock(ctx: { summary?: string; nextSteps: Array<{ label: string; rationale?: string }> }): string {
    return helpers.formatStopContextBlock(ctx);
  }

  private async _executeRecommendedAction(actionId: string, fallbackLabel?: string): Promise<void> {
    const action = this._lastRecommendedActions.find((a) => a.id === actionId);
    const label = action?.label || (typeof fallbackLabel === 'string' ? fallbackLabel.trim() : '');
    if (!label) return;
    await this.handleUserMessage(label);
  }

  private async _executeAllRecommendedActions(fallbackLabels?: string[]): Promise<void> {
    const liveLabels = this._lastRecommendedActions
      .filter((a) => a.eligible && a.withinScope)
      .map((a) => a.label)
      .filter((label) => typeof label === 'string' && label.trim().length > 0);
    const labels = liveLabels.length > 0
      ? liveLabels
      : (Array.isArray(fallbackLabels) ? fallbackLabels.map((label) => String(label || '').trim()).filter(Boolean) : []);
    if (labels.length === 0) return;
    const combined = `Execute these steps sequentially:\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
    await this.handleUserMessage(combined);
  }
  /** Re-exported from helpers.ts. */
  private static readonly SECRET_PATTERNS = helpers.SECRET_PATTERNS;
  /** Cap on accumulated streaming content to prevent context window overflow
   *  when the agent runs many iterations. Content beyond this is still executed
   *  but not accumulated into streamingContent (the webview already received it). */
  private static readonly MAX_STREAMING_CONTENT_CHARS = 200_000;

  /** Call callWithTools with automatic retry on 429 rate-limit errors. */
  private async _callWithToolsRetry(
    llmMessages: ArchitectMessage[],
    tools: ToolDefinition[],
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): ReturnType<ArchitectLlm['callWithTools']> {
    for (let attempt = 0; attempt <= ChatPanel.MAX_RETRIES; attempt++) {
      try {
        return await this.architectLlm!.callWithTools(llmMessages, tools, rawMessages, signal);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes('429') || msg.toLowerCase().includes('rate_limit');
        if (!is429 || attempt === ChatPanel.MAX_RETRIES) throw err;

        // Parse "try again in X.XXXs" from the error, fallback to exponential backoff
        const retryMatch = msg.match(/try again in ([\d.]+)s/i);
        const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : (attempt + 1) * 8;
        const waitMs = Math.min(waitSec * 1000, 60_000);

        const note = `\n⏳ Rate limited — retrying in ${Math.ceil(waitSec)}s (attempt ${attempt + 1}/${ChatPanel.MAX_RETRIES})…\n`;
        this.streamingContent += note;
        void this.postMessage({ type: 'stream-chunk', chunk: note });

        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
    throw new Error('Rate limit retries exhausted'); // unreachable but satisfies TS
  }

  private static _toolTimeoutMs(toolName: string): number {
    return helpers.toolTimeoutMs(toolName);
  }

  private async runAgenticLoop(initialMessages: ArchitectMessage[], tools: ToolDefinition[]): Promise<string> {
  if (!this.architectLlm) {
    throw new Error('Architect LLM not configured');
  }

  const llmMessages = [...initialMessages];
  // Anthropic does not accept role:"system" in the messages array — it must be
  // a top-level parameter. Strip system messages here; _callAnthropicWithTools
  // re-extracts and injects the system prompt via _splitSystem + _buildAnthropicMessagesRequest.
  let rawMessages: unknown[] = llmMessages
    .filter((message) => message.role !== 'system')
    .map((message) => {
      if (Array.isArray(message.content)) {
        return { role: message.role, content: message.content };
      }
      return { role: message.role, content: message.content };
    });
  let finalText = '';
  let pass = 0;
  const maxPasses = 12;

  while (pass < maxPasses) {
    pass += 1;
    const timeoutMs = this._getLlmTimeoutMs({ mode: 'tool', toolCount: tools.length });
    const req = this._createRequestSignal(timeoutMs);

    try {
      await this.postMessage({ type: 'stream-thinking', active: true });
      const response = await this._callWithToolsRetry(llmMessages, tools, rawMessages, req.signal);

      if (response.content) {
        const safeChunk = this._redactSecrets(response.content);
        finalText += safeChunk;
        this.streamingContent += safeChunk;
        await this.postMessage({ type: 'stream-chunk', chunk: safeChunk });
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return finalText;
      }

      const assistantBlocks: Array<Record<string, unknown>> = [];
      if (response.content) {
        assistantBlocks.push({ type: 'text', text: response.content });
      }
      for (const toolCall of response.toolCalls) {
        assistantBlocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }
      rawMessages.push({ role: 'assistant', content: assistantBlocks });

      const toolResultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
      for (const toolCall of response.toolCalls) {
        const toolStartedAt = Date.now();
        await this.postMessage({ type: 'tool-progress', tool: toolCall.name, message: `Running ${toolCall.name}…` });

        try {
          const result = isLocalTool(toolCall.name)
            ? await executeLocalTool(toolCall.name, toolCall.input ?? {})
            : await this._callMcpToolWithLazyConnect(toolCall.name, toolCall.input ?? {});
          const normalized = this._truncateToolResult(toolCall.name, this._stringifyToolResult(result));
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: normalized,
          });
          // F-04: invalidate context-builder caches when this tool is known to
          // mutate cognitive state, so the next envelope reflects the new graph.
          this.contextBuilder?.maybeInvalidateForTool(toolCall.name);
          this._lastToolTrace.push({
            tool: toolCall.name,
            argsSummary: this._summarizeToolArgs(toolCall.input ?? {}),
            filesAffected: this._extractFilesAffected(toolCall.name, toolCall.input ?? {}, normalized),
            durationMs: Date.now() - toolStartedAt,
            status: 'completed',
          });
          await this.postMessage({ type: 'tool-progress', tool: toolCall.name, message: `${toolCall.name} done` });
        } catch (toolErr) {
          const toolError = toolErr instanceof Error ? toolErr.message : String(toolErr);
          toolResultBlocks.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: toolError,
            is_error: true,
          });
          this._lastToolTrace.push({
            tool: toolCall.name,
            argsSummary: this._summarizeToolArgs(toolCall.input ?? {}),
            filesAffected: this._extractFilesAffected(toolCall.name, toolCall.input ?? {}, toolError),
            durationMs: Date.now() - toolStartedAt,
            status: 'failed',
          });
          await this.postMessage({ type: 'tool-progress', tool: toolCall.name, message: `${toolCall.name} failed` });
        }
      }

      rawMessages.push({ role: 'user', content: toolResultBlocks });
      // Bound rawMessages growth across passes: tool_results from passes that are
      // already 2+ passes behind have been consumed by the model — replace their
      // content with a short stub. This prevents quadratic growth when the loop
      // runs many passes (each pass otherwise re-sends every prior tool_result in full).
      _elideStaleToolResults(rawMessages, /*keepLastPairs*/ 6);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isTimeout = this._isTimeoutError(err);

      if (isTimeout) {
        const provider = this.architectLlm.provider ?? 'unknown';
        const model = this.architectLlm.currentConfig?.model;
        const visibleNotice = `\n⚠️ Tool-enabled LLM request timed out after ${Math.round(timeoutMs / 1000)}s. Recovery will be attempted if available.\n`;
        this.streamingContent += visibleNotice;
        await this.postMessage({ type: 'stream-chunk', chunk: visibleNotice });

        const timeoutMessage: ChatMessage = {
          id: this._createMessageId(),
          role: 'system',
          content: `Tool-enabled LLM request timed out after ${Math.round(timeoutMs / 1000)}s. Recovery will be attempted if available.`,
          timestamp: new Date().toISOString(),
          instanceId: this.currentInstanceId,
        };
        this.messages.push(timeoutMessage);
        await this.persistMessages();
        await this.postMessage({
          type: 'addMessage',
          message: timeoutMessage,
          actions: this._buildMessageActions(timeoutMessage),
          roleMeta: this._roleMetaFor(timeoutMessage),
          contextFooter: this._contextFooterFor(timeoutMessage),
        });

        this._logTimeoutDiagnostics({
          provider,
          model,
          mode: 'tool',
          timeoutMs,
          recoveryAttempted: true,
          recovered: false,
          toolCount: tools.length,
          usedReducedContext: false,
          errorMessage,
        });
      }

      throw err;
    } finally {
      req.dispose();
      await this.postMessage({ type: 'stream-thinking', active: false });
    }
  }

  // Wrap-up fallback: the loop ran to maxPasses without the model emitting an
  // empty-toolCall response. If we have prior tool activity but no final text,
  // the chat would render "(No response)" and the autonomy parser would find no
  // structured envelope — leading to a spurious "Paused: no clear next step"
  // even though the model did real work. Force one no-tools pass so the model
  // is required to summarize what it did and what to do next.
  if (!finalText.trim() && rawMessages.length > llmMessages.length) {
    try {
      const wrapNote = '\n\n_(Wrapping up: agentic loop hit pass limit — requesting summary…)_\n';
      this.streamingContent += wrapNote;
      await this.postMessage({ type: 'stream-chunk', chunk: wrapNote });

      const wrapPrompt: Array<Record<string, unknown>> = [
        { type: 'text', text: 'You have used the available tool budget for this turn. Stop calling tools. In your reply, briefly summarize what you discovered, what you changed (if anything), the current state, and one clear recommended next step. If autonomy is enabled, emit the structured JSON envelope as instructed by the system prompt.' },
      ];
      const wrapMessages = [...rawMessages, { role: 'user', content: wrapPrompt }];

      const wrapTimeout = this._getLlmTimeoutMs({ mode: 'stream' });
      const wrapReq = this._createRequestSignal(wrapTimeout);
      try {
        await this.postMessage({ type: 'stream-thinking', active: true });
        const wrapResponse = await this.architectLlm.callWithTools(wrapMessages as ArchitectMessage[], [], wrapMessages as unknown[], wrapReq.signal);
        if (wrapResponse.content) {
          const safeChunk = this._redactSecrets(wrapResponse.content);
          finalText += safeChunk;
          this.streamingContent += safeChunk;
          await this.postMessage({ type: 'stream-chunk', chunk: safeChunk });
        }
      } finally {
        wrapReq.dispose();
        await this.postMessage({ type: 'stream-thinking', active: false });
      }
    } catch (wrapErr) {
      // Best-effort fallback — don't mask the original loop result if wrap-up fails.
      const note = `\n\n⚠️ Could not generate wrap-up summary: ${wrapErr instanceof Error ? wrapErr.message : String(wrapErr)}\n`;
      finalText += note;
      this.streamingContent += note;
      await this.postMessage({ type: 'stream-chunk', chunk: note });
    }
  }

  return finalText;
}

  /**
   * Load markdown-it and DOMPurify browser builds from node_modules.
   * Results are cached on the instance. Falls back gracefully if files
   * are missing (e.g. corrupt .vsix or dev environment without npm install).
   */
  private _loadLibrarySources(): void {
    if (
      this._markdownItSource !== null &&
      this._domPurifySource !== null
    ) return;
    const extPath = this.context.extensionPath;
    // Vendor JS is copied to dist/vendor/ during build (see package.json `build:vendor`).
    // node_modules/** is excluded from the packaged VSIX, so loading from dist/vendor/ is the only reliable source at runtime.
    const libs: Array<{ key: 'md' | 'dp'; relPaths: string[]; name: string }> = [
      { key: 'md', relPaths: [path.join('dist', 'vendor', 'markdown-it.min.js'), path.join('node_modules', 'markdown-it', 'dist', 'markdown-it.min.js')], name: 'markdown-it' },
      { key: 'dp', relPaths: [path.join('dist', 'vendor', 'purify.min.js'), path.join('node_modules', 'dompurify', 'dist', 'purify.min.js')], name: 'DOMPurify' },
    ];
    for (const lib of libs) {
      let loaded = false;
      let lastErr: unknown;
      for (const rel of lib.relPaths) {
        try {
          const fullPath = path.join(extPath, rel);
          const src = fs.readFileSync(fullPath, 'utf-8');
          if (lib.key === 'md') this._markdownItSource = src;
          else this._domPurifySource = src;
          loaded = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!loaded) {
        console.error(`[DreamGraph] Failed to load ${lib.name} browser build from ${lib.relPaths.join(' or ')} — falling back to plaintext rendering. ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
        if (lib.key === 'md') this._markdownItSource = '';
        else this._domPurifySource = '';
      }
    }
  }

  private _getWebviewBundleUri(webview: vscode.Webview): string {
    if (this._webviewBundleUri !== null) return this._webviewBundleUri;
    try {
      const bundlePath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js');
      this._webviewBundleUri = webview.asWebviewUri(bundlePath).toString();
    } catch (err) {
      console.error(`[DreamGraph] Failed to resolve webview bundle URI — falling back to inline scripts. ${err instanceof Error ? err.message : String(err)}`);
      this._webviewBundleUri = '';
    }
    return this._webviewBundleUri;
  }

  private _redactSecrets(content: string): string {
    return helpers.redactSecrets(content);
  }

  /**
   * Best-effort `listTools()` that lazy-connects the MCP client.
   *
   * If the client exists but `connect()` has not run (auto-connect lost
   * the race, or the instance was bound after activation), we try to
   * bring it up here so the architect can use MCP tools without the
   * user having to manually invoke `DreamGraph: Connect`. Failure is
   * non-fatal — we degrade to "no MCP tools" so the architect can still
   * answer using local tools + LLM-only knowledge.
   */
  private async _listMcpToolsLazy(): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
    if (!this.mcpClient) return [];
    if (!this.mcpClient.isConnected) {
      try {
        await this.mcpClient.connect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.contextInspector?.appendContextLine(
          `MCP lazy-connect failed: ${msg} — proceeding without DreamGraph tools.`,
        );
        return [];
      }
    }
    try {
      return await this.mcpClient.listTools();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.contextInspector?.appendContextLine(
        `MCP listTools failed: ${msg} — proceeding without DreamGraph tools.`,
      );
      return [];
    }
  }

  /**
   * Best-effort `callTool` that lazy-connects the MCP client. Used by
   * the agentic loop so a stale/never-connected client is repaired
   * inline rather than crashing the whole turn.
   */
  private async _callMcpToolWithLazyConnect(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.mcpClient) {
      throw new Error(`Tool "${name}" is not available — MCP client is not configured.`);
    }
    if (!this.mcpClient.isConnected) {
      await this.mcpClient.connect();
    }
    return this.mcpClient.callTool(name, args);
  }

  private async _executeMessageActionTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const startedAt = Date.now();
    let status: 'completed' | 'failed' = 'completed';
    try {
      if (isLocalTool(toolName)) {
        return await executeLocalTool(toolName, input);
      }
      if (!this.mcpClient?.isConnected) {
        // Lazy-connect attempt — same rationale as `_listMcpToolsLazy`.
        if (this.mcpClient) {
          try {
            await this.mcpClient.connect();
          } catch {
            // fall through to the explicit "not connected" error below
          }
        }
        if (!this.mcpClient?.isConnected) {
          throw new Error(`Tool "${toolName}" is not available — MCP client is not connected.`);
        }
      }
      return await this.mcpClient.callTool(toolName, input, ChatPanel._toolTimeoutMs(toolName));
    } catch (error) {
      status = 'failed';
      throw error;
    } finally {
      this._lastToolTrace.push({
        tool: toolName,
        argsSummary: this._summarizeToolArgs(input),
        filesAffected: this._extractFilesAffected(input, ''),
        durationMs: Date.now() - startedAt,
        status,
      });
    }
  }

  private _stringifyToolResult(result: unknown): string {
    return helpers.stringifyToolResult(result);
  }

  private _truncateToolResult(toolName: string, content: string): string {
    return helpers.truncateToolResult(content, ChatPanel._toolResultLimit(toolName));
  }

  private _summarizeToolArgs(input: unknown): string {
    return helpers.summarizeToolArgs(input);
  }

  private _deriveVerdict(content: string, trace: ToolTraceEntry[]): VerdictBanner {
    return helpers.deriveVerdict(content, trace);
  }

  private _extractFilesAffected(toolNameOrInput: unknown, inputOrResult?: unknown, maybeResult?: string): string[] {
    return helpers.extractFilesAffected(toolNameOrInput, inputOrResult, maybeResult);
  }

  private async _verifyEntities(names: string[]): Promise<Record<string, EntityVerification>> {
    if (!this.mcpClient?.isConnected || !Array.isArray(names) || names.length === 0) {
      return {};
    }
    const unique = Array.from(new Set(names.map((n) => String(n || '').trim()).filter(Boolean))).slice(0, 100);
    const results: Record<string, EntityVerification> = {};
    for (let i = 0; i < unique.length; i += ChatPanel.MAX_VERIFICATION_BATCH_SIZE) {
      const batch = unique.slice(i, i + ChatPanel.MAX_VERIFICATION_BATCH_SIZE);
      try {
        const [featuresRaw, workflowsRaw, dataModelRaw, tensionsRaw, dreamsRaw] = await Promise.all([
          this.mcpClient.callTool('query_resource', { uri: 'system://features' }, ChatPanel.VERIFICATION_TIMEOUT_MS),
          this.mcpClient.callTool('query_resource', { uri: 'system://workflows' }, ChatPanel.VERIFICATION_TIMEOUT_MS),
          this.mcpClient.callTool('query_resource', { uri: 'system://data-model' }, ChatPanel.VERIFICATION_TIMEOUT_MS),
          this.mcpClient.callTool('query_resource', { uri: 'dream://tensions' }, ChatPanel.VERIFICATION_TIMEOUT_MS).catch(() => null),
          this.mcpClient.callTool('query_dreams', { type: 'all', status: 'latent', min_confidence: 0.4 }, ChatPanel.VERIFICATION_TIMEOUT_MS).catch(() => null),
        ]);

        const indexes = [featuresRaw, workflowsRaw, dataModelRaw].map((payload) => JSON.stringify(payload).toLowerCase());
        const tensionIndex = tensionsRaw ? JSON.stringify(tensionsRaw).toLowerCase() : '';
        const dreamIndex = dreamsRaw ? JSON.stringify(dreamsRaw).toLowerCase() : '';

        for (const name of batch) {
          const key = name.toLowerCase();
          if (tensionIndex && tensionIndex.includes(key)) {
            results[name] = { status: 'tension', confidence: 0.85 };
            continue;
          }
          if (indexes.some((index) => index.includes(key))) {
            results[name] = { status: 'verified', confidence: 0.8 };
            continue;
          }
          if (dreamIndex && dreamIndex.includes(key)) {
            results[name] = { status: 'latent', confidence: 0.5 };
            continue;
          }
          results[name] = { status: 'unverified', confidence: 0 };
        }
      } catch {
        return {};
      }
    }
    return results;
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this._loadLibrarySources();

    const markdownItScript = this._markdownItSource
      ? `<script nonce="${nonce}">${this._markdownItSource}</script>`
      : '';
    const domPurifyScript = this._domPurifySource
      ? `<script nonce="${nonce}">${this._domPurifySource}</script>`
      : '';
    const cardRendererScript = `<script nonce="${nonce}">${getCardRendererScript()}</script>`;
    const renderScript = `<script nonce="${nonce}">${getRenderScript()}</script>`;
    const entityLinkScript = `<script nonce="${nonce}">${getEntityLinksScript()}</script>`;
    const webviewBundleScript = this._webviewBundleUri
      ? `<script nonce="${nonce}" src="${this._webviewBundleUri}"></script>`
      : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${getStyles()}</style>
</head>
<body>
  <div class="header">
    <select id="provider-select" title="Provider"></select>
    <select id="model-select" title="Model"></select>
    <button id="set-api-key-btn" class="icon-btn" title="Set API key" aria-label="Set API key">🔑</button>
    <button id="clear-btn" class="icon-btn" title="Clear conversation" aria-label="Clear conversation">🗑️</button>
  </div>
  <div id="autonomy-bar" style="display:none">
    <span id="autonomy-mode-label"></span>
    <span id="autonomy-counter"></span>
    <button id="autonomy-reset-btn" class="icon-btn" title="Reset autonomy" aria-label="Reset autonomy" style="display:none">✕</button>
  </div>

  <div id="messages"></div>
  <div id="empty-state">
    <div class="empty-logo">🌙</div>
    <h2>DreamGraph Architect</h2>
    <p>Ask about features, workflows, data models, ADRs, tensions, or request changes.</p>
    <div class="example-prompts">
      <button class="example-prompt-btn" data-example="Explain the active file in system context">Explain the active file</button>
      <button class="example-prompt-btn" data-example="What architectural tensions exist?">Show tensions</button>
      <button class="example-prompt-btn" data-example="Scan the project and enrich the graph">Scan project</button>
    </div>
  </div>
  <div id="thinking-indicator" style="display:none">
    <div class="thinking-label-row">
      <span id="thinking-label">Dreaming…</span>
      <span class="thinking-dots" aria-hidden="true"><span></span><span></span><span></span></span>
    </div>
    <div id="tool-progress-list"></div>
  </div>
  <div id="attachments"></div>
  <div id="composer">
    <button id="attach-btn" class="icon-btn" title="Attach files" aria-label="Attach files">📎</button>
    <textarea id="prompt" rows="1" placeholder="Ask DreamGraph Architect…"></textarea>
    <button id="send-btn" class="icon-btn primary" title="Send" aria-label="Send">➤</button>
    <button id="stop-btn" class="icon-btn danger" title="Stop" aria-label="Stop" style="display:none">■</button>
  </div>

  ${markdownItScript}
  ${domPurifyScript}
  ${webviewBundleScript}
  ${!this._webviewBundleUri ? cardRendererScript : ''}
  ${!this._webviewBundleUri ? renderScript : ''}
  ${!this._webviewBundleUri ? entityLinkScript : ''}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const emptyStateEl = document.getElementById('empty-state');
    const promptEl = document.getElementById('prompt');
    const sendBtn = document.getElementById('send-btn');
    const stopBtn = document.getElementById('stop-btn');
    const clearBtn = document.getElementById('clear-btn');
    const attachBtn = document.getElementById('attach-btn');
    const attachmentsEl = document.getElementById('attachments');
    const providerSelect = document.getElementById('provider-select');
    const modelSelect = document.getElementById('model-select');
    const setApiKeyBtn = document.getElementById('set-api-key-btn');
    const thinkingEl = document.getElementById('thinking-indicator');
    const thinkingLabel = document.getElementById('thinking-label');
    const toolProgressListEl = document.getElementById('tool-progress-list');

    let draftSaveTimer = null;
    let lastToolTrace = [];
    let lastVerdict = null;
    let streamingBubble = null;
    let streamingMarkdownEl = null;
    let streamingRaw = '';
    let verifyTimer = null;
    const pendingVerification = new Map();
    const actionStates = new Map();

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function setEmptyStateVisible(visible) {
      emptyStateEl.style.display = visible ? 'flex' : 'none';
      messagesEl.style.display = visible ? 'none' : 'flex';
    }

    function autoresize() {
      promptEl.style.height = 'auto';
      promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px';
    }

    function queueDraftSave() {
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = setTimeout(() => {
        vscode.postMessage({ type: 'saveDraft', text: promptEl.value });
      }, 250);
    }

    function createRoleHeader(roleMeta, messageId) {
      const header = document.createElement('div');
      header.className = 'message-header';
      const left = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'message-role-title';
      title.textContent = roleMeta?.title || 'Message';
      left.appendChild(title);
      if (roleMeta?.subtitle) {
        const subtitle = document.createElement('div');
        subtitle.className = 'message-role-subtitle';
        subtitle.textContent = roleMeta.subtitle;
        left.appendChild(subtitle);
      }
      const hoverActions = document.createElement('div');
      hoverActions.className = 'message-actions-hover';
      [['Copy','copyMessage'],['Retry','retryMessage'],['Pin','pinMessage']].forEach(([label, type]) => {
        const btn = document.createElement('button');
        btn.className = 'message-mini-btn';
        btn.textContent = label;
        btn.addEventListener('click', () => vscode.postMessage({ type, messageId }));
        hoverActions.appendChild(btn);
      });
      header.appendChild(left);
      header.appendChild(hoverActions);
      return header;
    }

    function renderVerdictBanner(verdict) {
      if (!verdict) return null;
      const banner = document.createElement('div');
      banner.className = 'verdict-banner verdict-' + verdict.level;
      const label = document.createElement('span');
      label.className = 'verdict-label';
      label.textContent = verdict.level;
      const summary = document.createElement('span');
      summary.textContent = verdict.summary;
      banner.appendChild(label);
      banner.appendChild(summary);
      return banner;
    }

    function renderToolTrace(trace) {
      if (!Array.isArray(trace) || trace.length === 0) return null;
      const details = document.createElement('details');
      details.className = 'tool-trace';
      const summary = document.createElement('summary');
      summary.textContent = 'Tool trace (' + trace.length + ')';
      details.appendChild(summary);
      const list = document.createElement('div');
      list.className = 'tool-trace-list';
      for (const entry of trace) {
        const item = document.createElement('div');
        item.className = 'tool-trace-item';
        const head = document.createElement('div');
        head.className = 'tool-trace-head';
        head.innerHTML = '<span>' + escapeHtml(entry.tool || 'tool') + '</span><span>' + escapeHtml(entry.status || '') + '</span>';
        const meta = document.createElement('div');
        meta.className = 'tool-trace-meta';
        meta.textContent = (entry.argsSummary || '') + (entry.filesAffected?.length ? ' • ' + entry.filesAffected.join(', ') : '') + (Number.isFinite(entry.durationMs) ? ' • ' + entry.durationMs + 'ms' : '');
        item.appendChild(head);
        item.appendChild(meta);
        list.appendChild(item);
      }
      details.appendChild(list);
      return details;
    }

    function renderProvenance(message, trace) {
      const div = document.createElement('div');
      div.className = 'message-provenance';
      div.textContent = trace && trace.length > 0
        ? 'Provenance: grounded in executed tools and rendered output.'
        : 'Provenance: rendered output without executed tool trace.';
      return div;
    }

    function renderContextFooter(text) {
      if (!text) return null;
      const div = document.createElement('div');
      div.className = 'message-context-footer';

      // Parse optional anchor-status sentinel: [anchor-status:STATE:LABEL]
      // If found, strip sentinel from display text and append a styled badge.
      // NOTE: backslashes are doubled because this code is inside a JS template literal
      // in getHtml(). At runtime, the template literal strips single backslashes
      // (\s → s, \[ → [), so \\s → \s and \\[ → \[ after evaluation.
      const sentinelRe = /\\s*\\[anchor-status:([a-z]+):([^\\]]*)\\]\\s*$/;
      const match = text.match(sentinelRe);
      if (match) {
        const anchorState = match[1]; // promoted|rebound|drifted|archived|native|canonical
        const anchorLabel = match[2];
        const cleanText = text.replace(sentinelRe, '').trimEnd();
        // Render prefix (e.g. "Instance: xxx • ") as plain text
        const prefix = document.createTextNode(cleanText);
        div.appendChild(prefix);
        // Render the badge
        const badge = document.createElement('span');
        badge.className = 'anchor-state-badge anchor-state-' + anchorState;
        badge.textContent = anchorLabel ? anchorState + ': ' + anchorLabel : anchorState;
        badge.title = 'Semantic anchor migration state';
        div.appendChild(badge);
      } else {
        div.textContent = text;
      }
      return div;
    }

    function renderImplicitEntityNotice(text) {
      if (!text) return null;
      const div = document.createElement('div');
      div.className = 'implicit-entity-notice';
      div.textContent = text;
      return div;
    }

    function getActionState(messageId, actionId) {
      return actionStates.get(messageId + ':' + actionId) || { status: 'idle', error: '' };
    }

    function renderMessageActions(message, actions) {
      if (!Array.isArray(actions) || actions.length === 0) return null;
      const wrap = document.createElement('div');
      wrap.className = 'message-actions';
      for (const action of actions) {
        const state = getActionState(message.id, action.id);
        const btn = document.createElement('button');
        btn.className = 'message-action-btn ' + (action.kind === 'primary' ? 'primary' : 'secondary') + (state.status === 'loading' ? ' loading' : '');
        btn.textContent = action.label;
        btn.disabled = state.status === 'loading';
        btn.addEventListener('click', () => {
          if (state.status === 'loading') return;
          vscode.postMessage({ type: 'runMessageAction', messageId: message.id, actionId: action.id });
        });
        wrap.appendChild(btn);
        if (state.status === 'failed' && state.error) {
          const error = document.createElement('div');
          error.className = 'message-action-error';
          error.textContent = state.error;
          wrap.appendChild(error);
        }
      }
      return wrap;
    }

    function scheduleVerification(container) {
      if (!container || typeof window.linkifyEntities !== 'function') return;
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => {
        const names = Array.from(container.querySelectorAll('a.entity-link'))
          .map((a) => a.getAttribute('data-entity-name') || a.getAttribute('data-uri') || a.textContent || '')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 100);
        if (names.length === 0) return;
        const requestId = 'verify_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        pendingVerification.set(requestId, container);
        vscode.postMessage({ type: 'verifyEntities', requestId, names });
      }, 80);
    }

    function applyEntityVerification(container, results) {
      if (!container) return;
      for (const link of container.querySelectorAll('a.entity-link')) {
        const name = (link.getAttribute('data-entity-name') || link.getAttribute('data-uri') || link.textContent || '').trim();
        const status = results?.[name]?.status || 'unverified';
        link.classList.remove('entity-verified', 'entity-latent', 'entity-tension', 'entity-unverified');
        link.classList.add('entity-' + status);
      }
    }

    function schedulePostRenderWork(node, options) {
      if (!node) return;
      const opts = options || {};
      requestAnimationFrame(() => {
        if (typeof window.applyEntityLinks === 'function') {
          window.applyEntityLinks(node);
        }

        function isStructuredEnvelope(obj) {
          return !!(obj && typeof obj === 'object' && typeof obj.summary === 'string' &&
            ('goal_status' in obj || 'recommended_next_steps' in obj));
        }

        function tryParseEnvelopeText(text) {
          if (!text) return null;
          const raw = String(text).trim();
          if (!raw) return null;

          const candidates = [];
          candidates.push(raw);

          if (raw.charCodeAt(0) === 96 && raw.charCodeAt(1) === 96 && raw.charCodeAt(2) === 96) {
            let body = raw;
            if (body.slice(0, 7) === String.fromCharCode(96, 96, 96, 106, 115, 111, 110)) {
              body = body.slice(7);
            } else {
              body = body.slice(3);
            }
            if (body.length >= 3 && body.charCodeAt(body.length - 1) === 96 && body.charCodeAt(body.length - 2) === 96 && body.charCodeAt(body.length - 3) === 96) {
              body = body.slice(0, -3);
            }
            body = body.trim();
            if (body) candidates.push(body);
          }

          const firstBrace = raw.indexOf('{');
          const lastBrace = raw.lastIndexOf('}');
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            const objectText = raw.slice(firstBrace, lastBrace + 1).trim();
            if (objectText) candidates.push(objectText);
          }

          for (const candidate of candidates) {
            try {
              const parsed = JSON.parse(candidate);
              if (isStructuredEnvelope(parsed)) {
                return parsed;
              }
            } catch (_e) {
            }
          }

          return null;
        }

        function replaceEnvelopeElement(target, obj) {
          if (!target || !obj || typeof window.renderEnvelope !== 'function') return false;
          const wrapper = document.createElement('div');
          wrapper.innerHTML = window.renderEnvelope(obj);
          const rendered = wrapper.firstElementChild;
          if (!rendered) return false;
          if (obj && typeof obj === 'object') {
            const steps = Array.isArray(obj.recommended_next_steps) ? obj.recommended_next_steps : [];
            const labels = steps.map((step) => (step && typeof step.label === 'string' ? step.label : '')).filter(Boolean);
            rendered.querySelectorAll('.dg-envelope-action').forEach((button, index) => {
              const label = labels[index];
              if (label) button.setAttribute('data-action-label', label);
            });
            const doAllButton = rendered.querySelector('.dg-envelope-do-all');
            if (doAllButton && labels.length > 0) {
              doAllButton.setAttribute('data-action-labels', JSON.stringify(labels));
            }
          }
          target.replaceWith(rendered);
          return true;
        }

        if (typeof window.renderEnvelope === 'function') {
          node.querySelectorAll('pre').forEach((pre) => {
            const code = pre.querySelector('code');
            const text = code ? (code.textContent || '') : (pre.textContent || '');
            const parsed = tryParseEnvelopeText(text);
            if (parsed) {
              replaceEnvelopeElement(pre, parsed);
            }
          });

          node.querySelectorAll('code').forEach((code) => {
            if (!code.parentElement || code.closest('.dg-envelope')) return;
            const parsed = tryParseEnvelopeText(code.textContent || '');
            if (parsed) {
              replaceEnvelopeElement(code, parsed);
            }
          });

          Array.from(node.children || []).forEach((child) => {
            if (!child) return;
            if (child.classList && child.classList.contains('dg-envelope')) return;
            if (child.tagName === 'PRE' || child.tagName === 'CODE') return;
            const parsed = tryParseEnvelopeText(child.textContent || '');
            if (parsed) {
              replaceEnvelopeElement(child, parsed);
            }
          });
        }

        // Wire envelope action chip clicks
        node.querySelectorAll('.dg-envelope-action:not([data-wired])').forEach((btn) => {
          btn.setAttribute('data-wired', '1');
          btn.addEventListener('click', () => {
            const actionId = btn.getAttribute('data-action-id') || '';
            const label = btn.getAttribute('data-action-label') || '';
            if (actionId || label) {
              vscode.postMessage({ type: 'selectRecommendedAction', actionId, label });
            }
          });
        });
        node.querySelectorAll('.dg-envelope-do-all:not([data-wired])').forEach((btn) => {
          btn.setAttribute('data-wired', '1');
          btn.addEventListener('click', () => {
            let labels = [];
            const raw = btn.getAttribute('data-action-labels') || '[]';
            try {
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) labels = parsed.map((label) => String(label || '')).filter(Boolean);
            } catch (_e) {
            }
            vscode.postMessage({ type: 'doAllRecommendedActions', labels });
          });
        });
        if (opts.verify !== false) {
          scheduleVerification(node);
        }
        if (opts.stickToBottom !== false) {
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      });
    }

    function renderAssistantBody(message) {
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-body';
      const renderMarkdown = window.renderMarkdown || ((s) => escapeHtml(s));
      const rawContent = String(message && message.content ? message.content : '');
      const normalizedCandidate = String(message && (message.fullContent || message.content) ? (message.fullContent || message.content) : '');
      const normalizeEnvelopeFence = window.normalizeEnvelopeFence || ((s) => s);
      const tryParseEnvelope = window.tryParseEnvelope || (() => null);
      const normalizedContent = normalizeEnvelopeFence(rawContent);
      const normalizedCandidateContent = normalizeEnvelopeFence(normalizedCandidate);
      const envelope = tryParseEnvelope(normalizedContent) || tryParseEnvelope(normalizedCandidateContent);
      if (envelope && typeof window.renderEnvelope === 'function') {
        wrapper.innerHTML = window.renderEnvelope(envelope);
      } else {
        let html = renderMarkdown(normalizedContent);
        if (typeof window.linkifyEntities === 'function') {
          html = window.linkifyEntities(html) || html;
        }
        wrapper.innerHTML = html;
      }
      schedulePostRenderWork(wrapper, { verify: false, stickToBottom: false });
      return wrapper;
    }

    function createMessageNode(message, actions, roleMeta, contextFooter, uiState) {
      const bubble = document.createElement('div');
      bubble.className = 'message ' + message.role;
      bubble.dataset.messageId = message.id || '';
      if (roleMeta) bubble.appendChild(createRoleHeader(roleMeta, message.id));

      if (message.role === 'assistant') {
        const state = uiState || {};
        const body = renderAssistantBody(message);
        bubble.appendChild(body);
        const verdict = renderVerdictBanner(state.verdict || null);
        if (verdict) bubble.appendChild(verdict);
        const implicit = renderImplicitEntityNotice(message.implicitEntityNotice);
        if (implicit) bubble.appendChild(implicit);
        const trace = renderToolTrace(state.toolTrace || []);
        if (trace) bubble.appendChild(trace);
        bubble.appendChild(renderProvenance(message, state.toolTrace || []));
        const actionBlock = renderMessageActions(message, actions);
        if (actionBlock) bubble.appendChild(actionBlock);
        const footer = renderContextFooter(contextFooter);
        if (footer) bubble.appendChild(footer);
      } else {
        if (roleMeta) {
          const body = document.createElement('div');
          body.className = 'message-text';
          body.textContent = message.content || '';
          bubble.appendChild(body);
        } else {
          bubble.textContent = message.content || '';
        }
        const footer = renderContextFooter(contextFooter);
        if (footer) bubble.appendChild(footer);
      }
      return bubble;
    }

    function addMessage(message, actions, roleMeta, contextFooter, uiState) {
      setEmptyStateVisible(false);
      const node = createMessageNode(message, actions, roleMeta, contextFooter, uiState);
      messagesEl.appendChild(node);
      requestAnimationFrame(() => {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }

    function rerenderMessageActions(messageId) {
      const bubble = messagesEl.querySelector('.message[data-message-id="' + messageId + '"]');
      if (!bubble) return;
      const state = vscode.getState() || {};
      const messages = state.messages || [];
      const entry = messages.find((m) => m.message?.id === messageId);
      if (!entry) return;
      bubble.remove();
      addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter, entry.uiState || { toolTrace: [], verdict: null });
    }

    function startStreaming() {
      setEmptyStateVisible(false);
      streamingRaw = '';
      streamingBubble = document.createElement('div');
      streamingBubble.className = 'message assistant';
      streamingMarkdownEl = document.createElement('div');
      streamingMarkdownEl.className = 'markdown-body';
      streamingBubble.appendChild(streamingMarkdownEl);
      messagesEl.appendChild(streamingBubble);
      schedulePostRenderWork(streamingMarkdownEl, { verify: false });
      sendBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';
      thinkingEl.style.display = 'flex';
    }

    function updateStreaming(chunk) {
      if (!streamingBubble || !streamingMarkdownEl) return;
      streamingRaw += chunk;
      const renderMarkdown = window.renderMarkdown || ((s) => escapeHtml(s));
      const normalizeEnvelopeFence = window.normalizeEnvelopeFence || ((s) => s);
      const tryParseEnvelope = window.tryParseEnvelope || (() => null);
      const normalizedContent = normalizeEnvelopeFence(streamingRaw);
      const envelope = tryParseEnvelope(normalizedContent);
      if (envelope && typeof window.renderEnvelope === 'function') {
        streamingMarkdownEl.innerHTML = window.renderEnvelope(envelope);
      } else {
        let html = renderMarkdown(normalizedContent);
        if (typeof window.linkifyEntities === 'function') {
          html = window.linkifyEntities(html) || html;
        }
        streamingMarkdownEl.innerHTML = html;
      }
      schedulePostRenderWork(streamingMarkdownEl, { verify: false });
    }

    function endStreaming() {
      if (streamingBubble) streamingBubble.remove();
      streamingBubble = null;
      streamingMarkdownEl = null;
      streamingRaw = '';
      sendBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';
      thinkingEl.style.display = 'none';
      toolProgressListEl.innerHTML = '';
    }

    function restoreState(payload) {
      const entries = (payload?.messages || []).map((message) => ({
        message,
        actions: [],
        roleMeta: message.role === 'assistant'
          ? { title: 'DreamGraph Architect', subtitle: 'Graph-grounded assistant' }
          : message.role === 'user'
            ? { title: 'You' }
            : { title: 'System' },
        contextFooter: message.role === 'assistant'
          ? 'Instance: ' + (message.instanceId || 'default') + ' • Actions require explicit click • Trace reflects real tool execution'
          : message.role === 'user'
            ? (() => {
                const anchor = message.anchor;
                if (!anchor) return 'Instance: ' + (message.instanceId || 'default');
                const status = anchor.migrationStatus || 'native';
                const label = anchor.canonicalId
                  ? ((anchor.canonicalKind || 'entity') + ':' + anchor.canonicalId)
                  : (anchor.symbolPath || anchor.label);
                const anchorText = status === 'promoted'
                  ? 'Anchor: promoted to ' + label
                  : status === 'rebound'
                    ? 'Anchor: rebound to ' + label
                    : status === 'drifted'
                      ? 'Anchor: drifted near ' + label
                      : status === 'archived'
                        ? 'Anchor: archived (' + label + ')'
                        : (anchor.canonicalId ? 'Anchor: canonical ' + label : 'Anchor: native ' + label);
                return 'Instance: ' + (message.instanceId || 'default') + ' • ' + anchorText;
              })()
            : 'Instance: ' + (message.instanceId || 'default') + ' • System message',
        uiState: {
          toolTrace: Array.isArray(message.toolTrace) ? message.toolTrace : [],
          verdict: message.verdict || null,
        },
      }));
      vscode.setState({ ...(vscode.getState() || {}), messages: entries });
      messagesEl.innerHTML = '';
      if (entries.length === 0) {
        setEmptyStateVisible(true);
        return;
      }
      setEmptyStateVisible(false);
      for (const entry of entries) {
        addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter, entry.uiState);
      }
    }

    promptEl.addEventListener('input', () => {
      autoresize();
      queueDraftSave();
    });
    promptEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const text = promptEl.value.trim();
        if (!text) return;
        vscode.postMessage({ type: 'send', text });
        promptEl.value = '';
        autoresize();
        queueDraftSave();
      }
    });
    sendBtn.addEventListener('click', () => {
      const text = promptEl.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'send', text });
      promptEl.value = '';
      autoresize();
      queueDraftSave();
    });
    stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
    clearBtn.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
    attachBtn.addEventListener('click', () => vscode.postMessage({ type: 'pickAttachments' }));
    const autonomyResetBtn = document.getElementById('autonomy-reset-btn');
    if (autonomyResetBtn) autonomyResetBtn.addEventListener('click', () => vscode.postMessage({ type: 'resetAutonomy' }));
    providerSelect.addEventListener('change', () => vscode.postMessage({ type: 'changeProvider', provider: providerSelect.value }));
    modelSelect.addEventListener('change', () => vscode.postMessage({ type: 'changeModel', model: modelSelect.value }));
    setApiKeyBtn.addEventListener('click', () => vscode.postMessage({ type: 'setApiKey' }));
    document.querySelectorAll('.example-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        promptEl.value = btn.getAttribute('data-example') || '';
        autoresize();
        promptEl.focus();
      });
    });

    // Clipboard image paste — intercept paste events on the prompt area
    // and forward image data to the extension host for attachment.
    promptEl.addEventListener('paste', (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          event.preventDefault();
          const blob = item.getAsFile();
          if (!blob) return;
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result;
            if (typeof dataUrl !== 'string') return;
            // dataUrl format: "data:image/png;base64,iVBOR..."
            const commaIdx = dataUrl.indexOf(',');
            if (commaIdx < 0) return;
            const dataBase64 = dataUrl.slice(commaIdx + 1);
            const mimeType = item.type || 'image/png';
            vscode.postMessage({ type: 'pasteImage', dataBase64, mimeType });
          };
          reader.readAsDataURL(blob);
          return; // handle only the first image
        }
      }
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      switch (msg.type) {
        case 'state':
          restoreState(msg.state);
          break;
        case 'restoreDraft':
          promptEl.value = msg.text || '';
          autoresize();
          break;
        case 'stream-start':
          startStreaming();
          break;
        case 'stream-chunk':
          updateStreaming(msg.chunk || '');
          break;
        case 'stream-thinking':
          thinkingEl.style.display = msg.active ? 'flex' : 'none';
          break;
        case 'stream-end':
          endStreaming();
          break;
        case 'tool-progress': {
          const visibleWindow = 5;
          const row = document.createElement('div');
          row.className = 'tool-row-live tool-row-enter';
          row.innerHTML = '<span class="tool-name">' + escapeHtml(msg.tool || 'tool') + '</span><span class="tool-message">' + escapeHtml(msg.message || '') + '</span>';
          // Newest on top: prepend.
          if (toolProgressListEl.firstChild) {
            toolProgressListEl.insertBefore(row, toolProgressListEl.firstChild);
          } else {
            toolProgressListEl.appendChild(row);
          }
          // Trigger enter animation on next frame.
          requestAnimationFrame(() => {
            row.classList.remove('tool-row-enter');
          });

          const liveRows = Array.from(toolProgressListEl.querySelectorAll('.tool-row-live'));
          liveRows.forEach((item, depth) => {
            if (depth >= visibleWindow) {
              // Animate out then remove.
              item.style.setProperty('--tool-progress-opacity', '0');
              item.style.setProperty('--tool-progress-scale', '0.7');
              item.style.setProperty('--tool-progress-blur', '3px');
              setTimeout(() => { item.remove(); }, 220);
              return;
            }
            const scale = Math.max(0.78, 1 - (depth * 0.07));
            const opacity = Math.max(0.25, 1 - (depth * 0.22));
            const blur = Math.min(2.0, depth * 0.45);
            item.style.setProperty('--tool-progress-scale', String(scale));
            item.style.setProperty('--tool-progress-opacity', String(opacity));
            item.style.setProperty('--tool-progress-blur', blur.toFixed(2) + 'px');
          });
          break;
        }
        case 'addMessage': {
          const uiState = { toolTrace: [...lastToolTrace], verdict: lastVerdict };
          const state = vscode.getState() || {};
          const entries = [...(state.messages || []), {
            message: msg.message,
            actions: msg.actions || [],
            roleMeta: msg.roleMeta,
            contextFooter: msg.contextFooter,
            uiState: uiState,
          }];
          vscode.setState({ ...state, messages: entries });
          addMessage(msg.message, msg.actions || [], msg.roleMeta, msg.contextFooter, uiState);
          break;
        }
        case 'messageActionState': {
          actionStates.set(msg.messageId + ':' + msg.actionId, { status: msg.status, error: msg.error || '' });
          rerenderMessageActions(msg.messageId);
          break;
        }
        case 'entityStatus': {
          const container = pendingVerification.get(msg.requestId);
          if (container) {
            applyEntityVerification(container, msg.results || {});
            pendingVerification.delete(msg.requestId);
          }
          break;
        }
        case 'toolTrace':
          lastToolTrace = Array.isArray(msg.calls) ? msg.calls : [];
          break;
        case 'verdict':
          lastVerdict = msg.verdict || null;
          break;
        case 'updateModels': {
          providerSelect.innerHTML = '';
          for (const p of msg.providers || []) {
            const opt = document.createElement('option');
            opt.value = p;
            opt.textContent = p;
            if (p === msg.current?.provider) opt.selected = true;
            providerSelect.appendChild(opt);
          }
          modelSelect.innerHTML = '';
          for (const m of msg.models || []) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === msg.current?.model) opt.selected = true;
            modelSelect.appendChild(opt);
          }
          const customOpt = document.createElement('option');
          customOpt.value = '__custom__';
          customOpt.textContent = '+ Custom model…';
          modelSelect.appendChild(customOpt);
          break;
        }
        case 'setAttachments': {
          attachmentsEl.innerHTML = '';
          for (const attachment of msg.attachments || []) {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            chip.innerHTML = '<span class="chip-icon">' + (attachment.kind === 'image' ? '🖼️' : '📄') + '</span><span>' + escapeHtml(attachment.name) + '</span>';
            const remove = document.createElement('button');
            remove.className = 'attachment-remove';
            remove.textContent = '×';
            remove.addEventListener('click', () => vscode.postMessage({ type: 'removeAttachment', id: attachment.id }));
            chip.appendChild(remove);
            attachmentsEl.appendChild(chip);
          }
          break;
        }
        case 'error':
          console.error(msg.error);
          break;
        case 'autonomyStatus': {
          const bar = document.getElementById('autonomy-bar');
          const label = document.getElementById('autonomy-mode-label');
          const counter = document.getElementById('autonomy-counter');
          const resetBtn = document.getElementById('autonomy-reset-btn');
          if (bar && label && counter && resetBtn) {
            const s = msg.status;
            bar.style.display = 'flex';
            label.textContent = s.mode.charAt(0).toUpperCase() + s.mode.slice(1);
            label.className = 'autonomy-mode autonomy-mode-' + s.mode;
            counter.textContent = s.countingActive ? s.summary : '';
            resetBtn.style.display = s.mode !== 'cautious' || s.countingActive ? 'inline-flex' : 'none';
          }
          break;
        }
        case 'recommendedActions': {
          const targetBubble = messagesEl.querySelector('.message[data-message-id="' + msg.messageId + '"]');
          if (targetBubble) {
            const existing = targetBubble.querySelector('.recommended-actions');
            if (existing) existing.remove();
            const wrapper = document.createElement('div');
            wrapper.className = 'recommended-actions';
            for (const action of msg.actions || []) {
              const chip = document.createElement('button');
              chip.className = 'action-chip';
              chip.textContent = action.label;
              if (action.rationale) chip.title = action.rationale;
              chip.addEventListener('click', () => vscode.postMessage({ type: 'selectRecommendedAction', actionId: action.id }));
              wrapper.appendChild(chip);
            }
            if (msg.doAllEligible && (msg.actions || []).length > 1) {
              const doAll = document.createElement('button');
              doAll.className = 'action-chip action-chip-all';
              doAll.textContent = 'Do all';
              doAll.addEventListener('click', () => vscode.postMessage({ type: 'doAllRecommendedActions' }));
              wrapper.appendChild(doAll);
            }
            targetBubble.appendChild(wrapper);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          break;
        }
      }
    });

    autoresize();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
