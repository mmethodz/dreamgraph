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
import type { ChatMemory, PersistedMessage } from './chat-memory';
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

type ChatRole = 'user' | 'assistant' | 'system';

interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: string;
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

type ExtensionToWebviewMessage =
  | { type: 'addMessage'; message: ChatMessage }
  | { type: 'stream-start' }
  | { type: 'stream-chunk'; chunk: string }
  | { type: 'stream-end'; done: boolean }
  | { type: 'state'; state: { messages: ChatMessage[] } }
  | { type: 'updateModels'; providers: string[]; models: string[]; current: { provider: string; model: string }; capabilities: ArchitectModelCapabilities }
  | { type: 'setAttachments'; attachments: AttachmentPreview[] }
  | { type: 'error'; error: string }
  | { type: 'restoreDraft'; text: string };

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'pickAttachments' }
  | { type: 'removeAttachment'; id: string }
  | { type: 'pasteImage'; dataBase64: string; mimeType: string }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'changeProvider'; provider: string }
  | { type: 'changeModel'; model: string }
  | { type: 'setApiKey' }
  | { type: 'saveDraft'; text: string };

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

  private static readonly MAX_TEXT_ATTACHMENT_BYTES = 100_000;
  private static readonly MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;

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
    const msg: ChatMessage = { role, content, timestamp: new Date().toISOString() };
    this.messages.push(msg);
    void this.persistMessages();
    void this.postMessage({ type: 'addMessage', message: msg });
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
    const attachmentSummary = this._attachmentSummaryForUserMessage();
    const userMessage: ChatMessage = {
      role: 'user',
      content: attachmentSummary ? `${text}\n\n${attachmentSummary}` : text,
      timestamp: new Date().toISOString(),
    };

    this.messages.push(userMessage);
    await this.persistMessages();
    await this.postMessage({ type: 'addMessage', message: userMessage });

    if (!this.architectLlm || !this.architectLlm.isConfigured) {
      const errMsg: ChatMessage = {
        role: 'system',
        content: 'Architect LLM is not configured. Select provider and model in the header dropdowns, then set your API key.',
        timestamp: new Date().toISOString(),
      };
      this.messages.push(errMsg);
      await this.persistMessages();
      await this.postMessage({ type: 'addMessage', message: errMsg });
      return;
    }

    try {
      this.streaming = true;
      this.streamingContent = '';
      this.steeringQueue = [];
      this.abortController = new AbortController();

      const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(text) : null;
      const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
      const { system } = assemblePrompt(task, envelope);

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
        await this.architectLlm.stream(llmMessages, (chunk: string) => {
          fullContent += chunk;
          this.streamingContent += chunk;
          void this.postMessage({ type: 'stream-chunk', chunk });
        });
      }

      const assistantMessage: ChatMessage = { role: 'assistant', content: fullContent, timestamp: new Date().toISOString() };
      this.messages.push(assistantMessage);
      await this.persistMessages();
      await this.postMessage({ type: 'stream-end', done: true });
      this.attachments = [];
      await this._syncAttachments();
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err);
      const errMsg: ChatMessage = { role: 'system', content: `Error: ${errorText}`, timestamp: new Date().toISOString() };
      this.messages.push(errMsg);
      await this.persistMessages();
      await this.postMessage({ type: 'stream-end', done: true });
      await this.postMessage({ type: 'addMessage', message: errMsg });
    } finally {
      this.streaming = false;
      this.abortController = null;
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

  private async rehydrateWebview(): Promise<void> {
    await this.postState();
    if (this.draftText) await this.postMessage({ type: 'restoreDraft', text: this.draftText });
    await this._syncAttachments();
  }

  private async postState(): Promise<void> {
    await this.postMessage({ type: 'state', state: { messages: this.messages } });
  }

  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    await this.view?.webview.postMessage(message);
  }

  private async persistMessages(): Promise<void> {
    if (!this.memory) return;
    await this.memory.save(this.currentInstanceId, this.messages as PersistedMessage[]);
  }

  private async restoreMessages(): Promise<void> {
    if (!this.memory) return;
    const saved = await this.memory.load(this.currentInstanceId);
    this.messages.splice(0, this.messages.length, ...(saved as ChatMessage[]));
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
    await vscode.workspace.getConfiguration('dreamgraph.architect').update('provider', provider, vscode.ConfigurationTarget.Global);
    await this.architectLlm?.loadConfig();
    this._sendModelUpdate();
    await this._syncAttachments();
  }

  private async _changeModel(model: string): Promise<void> {
    await vscode.workspace.getConfiguration('dreamgraph.architect').update('model', model, vscode.ConfigurationTarget.Global);
    await this.architectLlm?.loadConfig();
    this._sendModelUpdate();
    await this._syncAttachments();
  }

  private async runAgenticLoop(llmMessages: ArchitectMessage[], tools: ToolDefinition[]): Promise<string> {
    if (!this.architectLlm) return '';
    return this.runAgenticLoopPlaceholder(llmMessages, tools);
  }

  private async runAgenticLoopPlaceholder(llmMessages: ArchitectMessage[], _tools: ToolDefinition[]): Promise<string> {
    let fullContent = '';
    await this.architectLlm!.stream(llmMessages, (chunk: string) => {
      fullContent += chunk;
      this.streamingContent += chunk;
      void this.postMessage({ type: 'stream-chunk', chunk });
    });
    return fullContent;
  }

  private getHtml(_webview: vscode.Webview): string {
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Header / model selector ── */
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      flex-shrink: 0;
    }
    .header select {
      appearance: none;
      -webkit-appearance: none;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      padding: 3px 22px 3px 8px;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      cursor: pointer;
      outline: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
      background-size: 10px 6px;
      min-width: 0;
      max-width: 50%;
      text-overflow: ellipsis;
    }
    .header select:hover { border-color: var(--vscode-focusBorder); }
    .header select:focus { border-color: var(--vscode-focusBorder); }

    /* ── Messages area ── */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.45;
      font-size: var(--vscode-font-size);
      max-width: 100%;
    }
    .message.user {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
    }
    .message.assistant {
      background: var(--vscode-editorWidget-background);
      border-left: 3px solid var(--vscode-charts-green, #89d185);
    }
    .message.system, .message.error-msg {
      background: var(--vscode-inputValidation-warningBackground, var(--vscode-inputValidation-errorBackground));
      border-left: 3px solid var(--vscode-errorForeground);
      font-size: 12px;
      opacity: 0.9;
    }

    /* ── Attachments bar ── */
    #attachments {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 0 10px;
      flex-shrink: 0;
    }
    #attachments:empty { display: none; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px 2px 6px;
      border-radius: 999px;
      font-size: 11px;
      line-height: 1.4;
    }
    .attachment-chip .chip-icon { font-size: 13px; opacity: 0.7; }
    .attachment-remove {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      padding: 0 0 0 2px;
      font-size: 14px;
      line-height: 1;
      opacity: 0.6;
    }
    .attachment-remove:hover { opacity: 1; }

    /* ── Composer ── */
    #composer {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      padding: 8px 10px 10px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      flex-shrink: 0;
    }
    #prompt {
      flex: 1;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      padding: 7px 10px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
      resize: none;
      overflow-y: auto;
      min-height: 34px;
      max-height: 200px;
      line-height: 1.4;
    }
    #prompt:focus { border-color: var(--vscode-focusBorder); }
    #prompt::placeholder { color: var(--vscode-input-placeholderForeground); }

    /* ── Buttons (shared) ── */
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-foreground));
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.1s;
    }
    .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(90,93,94,0.31)); }
    .icon-btn:active { background: var(--vscode-toolbar-activeBackground, rgba(90,93,94,0.45)); }
    .icon-btn:disabled { opacity: 0.35; cursor: default; pointer-events: none; }
    .icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
    .icon-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .icon-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
    .icon-btn.danger { color: var(--vscode-errorForeground); }
    .icon-btn.danger:hover { background: rgba(255,85,85,0.15); }

    /* ── Paste preview ── */
    .paste-preview {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin: 0 10px 4px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .paste-preview img {
      max-height: 48px;
      max-width: 80px;
      border-radius: 4px;
      object-fit: cover;
    }
  </style>
</head>
<body>
  <div class="header">
    <select id="providerSelect" title="Provider">
      <option value="">Provider…</option>
      <option value="anthropic">Anthropic</option>
      <option value="openai">OpenAI</option>
      <option value="ollama">Ollama</option>
    </select>
    <select id="modelSelect" title="Model">
      <option value="">Model…</option>
    </select>
  </div>
  <div id="messages"></div>
  <div id="attachments"></div>
  <form id="composer">
    <button id="attachBtn" class="icon-btn" type="button" title="Attach files or images">
      <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1.5v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6H16.5z"/></svg>
    </button>
    <textarea id="prompt" rows="1" placeholder="Ask DreamGraph…" autocomplete="off"></textarea>
    <button id="sendBtn" class="icon-btn primary" type="submit" title="Send message">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
    <button id="stopBtn" class="icon-btn danger" type="button" title="Stop generation" style="display:none">
      <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
    </button>
    <button id="clear" class="icon-btn" type="button" title="Clear conversation">
      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
    </button>
  </form>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const messagesEl = document.getElementById('messages');
      const attachmentsEl = document.getElementById('attachments');
      const form = document.getElementById('composer');
      const promptEl = document.getElementById('prompt');
      const attachBtn = document.getElementById('attachBtn');
      const sendBtn = document.getElementById('sendBtn');
      const stopBtn = document.getElementById('stopBtn');
      const clearEl = document.getElementById('clear');
      const providerSelect = document.getElementById('providerSelect');
      const modelSelect = document.getElementById('modelSelect');
      let streamingEl = null;
      let promptHistory = [];
      let historyIndex = -1;
      let historyDraft = '';
      let attachmentState = [];
      let currentCapabilities = { textAttachments: false, imageAttachments: false };

      function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
      function createBubble(role, content) { const div = document.createElement('div'); div.className = 'message ' + role; div.textContent = content; return div; }
      function render(messages) { messagesEl.innerHTML = ''; streamingEl = null; for (const message of messages) messagesEl.appendChild(createBubble(message.role, message.content)); scrollToBottom(); }
      function autoResize() { promptEl.style.height = 'auto'; promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px'; }

      function renderAttachments(items) {
        attachmentState = items || [];
        attachmentsEl.innerHTML = '';
        for (const item of attachmentState) {
          const chip = document.createElement('div');
          chip.className = 'attachment-chip';
          const icon = document.createElement('span');
          icon.className = 'chip-icon';
          icon.textContent = item.kind === 'image' ? '🖼' : '📄';
          chip.appendChild(icon);
          const label = document.createElement('span');
          label.textContent = item.name + (item.note ? ' (' + item.note + ')' : '');
          chip.appendChild(label);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'attachment-remove';
          remove.textContent = '×';
          remove.title = 'Remove attachment';
          remove.addEventListener('click', () => vscode.postMessage({ type: 'removeAttachment', id: item.id }));
          chip.appendChild(remove);
          attachmentsEl.appendChild(chip);
        }
      }

      providerSelect.addEventListener('change', function() {
        vscode.postMessage({ type: 'changeProvider', provider: this.value });
      });
      modelSelect.addEventListener('change', function() {
        vscode.postMessage({ type: 'changeModel', model: this.value });
      });
      attachBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'pickAttachments' });
      });

      function updateModels(_providers, models, current, capabilities) {
        currentCapabilities = capabilities || { textAttachments: false, imageAttachments: false };
        if (current.provider) { providerSelect.value = current.provider; }
        modelSelect.innerHTML = '';
        if (models.length === 0) {
          const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'Model…'; modelSelect.appendChild(opt);
        }
        models.forEach(function(m) {
          const opt = document.createElement('option'); opt.value = m; opt.textContent = m; modelSelect.appendChild(opt);
        });
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '+ Custom model…';
        modelSelect.appendChild(customOpt);
        if (current.model) {
          let found = false;
          for (let i = 0; i < modelSelect.options.length; i++) {
            if (modelSelect.options[i].value === current.model) { found = true; break; }
          }
          if (!found && current.model) {
            const extraOpt = document.createElement('option');
            extraOpt.value = current.model;
            extraOpt.textContent = current.model;
            modelSelect.insertBefore(extraOpt, modelSelect.querySelector('[value="__custom__"]'));
          }
          modelSelect.value = current.model;
        }
        attachBtn.disabled = !(capabilities && (capabilities.textAttachments || capabilities.imageAttachments));
        attachBtn.title = attachBtn.disabled ? 'Selected model does not support attachments' : 'Attach files or images (or paste from clipboard)';
      }

      function showError(message) { const el = document.createElement('div'); el.className = 'message error-msg'; el.textContent = message; messagesEl.appendChild(el); scrollToBottom(); }

      /* ── Clipboard paste handler for images ── */
      promptEl.addEventListener('paste', function(e) {
        const items = (e.clipboardData || {}).items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault();
            const file = items[i].getAsFile();
            if (!file) return;
            if (!currentCapabilities.imageAttachments) {
              showError('Current model does not support image attachments.');
              return;
            }
            const reader = new FileReader();
            reader.onload = function() {
              const dataUrl = reader.result;
              const base64 = dataUrl.split(',')[1];
              const mimeType = file.type || 'image/png';
              vscode.postMessage({ type: 'pasteImage', dataBase64: base64, mimeType: mimeType });
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.type) {
          case 'state': if (message.state) render(message.state.messages || []); break;
          case 'addMessage': if (message.message) { messagesEl.appendChild(createBubble(message.message.role, message.message.content)); scrollToBottom(); } break;
          case 'stream-start': streamingEl = createBubble('assistant', ''); messagesEl.appendChild(streamingEl); scrollToBottom(); promptEl.placeholder = 'Steer the conversation…'; stopBtn.style.display = ''; break;
          case 'stream-chunk': if (streamingEl && message.chunk) { streamingEl.textContent += message.chunk; scrollToBottom(); } break;
          case 'stream-end': streamingEl = null; promptEl.disabled = false; promptEl.placeholder = 'Ask DreamGraph…'; stopBtn.style.display = 'none'; promptEl.focus(); break;
          case 'updateModels': updateModels(message.providers, message.models, message.current, message.capabilities); break;
          case 'setAttachments': renderAttachments(message.attachments || []); break;
          case 'error': if (message.error) showError(message.error); break;
          case 'restoreDraft': if (message.text) { promptEl.value = message.text; vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: message.text })); autoResize(); } break;
        }
      });

      function sendPrompt() {
        const text = promptEl.value.trim();
        if (!text) return;
        if (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== text) promptHistory.push(text);
        historyIndex = -1; historyDraft = '';
        vscode.postMessage({ type: 'send', text });
        promptEl.value = ''; promptEl.style.height = 'auto';
        vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: '' }));
        vscode.postMessage({ type: 'saveDraft', text: '' });
      }
      promptEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); return; }
        if (e.key === 'ArrowUp') {
          var cursorAtStart = promptEl.selectionStart === 0 && promptEl.selectionEnd === 0;
          var textBeforeCursor = promptEl.value.substring(0, promptEl.selectionStart);
          if (cursorAtStart || !textBeforeCursor.includes('\\n')) {
            if (promptHistory.length > 0) {
              if (historyIndex === -1) { historyDraft = promptEl.value; historyIndex = promptHistory.length - 1; }
              else if (historyIndex > 0) historyIndex--; else return;
              e.preventDefault(); promptEl.value = promptHistory[historyIndex]; autoResize(); promptEl.setSelectionRange(0,0);
            }
          }
          return;
        }
        if (e.key === 'ArrowDown') {
          if (historyIndex === -1) return;
          var textAfterCursor = promptEl.value.substring(promptEl.selectionEnd);
          var cursorAtEnd = promptEl.selectionEnd === promptEl.value.length;
          if (cursorAtEnd || !textAfterCursor.includes('\\n')) {
            if (historyIndex < promptHistory.length - 1) { historyIndex++; e.preventDefault(); promptEl.value = promptHistory[historyIndex]; }
            else { historyIndex = -1; e.preventDefault(); promptEl.value = historyDraft; }
            autoResize(); var len = promptEl.value.length; promptEl.setSelectionRange(len, len);
          }
        }
      });
      form.addEventListener('submit', (event) => { event.preventDefault(); sendPrompt(); });
      stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
      clearEl.addEventListener('click', () => vscode.postMessage({ type: 'clear' }));
      var savedState = vscode.getState();
      if (savedState && savedState.draft) { promptEl.value = savedState.draft; autoResize(); }
      promptEl.addEventListener('input', function() { autoResize(); var draft = promptEl.value; vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: draft })); vscode.postMessage({ type: 'saveDraft', text: draft }); });
      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
