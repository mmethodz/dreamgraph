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

type ChatRole = 'user' | 'assistant' | 'system';

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

interface ImplicitEntityDetectionResult {
  names: string[];
  truncated: boolean;
}

interface VerdictBanner {
  level: 'verified' | 'partial' | 'speculative';
  summary: string;
}

interface ToolTraceEntry {
  tool: string;
  argsSummary: string;
  filesAffected: string[];
  durationMs: number;
  status: 'completed' | 'failed';
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

  private static readonly MAX_RENDERED_MESSAGE_CHARS = 100_000;
  private static readonly MAX_ENTITY_LINKS_PER_MESSAGE = 100;
  private static readonly ACTION_ALLOWLIST = new Set(['tool', 'show_full']);

  private static readonly MAX_TEXT_ATTACHMENT_BYTES = 100_000;
  private static readonly MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

  /** Hard timeout per LLM provider request (ms). Prevents infinite hangs. */
  private static readonly REQUEST_TIMEOUT_MS = 90_000;

  /** Per-tool timeout overrides (ms). Tools not listed use _default. */
  private static readonly TOOL_TIMEOUT_MS: Record<string, number> = {
    dream_cycle: 120_000,
    nightmare_cycle: 120_000,
    metacognitive_analysis: 120_000,
    run_command: 60_000,
    write_file: 30_000,
    edit_file: 30_000,
    read_source_code: 30_000,
    read_local_file: 30_000,
    _default: 60_000,
  };

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

  private static readonly TOOL_RESULT_LIMITS: Record<string, number> = {
    read_source_code: 12_000,
    read_local_file: 12_000,
    query_api_surface: 10_000,
    run_command: 8_000,
    edit_entity: 6_000,
    edit_file: 6_000,
    modify_entity: 6_000,
    write_file: 4_000,
    _default: 4_000,
  };

  private static _toolResultLimit(toolName: string): number {
    return ChatPanel.TOOL_RESULT_LIMITS[toolName] ?? ChatPanel.TOOL_RESULT_LIMITS._default;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public setGraphSignal(provider: GraphSignalProvider): void { this.graphSignal = provider; }
  public setMemory(memory: ChatMemory): void { this.memory = memory; }
  public setArchitectLlm(llm: ArchitectLlm): void { this.architectLlm = llm; }
  public setContextBuilder(cb: ContextBuilder): void { this.contextBuilder = cb; }
  public setMcpClient(mcp: McpClient): void { this.mcpClient = mcp; }
  public setChangedFilesProvider(provider: ChangedFilesView): void { this.changedFilesView = provider; }

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
              try {
                const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
                await vscode.window.showTextDocument(doc, { preview: true });
              } catch {
                void vscode.window.showWarningMessage(`Could not open file: ${name}`);
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
          const actionMsg = message as { type: 'selectRecommendedAction'; actionId: string };
          await this._executeRecommendedAction(actionMsg.actionId);
          break;
        }
        case 'doAllRecommendedActions': {
          await this._executeAllRecommendedActions();
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

  private async handleUserMessage(text: string): Promise<void> {
    // Detect and apply autonomy mode requests from user text
    this._detectAutonomyRequest(text);

    const attachmentSummary = this._attachmentSummaryForUserMessage();
    const userMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'user',
      content: attachmentSummary ? `${text}\n\n${attachmentSummary}` : text,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };

    this.messages.push(userMessage);
    await this.persistMessages();
    await this.postMessage({ type: 'addMessage', message: userMessage, actions: this._buildMessageActions(userMessage), roleMeta: this._roleMetaFor(userMessage), contextFooter: this._contextFooterFor(userMessage) });

    if (!this.architectLlm || !this.architectLlm.isConfigured) {
      const errMsg: ChatMessage = {
        id: this._createMessageId(),
        role: 'system',
        content: 'Architect LLM is not configured. Select provider and model in the header dropdowns, then set your API key.',
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
      };
      this.messages.push(errMsg);
      await this.persistMessages();
      await this.postMessage({ type: 'addMessage', message: errMsg, actions: this._buildMessageActions(errMsg), roleMeta: this._roleMetaFor(errMsg), contextFooter: this._contextFooterFor(errMsg) });
      return;
    }

    try {
      this.streaming = true;
      this.streamingContent = '';
      this.steeringQueue = [];
      this._lastToolTrace = [];
      this._lastVerdict = null;
      this.abortController = new AbortController();

      const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(text) : null;
      const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
      const autonomyInstruction: AutonomyInstructionState | undefined = this._autonomyEnabled
        ? { ...this._autonomyState, enabled: true }
        : undefined;
      const provider = this.architectLlm?.provider ?? undefined;
      const { system } = assemblePrompt(task, envelope, undefined, undefined, autonomyInstruction, provider);

      const llmMessages: ArchitectMessage[] = [{ role: 'system', content: system }];
      const recentMessages = this.messages.slice(-20);
      for (const msg of recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') llmMessages.push({ role: msg.role, content: msg.content });
      }

      const userContentBlocks = this._buildUserContentBlocks(text);
      if (llmMessages.length > 1 && llmMessages[llmMessages.length - 1].role === 'user') {
        llmMessages[llmMessages.length - 1] = { role: 'user', content: userContentBlocks };
      } else {
        llmMessages.push({ role: 'user', content: userContentBlocks });
      }

      await this.postMessage({ type: 'stream-start' });

      let tools: ToolDefinition[] = [];
      if (this.mcpClient?.isConnected) {
        try {
          const raw = await this.mcpClient.listTools();
          tools = raw.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: (t.inputSchema ?? {}) as Record<string, unknown> }));
        } catch {
          // proceed without MCP tools
        }
      }
      for (const lt of LOCAL_TOOL_DEFINITIONS) {
        tools.push({ name: lt.name, description: lt.description, inputSchema: lt.inputSchema as Record<string, unknown> });
      }

      let fullContent = '';
      if (tools.length > 0) {
        fullContent = await this.runAgenticLoop(llmMessages, tools);
      } else {
        const req = this._createRequestSignal();
        try {
          await this.architectLlm.stream(llmMessages, (chunk: string) => {
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
      };
      this.messages.push(assistantMessage);
      await this.persistMessages();
      this.attachments = [];
      await this._syncAttachments();

      // Autonomy: analyze the pass and decide whether to continue
      if (this._autonomyEnabled) {
        await this._handleAutonomyPassComplete(redactedFullContent, assistantMessage.id ?? '', llmMessages, tools);
      }
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      const displayText = isAbort ? 'Generation stopped.' : `Error: ${errorText}`;
      const errMsg: ChatMessage = { id: this._createMessageId(), role: 'system', content: displayText, timestamp: new Date().toISOString(), instanceId: this.currentInstanceId };
      this.messages.push(errMsg);
      await this.persistMessages();
      await this.postMessage({ type: 'addMessage', message: errMsg, actions: this._buildMessageActions(errMsg), roleMeta: this._roleMetaFor(errMsg), contextFooter: this._contextFooterFor(errMsg) });
    } finally {
      this.resetStreamState();
    }
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
    const child = new AbortController();
    const timer = setTimeout(() => child.abort(new Error(`LLM request timed out after ${timeoutMs / 1000}s`)), timeoutMs);

    const onParentAbort = () => {
      clearTimeout(timer);
      child.abort(this.abortController?.signal.reason ?? 'User stopped generation');
    };

    if (this.abortController?.signal.aborted) {
      clearTimeout(timer);
      child.abort(this.abortController.signal.reason);
    } else {
      this.abortController?.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    return {
      signal: child.signal,
      dispose: () => {
        clearTimeout(timer);
        this.abortController?.signal.removeEventListener('abort', onParentAbort);
      },
    };
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
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

  private _contextFooterFor(message: ChatMessage): string {
    const scope = message.instanceId ?? this.currentInstanceId;
    if (message.role === 'assistant') {
      return `Instance: ${scope} • Actions require explicit click • Trace reflects real tool execution`;
    }
    if (message.role === 'user') {
      return `Instance: ${scope}`;
    }
    return `Instance: ${scope} • System message`;
  }

  private _applyRenderLimits(content: string): { content: string; truncated: boolean } {
    if (content.length <= ChatPanel.MAX_RENDERED_MESSAGE_CHARS) {
      return { content, truncated: false };
    }
    const clipped = content.slice(0, ChatPanel.MAX_RENDERED_MESSAGE_CHARS);
    return {
      content: `${clipped}\n\n[Response truncated]`,
      truncated: true,
    };
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
    const explicitUris = new Set(Array.from(content.matchAll(/\b[a-z-]+:\/\/([A-Za-z0-9._/-]+)/g)).map((match) => match[1]));
    const candidates = Array.from(content.matchAll(/\b(?:feature|workflow|ADR|tension|entity|data model)\s+([A-Z][A-Za-z0-9._-]{1,80})\b/g))
      .map((match) => match[1])
      .filter((name) => !explicitUris.has(name));
    const deduped = Array.from(new Set(candidates));
    return {
      names: deduped.slice(0, ChatPanel.MAX_ENTITY_LINKS_PER_MESSAGE),
      truncated: deduped.length > ChatPanel.MAX_ENTITY_LINKS_PER_MESSAGE,
    };
  }

  private _formatImplicitEntityNotice(result: ImplicitEntityDetectionResult): string {
    if (result.names.length === 0) {
      return '';
    }
    const prefix = 'Implicit entity references detected: ';
    const body = result.names.join(', ');
    const suffix = result.truncated ? ' … [Entity link cap reached]' : '';
    return `${prefix}${body}${suffix}`;
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

  private async restoreMessages(): Promise<void> {
    if (!this.memory) return;
    const saved = await this.memory.load(this.currentInstanceId);
    const scoped = (saved as ChatMessage[]).filter((message) => !message.instanceId || message.instanceId === this.currentInstanceId);
    this.messages.splice(0, this.messages.length, ...scoped.map((message) => ({ ...message, instanceId: message.instanceId ?? this.currentInstanceId })));
    this._hoverActionStateByMessage.clear();
    await this.postState();
  }

  private _sendModelUpdate(): void {
    const provider = this.architectLlm?.currentConfig?.provider ?? '';
    const model = this.architectLlm?.currentConfig?.model ?? '';
    const models = provider === 'anthropic' ? ANTHROPIC_MODELS : provider === 'openai' ? OPENAI_MODELS : [];
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
      const models = provider === 'anthropic' ? ANTHROPIC_MODELS : provider === 'openai' ? OPENAI_MODELS : [];
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
    const result = analyzePass(this._autonomyState, { content, actions });

    // Broadcast actions to webview
    if (result.actionSet.actions.length > 0) {
      void this.postMessage({
        type: 'recommendedActions',
        messageId,
        actions: result.actionSet.actions.map((a) => ({ id: a.id, label: a.label, rationale: a.rationale })),
        doAllEligible: result.actionSet.doAllEligible,
      });
    }

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
      // Stopped — update status and show reason
      this._broadcastAutonomyStatus();
      if (result.decision.reason) {
        const statusView = deriveAutonomyStatusView(this._autonomyState);
        const stopText = `*${result.decision.reason}* ${statusView.countingActive ? `[${statusView.summary}]` : ''}`;
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
    if (this._autonomyContinuing) return; // prevent re-entrancy
    this._autonomyContinuing = true;

    try {
      // Build continuation message
      const userMessage: ChatMessage = {
        id: this._createMessageId(),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
      };
      this.messages.push(userMessage);
      await this.persistMessages();

      this.streaming = true;
      this.streamingContent = '';
      this._lastToolTrace = [];
      this._lastVerdict = null;
      this.abortController = new AbortController();

      const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(prompt) : null;
      const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
      const autonomyInstruction: AutonomyInstructionState = { ...this._autonomyState, enabled: true };
      const provider = this.architectLlm?.provider ?? undefined;
      const { system } = assemblePrompt(task, envelope, undefined, undefined, autonomyInstruction, provider);

      const llmMessages: ArchitectMessage[] = [{ role: 'system', content: system }];
      const recentMessages = this.messages.slice(-20);
      for (const msg of recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') llmMessages.push({ role: msg.role, content: msg.content });
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
      };
      this.messages.push(assistantMessage);
      await this.persistMessages();

      await this.postMessage({ type: 'stream-end', done: true });
      await this.postMessage({
        type: 'addMessage',
        message: assistantMessage,
        actions: this._buildMessageActions(assistantMessage),
        roleMeta: this._roleMetaFor(assistantMessage),
        contextFooter: this._contextFooterFor(assistantMessage),
      });

      if (this._lastVerdict) {
        void this.postMessage({ type: 'verdict', verdict: this._lastVerdict });
      }
      if (this._lastToolTrace.length > 0) {
        void this.postMessage({ type: 'toolTrace', calls: [...this._lastToolTrace] });
      }

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

  private async _executeRecommendedAction(actionId: string): Promise<void> {
    const action = this._lastRecommendedActions.find((a) => a.id === actionId);
    if (!action) return;
    await this.handleUserMessage(action.label);
  }

  private async _executeAllRecommendedActions(): Promise<void> {
    const labels = this._lastRecommendedActions
      .filter((a) => a.eligible && a.withinScope)
      .map((a) => a.label);
    if (labels.length === 0) return;
    const combined = `Execute these steps sequentially:\n${labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}`;
    await this.handleUserMessage(combined);
  }
  private static readonly SECRET_PATTERNS = [
    /(?:api[_-]?key|secret|token|password|passwd|auth)\s*[:=]\s*\S+/gi,
    /(?:sk-|pk-|ghp_|gho_|github_pat_)\S+/g,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/g,
  ];
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
    return ChatPanel.TOOL_TIMEOUT_MS[toolName] ?? ChatPanel.TOOL_TIMEOUT_MS._default;
  }

  private async runAgenticLoop(llmMessages: ArchitectMessage[], tools: ToolDefinition[]): Promise<string> {
    if (!this.architectLlm) return '';

    let fullContent = '';
    // rawMessages tracks the full conversation in Anthropic-native format
    // (assistant messages with tool_use blocks, user messages with tool_result blocks).
    // Both Anthropic and OpenAI providers accept this via callWithTools(…, rawMessages).
    let rawMessages: unknown[] | undefined;

    for (let iteration = 0; iteration < ChatPanel.MAX_TOOL_ITERATIONS; iteration++) {
      // Throttle between iterations to avoid TPM rate limits on fast tool loops
      if (iteration > 0) await new Promise((r) => setTimeout(r, 2000));

      // Show thinking indicator while waiting for the non-streaming API call
      void this.postMessage({ type: 'stream-thinking', active: true });

      // Create a per-iteration signal with hard timeout (P2) linked to user abort (P1)
      const req = this._createRequestSignal();
      let response: Awaited<ReturnType<ArchitectLlm['callWithTools']>>;
      try {
        response = await this._callWithToolsRetry(llmMessages, tools, rawMessages, req.signal);
      } catch (err) {
        // Ensure thinking indicator is hidden before the error propagates
        void this.postMessage({ type: 'stream-thinking', active: false });
        throw err;
      } finally {
        req.dispose();
      }

      // Hide thinking indicator now that we have a response
      void this.postMessage({ type: 'stream-thinking', active: false });

      // Stream any text content to the webview
      if (response.content) {
        const safeContent = this._redactSecrets(response.content);
        fullContent += safeContent;
        // Guard: cap streamingContent to prevent unbounded memory growth across
        // many tool iterations. The webview receives each chunk regardless — only
        // the in-memory accumulator is capped.
        if (this.streamingContent.length < ChatPanel.MAX_STREAMING_CONTENT_CHARS) {
          this.streamingContent += safeContent;
        }
        void this.postMessage({ type: 'stream-chunk', chunk: safeContent });
      }

      // If no tool calls, we're done
      if (response.stopReason !== 'tool_use' || response.toolCalls.length === 0) {
        break;
      }

      // Build the assistant message with tool_use blocks (Anthropic format)
      const assistantBlocks: unknown[] = [];
      if (response.content) {
        assistantBlocks.push({ type: 'text', text: response.content });
      }
      for (const tc of response.toolCalls) {
        assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }

      // Execute each tool call and collect results
      const toolResultBlocks: unknown[] = [];
      for (const tc of response.toolCalls) {
        // Show tool execution status (P4)
        const statusChunk = `\n\n⚡ Running \`${tc.name}\`…\n`;
        fullContent += statusChunk;
        if (this.streamingContent.length < ChatPanel.MAX_STREAMING_CONTENT_CHARS) {
          this.streamingContent += statusChunk;
        }
        void this.postMessage({ type: 'stream-chunk', chunk: statusChunk });
        void this.postMessage({ type: 'tool-progress', tool: tc.name, message: 'started' });

        const toolTimeout = ChatPanel._toolTimeoutMs(tc.name);
        const startedAt = Date.now();
        let result: string;
        let status: 'completed' | 'failed' = 'completed';
        try {
          if (isLocalTool(tc.name)) {
            // Wrap local tool with per-tool timeout (P5)
            const raw = await Promise.race([
              executeLocalTool(tc.name, tc.input),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Local tool "${tc.name}" timed out after ${toolTimeout / 1000}s`)), toolTimeout),
              ),
            ]);
            result = typeof raw === 'string' ? raw : JSON.stringify(raw);
          } else if (this.mcpClient?.isConnected) {
            // Pass per-tool timeout + progress callback (P4 + P5)
            const raw = await this.mcpClient.callTool(
              tc.name,
              tc.input,
              toolTimeout,
              (message, progress, total) => {
                void this.postMessage({ type: 'tool-progress', tool: tc.name, message, progress, total });
              },
            );
            result = typeof raw === 'string' ? raw : JSON.stringify(raw);
          } else {
            result = JSON.stringify({ error: `Tool "${tc.name}" is not available — MCP client is not connected.` });
            status = 'failed';
          }
        } catch (err: unknown) {
          status = 'failed';
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }

        this._lastToolTrace.push({
          tool: tc.name,
          argsSummary: this._summarizeToolArgs(tc.input),
          filesAffected: this._extractFilesAffected(tc.input, result),
          durationMs: Date.now() - startedAt,
          status,
        });

        // Show tool completion (P4)
        const doneChunk = `✓ \`${tc.name}\` done\n`;
        fullContent += doneChunk;
        if (this.streamingContent.length < ChatPanel.MAX_STREAMING_CONTENT_CHARS) {
          this.streamingContent += doneChunk;
        }
        void this.postMessage({ type: 'stream-chunk', chunk: doneChunk });
        void this.postMessage({ type: 'tool-progress', tool: tc.name, message: 'completed' });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: this._redactSecrets(result),
        });
      }

      // Build rawMessages for the next iteration.
      // First call: seed from the original llmMessages (non-system only).
      if (!rawMessages) {
        rawMessages = llmMessages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content }));
      }

      // Append assistant turn (with tool_use blocks) and user turn (with tool_result blocks)
      rawMessages.push({ role: 'assistant', content: assistantBlocks });
      rawMessages.push({ role: 'user', content: toolResultBlocks });
    }

    return fullContent;
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
    const libs: Array<{ key: 'md' | 'dp'; relPath: string; name: string }> = [
      { key: 'md', relPath: path.join('node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'), name: 'markdown-it' },
      { key: 'dp', relPath: path.join('node_modules', 'dompurify', 'dist', 'purify.min.js'), name: 'DOMPurify' },
    ];
    for (const lib of libs) {
      try {
        const fullPath = path.join(extPath, lib.relPath);
        const src = fs.readFileSync(fullPath, 'utf-8');
        if (lib.key === 'md') this._markdownItSource = src;
        else this._domPurifySource = src;
      } catch (err) {
        console.error(`[DreamGraph] Failed to load ${lib.name} browser build — falling back to plaintext rendering. ${err instanceof Error ? err.message : String(err)}`);
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
    return ChatPanel.SECRET_PATTERNS.reduce((text, pattern) =>
      text.replace(pattern, (match) => {
        const sepMatch = match.match(/[:=]\s*/);
        if (sepMatch && typeof sepMatch.index === 'number') {
          return match.slice(0, sepMatch.index + sepMatch[0].length) + '****';
        }
        return match.slice(0, 8) + '****';
      }),
      content,
    );
  }

  private async _executeMessageActionTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    const startedAt = Date.now();
    let status: 'completed' | 'failed' = 'completed';
    try {
      if (isLocalTool(toolName)) {
        return await executeLocalTool(toolName, input);
      }
      if (!this.mcpClient?.isConnected) {
        throw new Error(`Tool "${toolName}" is not available — MCP client is not connected.`);
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

  private _summarizeToolArgs(input: unknown): string {
    if (!input || typeof input !== 'object') return 'no args';
    const keys = Object.keys(input as Record<string, unknown>).slice(0, 4);
    return keys.length > 0 ? keys.join(', ') : 'no args';
  }

  private _deriveVerdict(content: string, trace: ToolTraceEntry[]): VerdictBanner {
    const normalized = content.toLowerCase();
    const failedCount = trace.filter((t) => t.status === 'failed').length;
    if (normalized.includes('verified:') || normalized.includes('confirmed:') || (trace.length > 0 && failedCount === 0)) {
      return {
        level: 'verified',
        summary: failedCount === 0 && trace.length > 0
          ? `Verified with ${trace.length} executed tool call${trace.length === 1 ? '' : 's'}.`
          : 'Verified based on explicit evidence in the response.',
      };
    }
    if (failedCount > 0 || normalized.includes('likely') || normalized.includes('partial')) {
      return {
        level: 'partial',
        summary: failedCount > 0
          ? `Partial confidence: ${failedCount} tool call${failedCount === 1 ? '' : 's'} failed during evidence gathering.`
          : 'Partial confidence: the response includes uncertainty or incomplete evidence.',
      };
    }
    return {
      level: 'speculative',
      summary: 'Speculative synthesis: no strong verification signals were detected.',
    };
  }

  private _extractFilesAffected(input: unknown, result: string): string[] {
    const found = new Set<string>();
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        if (/^[A-Za-z]:\\|^\.|^src\/|^extensions\//.test(value) || /\.(ts|tsx|js|jsx|json|md|css|html)$/i.test(value)) {
          found.add(value);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value && typeof value === 'object') {
        Object.values(value as Record<string, unknown>).forEach(visit);
      }
    };
    visit(input);
    if (found.size === 0) visit(result);
    return Array.from(found).slice(0, 5);
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
    <span class="thinking-dots"><span></span><span></span><span></span></span>
    <span id="thinking-label">Dreaming…</span>
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
      div.textContent = text;
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
          .map((a) => a.getAttribute('data-entity-name') || a.textContent || '')
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
        const name = (link.getAttribute('data-entity-name') || link.textContent || '').trim();
        const status = results?.[name]?.status || 'unverified';
        link.classList.remove('entity-verified', 'entity-latent', 'entity-tension', 'entity-unverified');
        link.classList.add('entity-' + status);
      }
    }

    function renderAssistantBody(message) {
      const wrapper = document.createElement('div');
      wrapper.className = 'markdown-body';
      const renderMarkdown = window.renderMarkdown || ((s) => escapeHtml(s));
      let html = renderMarkdown(message.content || '');
      if (typeof window.linkifyEntities === 'function') {
        html = window.linkifyEntities(html) || html;
      }
      wrapper.innerHTML = html;
      if (typeof window.applyEntityLinks === 'function') {
        window.applyEntityLinks(wrapper);
      }
      return wrapper;
    }

    function createMessageNode(message, actions, roleMeta, contextFooter) {
      const bubble = document.createElement('div');
      bubble.className = 'message ' + message.role;
      bubble.dataset.messageId = message.id || '';
      if (roleMeta) bubble.appendChild(createRoleHeader(roleMeta, message.id));

      if (message.role === 'assistant') {
        const body = renderAssistantBody(message);
        bubble.appendChild(body);
        const verdict = renderVerdictBanner(lastVerdict);
        if (verdict) bubble.appendChild(verdict);
        const implicit = renderImplicitEntityNotice(message.implicitEntityNotice);
        if (implicit) bubble.appendChild(implicit);
        const trace = renderToolTrace(lastToolTrace);
        if (trace) bubble.appendChild(trace);
        bubble.appendChild(renderProvenance(message, lastToolTrace));
        const actionBlock = renderMessageActions(message, actions);
        if (actionBlock) bubble.appendChild(actionBlock);
        const footer = renderContextFooter(contextFooter);
        if (footer) bubble.appendChild(footer);
        scheduleVerification(body);
      } else {
        bubble.textContent = message.content || '';
        const footer = renderContextFooter(contextFooter);
        if (footer) bubble.appendChild(footer);
      }
      return bubble;
    }

    function addMessage(message, actions, roleMeta, contextFooter) {
      setEmptyStateVisible(false);
      const node = createMessageNode(message, actions, roleMeta, contextFooter);
      messagesEl.appendChild(node);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function rerenderMessageActions(messageId) {
      const bubble = messagesEl.querySelector('.message[data-message-id="' + messageId + '"]');
      if (!bubble) return;
      const state = vscode.getState() || {};
      const messages = state.messages || [];
      const entry = messages.find((m) => m.message?.id === messageId);
      if (!entry) return;
      bubble.remove();
      addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter);
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
      sendBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';
      thinkingEl.style.display = 'flex';
    }

    function updateStreaming(chunk) {
      if (!streamingBubble || !streamingMarkdownEl) return;
      streamingRaw += chunk;
      const renderMarkdown = window.renderMarkdown || ((s) => escapeHtml(s));
      let html = renderMarkdown(streamingRaw);
      if (typeof window.linkifyEntities === 'function') {
        html = window.linkifyEntities(html) || html;
      }
      streamingMarkdownEl.innerHTML = html;
      if (typeof window.applyEntityLinks === 'function') {
        window.applyEntityLinks(streamingMarkdownEl);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function endStreaming() {
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
            ? 'Instance: ' + (message.instanceId || 'default')
            : 'Instance: ' + (message.instanceId || 'default') + ' • System message',
      }));
      vscode.setState({ ...(vscode.getState() || {}), messages: entries });
      messagesEl.innerHTML = '';
      if (entries.length === 0) {
        setEmptyStateVisible(true);
        return;
      }
      setEmptyStateVisible(false);
      for (const entry of entries) {
        addMessage(entry.message, entry.actions, entry.roleMeta, entry.contextFooter);
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
          const row = document.createElement('div');
          row.className = 'tool-row';
          row.innerHTML = '<span class="tool-name">' + escapeHtml(msg.tool || 'tool') + '</span><span>' + escapeHtml(msg.message || '') + '</span>';
          toolProgressListEl.appendChild(row);
          break;
        }
        case 'addMessage': {
          const state = vscode.getState() || {};
          const entries = [...(state.messages || []), {
            message: msg.message,
            actions: msg.actions || [],
            roleMeta: msg.roleMeta,
            contextFooter: msg.contextFooter,
          }];
          vscode.setState({ ...state, messages: entries });
          addMessage(msg.message, msg.actions || [], msg.roleMeta, msg.contextFooter);
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
