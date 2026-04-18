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
import type { ChatMemory } from './chat-memory';
import type { GraphSignalProvider } from './graph-signal';
import {
  type ArchitectContentBlock,
  type ArchitectLlm,
  type ArchitectMessage,
  type ArchitectModelCapabilities,
} from './architect-llm';
import type { McpClient } from './mcp-client';
import type { ContextBuilder } from './context-builder';
import type { ChangedFilesView } from './changed-files-view';
import { assemblePrompt, inferTask } from './prompts/index.js';
import { createAutonomyState, deriveAutonomyStatusView, getAutonomyInstructionBlock } from './autonomy.js';
import { getAutonomyMode, getAutonomyPassBudget, getReportingInstructionBlock, parseAutonomyRequest } from './reporting.js';
import { renderAutonomyStatusHtml } from './webview/autonomy-status.js';
import {
  createSessionAutonomyModel,
  renderSessionAutonomyMeta,
  withAutonomyStatus,
  withRunningAction,
  withSelectedAction,
  withStoppedAction,
} from './webview/session-model.js';

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

interface AttachmentPreview {
  id: string;
  name: string;
  kind: 'text' | 'image';
  mimeType: string;
  size: number;
  note?: string;
}

interface PromptAttachment extends AttachmentPreview {
  path: string;
  textContent?: string;
  dataBase64?: string;
}

interface EntityVerification {
  status: 'verified' | 'latent' | 'unverified' | 'tension';
  confidence: number;
  lastValidated?: string;
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
  | { type: 'autonomyStatus'; html: string }
  | { type: 'sessionAutonomyMeta'; html: string };

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
  | { type: 'openExternalLink'; url: string }
  | { type: 'copyToClipboard'; text: string }
  | { type: 'navigateEntity'; uri: string }
  | { type: 'openFile'; path: string }
  | { type: 'verifyEntities'; requestId: string; names: string[] };

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
  private draftText = '';
  private attachments: PromptAttachment[] = [];
  private autonomyState = createAutonomyState(getAutonomyMode(), getAutonomyPassBudget());
  private recommendedActionsByMessageId = new Map<string, import('./autonomy.js').RecommendedActionSet>();
  private sessionAutonomyState = createSessionAutonomyModel();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public setGraphSignal(provider: GraphSignalProvider): void { this.graphSignal = provider; }
  public setMemory(memory: ChatMemory): void { this.memory = memory; }
  public setArchitectLlm(llm: ArchitectLlm): void { this.architectLlm = llm; }
  public setContextBuilder(cb: ContextBuilder): void { this.contextBuilder = cb; }
  public setMcpClient(mcp: McpClient): void { this.mcpClient = mcp; }
  public setChangedFilesProvider(provider: ChangedFilesView): void { this.changedFilesView = provider; }
  public setInstance(instanceId: string): void { this.currentInstanceId = instanceId; }
  public get isVisible(): boolean { return this.view?.visible ?? false; }
  public open(): void { void vscode.commands.executeCommand('dreamgraph.chatView.focus'); }

  public addExternalMessage(role: ChatRole, content: string): void {
    const msg: ChatMessage = {
      id: this._createMessageId(),
      role,
      content,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };
    this.messages.push(msg);
    void this.postMessage({ type: 'addMessage', message: msg, contextFooter: this.getAutonomyFooter() });
    void this.postAutonomyStatus();
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready':
          await this.postState();
          await this.postAutonomyStatus();
          await this.postSessionAutonomyMeta();
          break;
        case 'send':
          if (message.text.trim()) await this.handleUserMessage(message.text.trim());
          break;
        case 'runMessageAction':
          await this.handleRecommendedActionSelection(message.messageId, message.actionId);
          break;
        case 'openFile': {
          const filePath = message.path;
          if (typeof filePath === 'string' && filePath.trim().length > 0) {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.context.extensionPath;
            const resolved = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved));
            await vscode.window.showTextDocument(doc, { preview: false });
          }
          break;
        }
      }
    }, null, this.disposables);
  }

  public dispose(): void {
    while (this.disposables.length > 0) this.disposables.pop()?.dispose();
  }

  private async handleUserMessage(text: string): Promise<void> {
    this.autonomyState = parseAutonomyRequest(text, this.autonomyState);
    this.sessionAutonomyState = withAutonomyStatus(
      this.sessionAutonomyState,
      renderAutonomyStatusHtml(deriveAutonomyStatusView(this.autonomyState)),
    );
    await this.postAutonomyStatus();
    await this.postSessionAutonomyMeta();

    const userMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };
    this.messages.push(userMessage);
    await this.postMessage({ type: 'addMessage', message: userMessage, contextFooter: this.getAutonomyFooter() });

    if (!this.architectLlm) {
      await this.postMessage({
        type: 'addMessage',
        message: {
          id: this._createMessageId(),
          role: 'system',
          content: 'Architect LLM is not configured.',
          timestamp: new Date().toISOString(),
          instanceId: this.currentInstanceId,
        },
        contextFooter: this.getAutonomyFooter(),
      });
      return;
    }

    await this.executePassLoop(text);
  }

  private async executePassLoop(initialPrompt: string): Promise<void> {
    let currentPrompt = initialPrompt;
    let continueLoop = true;
    this.sessionAutonomyState = withRunningAction(this.sessionAutonomyState, 'Architect pass loop active');
    await this.postSessionAutonomyMeta();

    while (continueLoop) {
      const outcome = await this.runArchitectPass(currentPrompt);
      if (!outcome) {
        this.sessionAutonomyState = withStoppedAction(this.sessionAutonomyState, 'Stopped: no pass outcome produced');
        await this.postSessionAutonomyMeta();
        return;
      }

      await this.postMessage({
        type: 'addMessage',
        message: outcome.message,
        contextFooter: this.getAutonomyFooter(),
        actions: this.toMessageActions(outcome.message.id!, outcome.analysis.actionSet),
      });

      if (outcome.analysis.actionSet.actions.length > 0) {
        this.recommendedActionsByMessageId.set(outcome.message.id!, outcome.analysis.actionSet);
      }

      if (!outcome.analysis.decision.shouldContinue || !outcome.analysis.nextPrompt) {
        this.sessionAutonomyState = withStoppedAction(this.sessionAutonomyState, outcome.analysis.decision.reason);
        await this.postAutonomyStatus();
        await this.postSessionAutonomyMeta();
        continueLoop = false;
        break;
      }

      this.autonomyState = outcome.nextState;
      this.sessionAutonomyState = withRunningAction(
        this.sessionAutonomyState,
        outcome.analysis.selectedActionId
          ? `Continuing with ${outcome.analysis.actionSet.actions.find((a) => a.id === outcome.analysis.selectedActionId)?.label ?? outcome.analysis.selectedActionId}`
          : 'Continuing with strongest next step',
      );
      await this.postAutonomyStatus();
      await this.postSessionAutonomyMeta();
      currentPrompt = outcome.analysis.nextPrompt;

      const systemNotice: ChatMessage = {
        id: this._createMessageId(),
        role: 'system',
        content: outcome.analysis.selectedActionId
          ? `${outcome.analysis.decision.reason} Selected next action: ${outcome.analysis.actionSet.actions.find((a) => a.id === outcome.analysis.selectedActionId)?.label ?? outcome.analysis.selectedActionId}`
          : outcome.analysis.decision.reason,
        timestamp: new Date().toISOString(),
        instanceId: this.currentInstanceId,
      };
      this.messages.push(systemNotice);
      await this.postMessage({ type: 'addMessage', message: systemNotice, contextFooter: this.getAutonomyFooter() });
    }
  }

  private async handleRecommendedActionSelection(messageId: string, actionId: string): Promise<void> {
    const actionSet = this.recommendedActionsByMessageId.get(messageId);
    if (!actionSet) {
      return;
    }

    const selectedActions = actionId === '__do_all__'
      ? (actionSet.doAllEligible ? actionSet.actions : [])
      : actionSet.actions.filter((action) => action.id === actionId);

    if (selectedActions.length === 0) {
      return;
    }

    this.sessionAutonomyState = withSelectedAction(
      this.sessionAutonomyState,
      messageId,
      selectedActions.map((action) => action.id),
      actionId === '__do_all__'
        ? `User selected Do all for ${selectedActions.length} steps`
        : `User selected ${selectedActions[0].label}`,
    );
    await this.postSessionAutonomyMeta();

    const prompt = actionId === '__do_all__'
      ? `Continue by completing all recommended compatible next steps in order: ${selectedActions.map((action) => action.label).join('; ')}. Keep reporting after each pass and stop when the original goal is sufficiently reached or progress stalls.`
      : `Continue with the selected recommended next step: ${selectedActions[0].label}. Keep reporting after each pass and stop when the original goal is sufficiently reached or progress stalls.`;

    const notice: ChatMessage = {
      id: this._createMessageId(),
      role: 'system',
      content: actionId === '__do_all__'
        ? `User selected Do all for ${selectedActions.length} recommended next steps.`
        : `User selected recommended next step: ${selectedActions[0].label}`,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };
    this.messages.push(notice);
    await this.postMessage({ type: 'addMessage', message: notice, contextFooter: this.getAutonomyFooter() });
    await this.postAutonomyStatus();
    await this.postSessionAutonomyMeta();
    await this.executePassLoop(prompt);
  }

  private async runArchitectPass(text: string): Promise<{ message: ChatMessage; analysis: import('./autonomy-loop.js').PassAnalysisResult; nextState: import('./autonomy.js').AutonomyState } | undefined> {
    const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(text) : null;
    const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
    const { getStructuredResponseContractBlock } = await import('./autonomy-contract.js');
    const { extractStructuredPassEnvelope, buildRecommendedActionSetFromContent } = await import('./autonomy-structured.js');
    const { analyzePass, advanceAutonomyStateIfContinued } = await import('./autonomy-loop.js');
    const { system } = assemblePrompt(
      task,
      envelope,
      undefined,
      [
        getReportingInstructionBlock(),
        getAutonomyInstructionBlock({ ...this.autonomyState, enabled: true }),
        getStructuredResponseContractBlock(),
      ].filter(Boolean).join('\n\n'),
    );
    const llmMessages: ArchitectMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: this._buildUserContentBlocks(text) }
    ];

    await this.postMessage({ type: 'stream-start' });
    let content = '';
    await this.architectLlm!.stream(llmMessages, (chunk: string) => {
      content += chunk;
      void this.postMessage({ type: 'stream-chunk', chunk });
    });
    await this.postMessage({ type: 'stream-end', done: true });

    const message: ChatMessage = {
      id: this._createMessageId(),
      role: 'assistant',
      content,
      fullContent: content,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };
    this.messages.push(message);

    const parsedEnvelope = extractStructuredPassEnvelope(content);
    const analysis = analyzePass(this.autonomyState, { content, actions: buildRecommendedActionSetFromContent(content).actions });

    if (parsedEnvelope.goalStatus === 'complete' && analysis.decision.shouldContinue) {
      analysis.decision.shouldContinue = false;
      analysis.decision.reason = 'Stopped: structured contract marked goal_status=complete.';
      analysis.nextPrompt = undefined;
    }

    if (parsedEnvelope.progressStatus === 'stalled' && analysis.decision.shouldContinue) {
      analysis.decision.shouldContinue = false;
      analysis.decision.reason = 'Stopped: structured contract marked progress_status=stalled.';
      analysis.nextPrompt = undefined;
    }

    const nextState = advanceAutonomyStateIfContinued(this.autonomyState, analysis.decision);
    return { message, analysis, nextState };
  }

  private toMessageActions(messageId: string, actionSet: import('./autonomy.js').RecommendedActionSet): MessageAction[] {
    const actions: MessageAction[] = actionSet.actions.map((action, index) => ({
      id: action.id,
      label: action.label,
      kind: index === 0 ? 'primary' : 'secondary',
      actionType: 'tool',
    }));
    if (actionSet.doAllEligible) {
      actions.push({ id: '__do_all__', label: 'Do all', kind: 'secondary', actionType: 'tool' });
    }
    return actions;
  }

  private getAutonomyFooter(): string {
    return deriveAutonomyStatusView(this.autonomyState).summary;
  }

  private async postAutonomyStatus(): Promise<void> {
    const html = renderAutonomyStatusHtml(deriveAutonomyStatusView(this.autonomyState));
    this.sessionAutonomyState = withAutonomyStatus(this.sessionAutonomyState, html);
    await this.postMessage({ type: 'autonomyStatus', html });
  }

  private async postSessionAutonomyMeta(): Promise<void> {
    await this.postMessage({ type: 'sessionAutonomyMeta', html: renderSessionAutonomyMeta(this.sessionAutonomyState) });
  }

  private _buildUserContentBlocks(text: string): ArchitectContentBlock[] {
    return [{ type: 'text', text }];
  }

  private async postState(): Promise<void> {
    await this.postMessage({ type: 'state', state: { messages: this.messages } });
  }

  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    await this.view?.webview.postMessage(message);
  }

  private _createMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DreamGraph Chat</title>
  <style>
    body { font-family: var(--vscode-font-family); padding: 0; margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .dg-shell { display: flex; flex-direction: column; height: 100vh; }
    .dg-autonomy-status-host { position: sticky; top: 0; z-index: 10; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 12px; }
    .dg-session-meta-host { position: sticky; top: 42px; z-index: 9; background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-panel-border); padding: 4px 12px 8px; }
    .dg-autonomy-status { display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; }
    .dg-autonomy-mode, .dg-autonomy-counter, .dg-session-badge { padding: 2px 8px; border-radius: 999px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .dg-session-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; }
    .dg-session-note { opacity: 0.85; }
    .dg-messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .dg-message { border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 10px; }
    .dg-message.user { background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent); }
    .dg-message.system { background: color-mix(in srgb, var(--vscode-textBlockQuote-background) 60%, transparent); }
    .dg-message-role { font-size: 11px; text-transform: uppercase; opacity: 0.7; margin-bottom: 6px; }
    .dg-message-footer { margin-top: 8px; font-size: 11px; opacity: 0.75; }
    .dg-rec-actions { margin-top: 10px; }
    .dg-rec-actions-label { font-size: 11px; opacity: 0.8; margin-bottom: 6px; }
    .dg-rec-actions-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    .dg-rec-action, .dg-send { border: 1px solid var(--vscode-button-border, transparent); border-radius: 6px; padding: 6px 10px; cursor: pointer; }
    .dg-rec-action.primary, .dg-send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .dg-rec-action.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .dg-composer { border-top: 1px solid var(--vscode-panel-border); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .dg-input { width: 100%; box-sizing: border-box; resize: vertical; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 6px; padding: 8px; }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="${this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'))}"></script>
</body>
</html>`;
  }
}
