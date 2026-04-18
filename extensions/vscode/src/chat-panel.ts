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
import { getRenderScript } from './webview/render-markdown.js';
import type { GraphSignalProvider } from './graph-signal';
import {
  type ArchitectContentBlock,
  type ArchitectLlm,
  type ArchitectMessage,
  type ArchitectModelCapabilities,
  type ArchitectProvider,
  type ToolDefinition,
} from './architect-llm';
import type { McpClient } from './mcp-client';
import type { ContextBuilder } from './context-builder';
import type { ChangedFilesView } from './changed-files-view';
import { LOCAL_TOOL_DEFINITIONS } from './local-tools.js';
import { assemblePrompt, inferTask } from './prompts/index.js';
import { getReportingInstructionBlock } from './reporting.js';

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
  | { type: 'verdict'; verdict: VerdictBanner };

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
  private streaming = false;
  private draftText = '';
  private attachments: PromptAttachment[] = [];

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
    void this.postMessage({ type: 'addMessage', message: msg });
  }

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready':
          await this.postState();
          break;
        case 'send':
          if (message.text.trim()) await this.handleUserMessage(message.text.trim());
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
    const userMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };
    this.messages.push(userMessage);
    await this.postMessage({ type: 'addMessage', message: userMessage });

    if (!this.architectLlm) {
      await this.postMessage({
        type: 'addMessage',
        message: {
          id: this._createMessageId(),
          role: 'system',
          content: 'Architect LLM is not configured.',
          timestamp: new Date().toISOString(),
          instanceId: this.currentInstanceId,
        }
      });
      return;
    }

    const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(text) : null;
    const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
    const { system } = assemblePrompt(task, envelope, undefined, getReportingInstructionBlock());
    const llmMessages: ArchitectMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: this._buildUserContentBlocks(text) }
    ];

    await this.postMessage({ type: 'stream-start' });
    let content = '';
    await this.architectLlm.stream(llmMessages, (chunk: string) => {
      content += chunk;
      void this.postMessage({ type: 'stream-chunk', chunk });
    });
    await this.postMessage({ type: 'stream-end', done: true });

    const assistantMessage: ChatMessage = {
      id: this._createMessageId(),
      role: 'assistant',
      content,
      fullContent: content,
      timestamp: new Date().toISOString(),
      instanceId: this.currentInstanceId,
    };
    this.messages.push(assistantMessage);
    await this.postMessage({ type: 'addMessage', message: assistantMessage });
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
</head>
<body>
  <div id="app"></div>
  <script>${getRenderScript()}</script>
</body>
</html>`;
  }
}
