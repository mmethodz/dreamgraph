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
import type { ChatMemory, PersistedMessage } from './chat-memory';
import type { GraphSignalProvider } from './graph-signal';
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  type ArchitectLlm,
  type ArchitectMessage,
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

/* ------------------------------------------------------------------ */
/*  Message protocol                                                  */
/* ------------------------------------------------------------------ */

type ExtensionToWebviewMessage =
  | { type: 'addMessage'; message: ChatMessage }
  | { type: 'stream-start' }
  | { type: 'stream-chunk'; chunk: string }
  | { type: 'stream-end'; done: boolean }
  | { type: 'state'; state: { messages: ChatMessage[] } }
  | { type: 'updateModels'; providers: string[]; models: string[]; current: { provider: string; model: string } }
  | { type: 'error'; error: string }
  | { type: 'restoreDraft'; text: string };

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
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

  /** Content accumulated during the current streaming response (for tab-switch recovery). */
  private streamingContent = '';

  /** Queued steering prompts sent by user during agentic loop execution. */
  private steeringQueue: string[] = [];

  /** Draft text in the prompt input — persisted across tab switches & webview recreations. */
  private draftText = '';

  /** Per-tool-category character caps for tool results sent back to the Architect. */
  private static readonly TOOL_RESULT_LIMITS: Record<string, number> = {
    // Code-reading tools need generous limits so the Architect can see full entities
    read_source_code: 12_000,
    read_local_file: 12_000,
    query_api_surface: 10_000,
    // Command output — errors can be verbose
    run_command: 8_000,
    // Edit results — usually short, but include verification detail
    edit_entity: 6_000,
    edit_file: 6_000,
    modify_entity: 6_000,
    write_file: 4_000,
    // Graph / cognitive — summaries are fine
    _default: 4_000,
  };

  private static _toolResultLimit(toolName: string): number {
    return ChatPanel.TOOL_RESULT_LIMITS[toolName] ?? ChatPanel.TOOL_RESULT_LIMITS._default;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public setGraphSignal(provider: GraphSignalProvider): void {
    this.graphSignal = provider;
  }

  public setMemory(memory: ChatMemory): void {
    this.memory = memory;
  }

  public setArchitectLlm(llm: ArchitectLlm): void {
    this.architectLlm = llm;
  }

  public setContextBuilder(cb: ContextBuilder): void {
    this.contextBuilder = cb;
  }

  public setMcpClient(mcp: McpClient): void {
    this.mcpClient = mcp;
  }

  public setChangedFilesProvider(provider: ChangedFilesView): void {
    this.changedFilesView = provider;
  }

  public setInstance(instanceId: string): void {
    if (this.currentInstanceId === instanceId) {
      return;
    }

    this.currentInstanceId = instanceId;
    void this.restoreMessages();
  }

  /** Whether the chat panel is currently visible. */
  public get isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  /**
   * Add a message from an external command (e.g., explainFile result).
   */
  public addExternalMessage(role: ChatRole, content: string): void {
    const msg: ChatMessage = { role, content, timestamp: new Date().toISOString() };
    this.messages.push(msg);
    void this.persistMessages();
    void this.postMessage({ type: 'addMessage', message: msg });
  }

  /**
   * Reveal/open the chat panel programmatically.
   */
  public open(): void {
    void vscode.commands.executeCommand('dreamgraph.chatView.focus');
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    }, null, this.disposables);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.rehydrateWebview();
      }
    }, null, this.disposables);

    webviewView.webview.onDidReceiveMessage(async (message: WebviewToExtensionMessage) => {
      switch (message.type) {
        case 'ready':
          await this.rehydrateWebview();
          this._sendModelUpdate();
          this._checkApiKeyWarning();
          break;
        case 'send':
          if ('text' in message && typeof message.text === 'string' && message.text.trim().length > 0) {
            if (this.streaming) {
              // Steering injection — queue the prompt for the agentic loop
              this.steeringQueue.push(message.text.trim());
              const steerMsg = `\n\n💬 *Steering: "${message.text.trim()}"*\n`;
              this.streamingContent += steerMsg;
              void this.postMessage({ type: 'stream-chunk', chunk: steerMsg });
            } else {
              await this.handleUserMessage(message.text.trim());
            }
          }
          break;
        case 'clear':
          await this.clearMessages();
          break;
        case 'stop':
          this.abortGeneration();
          break;
        case 'changeProvider':
          if ('provider' in message) {
            await this._changeProvider(message.provider as ArchitectProvider);
          }
          break;
        case 'changeModel':
          if ('model' in message) {
            if (message.model === '__custom__') {
              const custom = await vscode.window.showInputBox({
                prompt: 'Enter a custom model name',
                placeHolder: 'e.g. claude-sonnet-4',
              });
              if (custom) {
                await this._changeModel(custom);
              } else {
                this._sendModelUpdate(); // cancelled — re-sync dropdown
              }
            } else {
              await this._changeModel(message.model);
            }
          }
          break;
        case 'setApiKey':
          await vscode.commands.executeCommand('dreamgraph.setArchitectApiKey');
          break;
        case 'saveDraft':
          if ('text' in message) {
            this.draftText = message.text ?? '';
          }
          break;
        default:
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
    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  private async handleUserMessage(text: string): Promise<void> {
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    this.messages.push(userMessage);
    await this.persistMessages();
    await this.postMessage({ type: 'addMessage', message: userMessage });

    // ---- Call Architect LLM ----
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

      // Build context envelope (from editor state + DreamGraph knowledge)
      const envelope = this.contextBuilder
        ? await this.contextBuilder.buildEnvelope(text)
        : null;

      // Assemble system prompt
      const task = inferTask(envelope?.intentMode ?? 'ask_dreamgraph');
      const { system } = assemblePrompt(task, envelope);

      // Build conversation history for the LLM
      const llmMessages: ArchitectMessage[] = [
        { role: 'system', content: system },
      ];

      // Include recent conversation for context (last 20 messages max)
      const recentMessages = this.messages.slice(-20);
      for (const msg of recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          llmMessages.push({ role: msg.role, content: msg.content });
        }
      }

      // Signal webview to prepare a streaming assistant bubble
      await this.postMessage({ type: 'stream-start' });

      // ---- Fetch MCP tool definitions if daemon is connected ----
      let tools: ToolDefinition[] = [];
      if (this.mcpClient?.isConnected) {
        try {
          const raw = await this.mcpClient.listTools();
          tools = raw.map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
          }));
        } catch {
          // MCP not available — proceed without tools
        }
      }

      // Append local support tools AFTER MCP tools (fallback/execution role)
      for (const lt of LOCAL_TOOL_DEFINITIONS) {
        tools.push({
          name: lt.name,
          description: lt.description,
          inputSchema: lt.inputSchema as Record<string, unknown>,
        });
      }

      let fullContent: string;

      if (tools.length > 0) {
        // ---- Agentic tool-calling loop ----
        fullContent = await this.runAgenticLoop(llmMessages, tools);
      } else {
        // ---- Plain streaming (no MCP) ----
        fullContent = '';
        await this.architectLlm.stream(llmMessages, (chunk: string) => {
          fullContent += chunk;
          this.streamingContent += chunk;
          void this.postMessage({ type: 'stream-chunk', chunk });
        });
      }

      // Finalize the assistant message
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: fullContent,
        timestamp: new Date().toISOString(),
      };

      this.messages.push(assistantMessage);
      await this.persistMessages();
      await this.postMessage({ type: 'stream-end', done: true });
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err);
      const errMsg: ChatMessage = {
        role: 'system',
        content: `Error: ${errorText}`,
        timestamp: new Date().toISOString(),
      };
      this.messages.push(errMsg);
      await this.persistMessages();
      await this.postMessage({ type: 'stream-end', done: true });
      await this.postMessage({ type: 'addMessage', message: errMsg });
    } finally {
      this.streaming = false;
      this.streamingContent = '';
      this.steeringQueue = [];
      this.abortController = null;
    }
  }

  private abortGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Agentic tool-calling loop: call the LLM with MCP tool definitions,
   * execute any requested tool calls, feed results back, repeat until done.
   * Streams text chunks to the webview as they arrive.
   *
   * Enhanced with:
   *  - Post-edit verification (reads file back to confirm change applied)
   *  - Graph change tracking (enrichment/ADR/UI registry operations)
   *  - Line-level diff stats for changed files
   *  - Failure transparency (structured error classification)
   *  - Provenance tracking (files read, entities accessed, tools used)
   *  - Graph sync reminder after code modifications
   */
  private async runAgenticLoop(
    llmMessages: ArchitectMessage[],
    tools: ToolDefinition[],
    maxIterations = 15,
  ): Promise<string> {
    const llm = this.architectLlm!;
    const mcp = this.mcpClient!;

    // Helper: stream a chunk to the webview AND track it for tab-switch recovery
    const emit = (chunk: string): void => {
      this.streamingContent += chunk;
      void this.postMessage({ type: 'stream-chunk', chunk });
    };

    // ---- Provenance tracker ----
    const provenance = {
      toolsUsed: [] as string[],
      filesRead: [] as string[],
      filesModified: [] as string[],
      entitiesAccessed: [] as string[],
      graphUpdates: [] as string[],
      errors: [] as { tool: string; type: string; message: string }[],
    };

    // Build raw API messages for the agentic loop (Anthropic-style content blocks)
    const rawMessages: unknown[] = llmMessages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    let aggregatedText = '';
    const signal = this.abortController?.signal;
    let codeEditsMade = false;

    for (let i = 0; i < maxIterations; i++) {
      if (signal?.aborted) {
        const stopMsg = '\n\n⏹ *Generation stopped by user.*';
        aggregatedText += stopMsg;
        emit(stopMsg);
        break;
      }

      // ---- Drain steering queue ----
      while (this.steeringQueue.length > 0) {
        const steeringText = this.steeringQueue.shift()!;
        rawMessages.push({ role: 'user', content: `[USER STEERING]: ${steeringText}` });
        llmMessages.push({ role: 'user', content: `[USER STEERING]: ${steeringText}` });
      }

      const response = await llm.callWithTools(llmMessages, tools, rawMessages);

      if (response.content) {
        aggregatedText += response.content;
        emit(response.content);
      }

      if (response.toolCalls.length === 0 || response.stopReason === 'end_turn') {
        break;
      }

      // Append the assistant's response (with tool_use blocks) to raw messages
      const assistantContent: unknown[] = [];
      if (response.content) {
        assistantContent.push({ type: 'text', text: response.content });
      }
      for (const tc of response.toolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }
      rawMessages.push({ role: 'assistant', content: assistantContent });

      // Execute each tool call via MCP and collect results
      const toolResults: unknown[] = [];
      let aborted = false;
      for (const tc of response.toolCalls) {
        if (signal?.aborted) {
          const stopMsg = '\n\n⏹ *Generation stopped by user.*';
          aggregatedText += stopMsg;
          emit(stopMsg);
          aborted = true;
          break;
        }

        // Track provenance
        provenance.toolsUsed.push(tc.name);

        // Show detailed tool call status
        const paramSummary = this._describeToolCall(tc.name, tc.input);
        const callMsg = `\n\n🔧 **${tc.name}** — ${paramSummary}\n`;
        emit(callMsg);
        aggregatedText += callMsg;

        // Wire server-side log notifications to stream progress
        const prevLogHandler = mcp.onServerLog;
        mcp.onServerLog = (level: string, message: string) => {
          const progressMsg = `\n📊 *${message}*\n`;
          aggregatedText += progressMsg;
          emit(progressMsg);
        };

        // ---- Track provenance for read operations ----
        if (tc.name === 'read_source_code') {
          const input = tc.input as Record<string, unknown>;
          if (input.filePath) provenance.filesRead.push(String(input.filePath));
          if (input.entity) provenance.entitiesAccessed.push(String(input.entity));
        }
        if (tc.name === 'query_resource' || tc.name === 'search_data_model') {
          const input = tc.input as Record<string, unknown>;
          if (input.name || input.entity) provenance.entitiesAccessed.push(String(input.name ?? input.entity));
        }

        // ---- Map tool names to change types for the Files Changed view ----
        const fileMutatingTools: Record<string, ChangeType> = {
          create_file: 'create', edit_file: 'edit', edit_entity: 'edit',
          delete_file: 'delete', rename_file: 'rename',
          modify_entity: 'edit', write_file: 'create',
        };
        const changeKind = fileMutatingTools[tc.name];

        let resultText: string;
        let isError = false;
        let errorType = '';
        const t0 = Date.now();
        try {
          if (isLocalTool(tc.name)) {
            // Local extension tool — execute directly in the VS Code host
            resultText = await executeLocalTool(tc.name, tc.input as Record<string, unknown>);

            // ---- Detect local tool failures (they return JSON, never throw) ----
            try {
              const parsed = JSON.parse(resultText);
              if (parsed.success === false) {
                // Explicit failure (read_local_file ENOENT, modify_entity not found, etc.)
                isError = true;
                const errMsg = String(parsed.error ?? 'Unknown error');
                if (errMsg.includes('not found') || errMsg.includes('ENOENT') || errMsg.includes('no such file')) {
                  errorType = 'not_found';
                } else if (errMsg.includes('permission') || errMsg.includes('EACCES')) {
                  errorType = 'permission';
                } else {
                  errorType = 'unknown';
                }
                provenance.errors.push({ tool: tc.name, type: errorType, message: errMsg });
              } else if (parsed.data?.timedOut) {
                // run_command killed by timeout
                isError = true;
                errorType = 'timeout';
                provenance.errors.push({ tool: tc.name, type: 'timeout', message: `Command timed out (exit ${parsed.data.exitCode})` });
              } else if (tc.name === 'run_command' && parsed.data?.exitCode != null && parsed.data.exitCode !== 0) {
                // Non-zero exit: mark as error so the LLM knows the command failed
                isError = true;
                errorType = 'command_failed';
                provenance.errors.push({ tool: tc.name, type: 'command_failed', message: `exit ${parsed.data.exitCode}` });
              }
            } catch { /* result is not JSON — proceed as-is */ }
          } else {
            const result = await mcp.callTool(
              tc.name,
              tc.input,
              300_000,
              (message: string, _progress: number, _total?: number) => {
                const progressMsg = `\n📊 *${message}*\n`;
                aggregatedText += progressMsg;
                emit(progressMsg);
              },
            );
            resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          }
        } catch (err) {
          isError = true;
          const errMsg = err instanceof Error ? err.message : String(err);
          // ---- Failure transparency: classify error type ----
          if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
            errorType = 'timeout';
          } else if (errMsg.includes('ENOENT') || errMsg.includes('not found')) {
            errorType = 'not_found';
          } else if (errMsg.includes('EACCES') || errMsg.includes('permission')) {
            errorType = 'permission';
          } else if (errMsg.includes('parse') || errMsg.includes('JSON') || errMsg.includes('syntax')) {
            errorType = 'parsing';
          } else if (errMsg.includes('ambig') || errMsg.includes('multiple')) {
            errorType = 'ambiguity';
          } else {
            errorType = 'unknown';
          }
          resultText = `Tool error (${errorType}): ${errMsg}`;
          provenance.errors.push({ tool: tc.name, type: errorType, message: errMsg });
        } finally {
          mcp.onServerLog = prevLogHandler;
        }
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

        // ---- Record file change in tree view + provenance ----
        if (changeKind && !isError) {
          const input = tc.input as Record<string, unknown>;
          let changedPath = input.filePath as string | undefined;
          const previousPath = tc.name === 'rename_file' ? input.oldPath as string | undefined : undefined;
          if (tc.name === 'rename_file') {
            changedPath = (input.newPath as string | undefined) ?? changedPath;
          }
          if (changedPath) {
            // Resolve relative paths
            if (!changedPath.match(/^[A-Z]:\\|^\//i)) {
              const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
              if (wsRoot) {
                const pathMod = await import('path');
                changedPath = pathMod.resolve(wsRoot, changedPath);
              }
            }

            // Record in tree view (FS watcher may also pick this up, but explicit
            // recording ensures correct change type for renames and creates)
            this.changedFilesView?.record(changeKind, changedPath, previousPath);
            provenance.filesModified.push(changedPath);
            codeEditsMade = true;

            // ---- Post-edit verification ----
            if (changeKind !== 'delete' && changeKind !== 'rename') {
              try {
                const uri = vscode.Uri.file(changedPath);
                const bytes = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(bytes).toString('utf-8');
                if (content.length > 0) {
                  const verifyMsg = `\n✔️ *Verified: ${changedPath.split(/[/\\]/).pop()} saved (${content.split('\n').length} lines)*\n`;
                  aggregatedText += verifyMsg;
                  emit(verifyMsg);
                } else {
                  const verifyMsg = `\n⚠️ *Verification warning: ${changedPath.split(/[/\\]/).pop()} is empty after edit*\n`;
                  aggregatedText += verifyMsg;
                  emit(verifyMsg);
                }
              } catch { /* best effort */ }
            }
          }
        }

        // ---- Track graph changes for provenance ----
        if (!isError) {
          const graphInfo = this._detectGraphChange(tc.name, tc.input as Record<string, unknown>, resultText);
          if (graphInfo) {
            provenance.graphUpdates.push(`${graphInfo.entityType}: ${graphInfo.description}`);
          }
        }

        // Truncate before sending back
        const truncatedResult = isError
          ? resultText
          : this._truncateToolResult(tc.name, resultText);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: truncatedResult,
          ...(isError ? { is_error: true } : {}),
        });

        // Show human-readable result inline
        const preview = this._humanReadablePreview(tc.name, resultText, 600);
        if (isError) {
          // ---- Failure transparency: structured error report ----
          const errorReport = `\n❌ **${tc.name}** failed (${elapsed}s)\n` +
            `> **Error type:** ${errorType}\n` +
            `> **Details:** ${preview}\n` +
            (errorType === 'timeout' ? `> **Suggestion:** Try with smaller scope or shallower depth\n` : '') +
            (errorType === 'not_found' ? `> **Suggestion:** Check file/entity path; use list_directory or search_data_model first\n` : '') +
            (errorType === 'ambiguity' ? `> **Suggestion:** Be more specific — use entity mode or provide exact file path\n` : '') +
            (errorType === 'parsing' ? `> **Suggestion:** Check JSON format; the tool result may need different input\n` : '') +
            (errorType === 'command_failed' ? `> **Suggestion:** Check exit code; verify the command is valid for this OS\n` : '');
          aggregatedText += errorReport;
          emit(errorReport);
        } else {
          const resultStatus = `\n✅ **${tc.name}** (${elapsed}s) — ${preview}`;
          aggregatedText += resultStatus;
          emit(resultStatus);
        }
      }

      if (aborted) break;

      // ---- Graph sync reminder after code edits ----
      // If code was modified and this is the last iteration before a final response,
      // inject a reminder for the Architect to update the knowledge graph.
      if (codeEditsMade && i === maxIterations - 2) {
        const syncReminder =
          '\n\n📝 *[System] Code files were modified. Consider updating the knowledge graph ' +
          '(enrich_seed_data for features/workflows/data_model, or record_architecture_decision ' +
          'if the change is architectural).*\n';
        aggregatedText += syncReminder;
        emit(syncReminder);
      }

      // Feed tool results back as a user message
      rawMessages.push({ role: 'user', content: toolResults });

      llmMessages.push({
        role: 'assistant',
        content: response.content || `[called ${response.toolCalls.map((t) => t.name).join(', ')}]`,
      });
      llmMessages.push({
        role: 'user',
        content: `[tool results provided for: ${response.toolCalls.map((t) => t.name).join(', ')}]`,
      });
    }

    // ---- Provenance summary (appended after the LLM's final response) ----
    if (provenance.toolsUsed.length > 0) {
      const parts: string[] = ['\n\n---\n**Provenance:**'];
      const uniqueTools = [...new Set(provenance.toolsUsed)];
      parts.push(`- Tools: ${uniqueTools.join(', ')}`);
      if (provenance.filesRead.length > 0) {
        const uniqueReads = [...new Set(provenance.filesRead)].map(f => f.split(/[/\\]/).pop());
        parts.push(`- Files read: ${uniqueReads.join(', ')}`);
      }
      if (provenance.filesModified.length > 0) {
        const uniqueMods = [...new Set(provenance.filesModified)].map(f => f.split(/[/\\]/).pop());
        parts.push(`- Files modified: ${uniqueMods.join(', ')}`);
      }
      if (provenance.entitiesAccessed.length > 0) {
        const uniqueEntities = [...new Set(provenance.entitiesAccessed)];
        parts.push(`- Entities: ${uniqueEntities.join(', ')}`);
      }
      if (provenance.graphUpdates.length > 0) {
        parts.push(`- Graph updates: ${provenance.graphUpdates.join('; ')}`);
      }
      if (provenance.errors.length > 0) {
        parts.push(`- Errors: ${provenance.errors.map(e => `${e.tool} (${e.type})`).join(', ')}`);
      }
      const provenanceBlock = parts.join('\n');
      aggregatedText += provenanceBlock;
      emit(provenanceBlock);
    }

    return aggregatedText;
  }

  /**
   * Detect if a tool call resulted in a graph/knowledge-base change.
   * Returns a GraphChange descriptor or undefined.
   */
  /** Lightweight graph-change detection for provenance tracking (no tree view dependency). */
  private _detectGraphChange(
    toolName: string,
    input: Record<string, unknown>,
    _resultText: string,
  ): { entityType: string; description: string } | undefined {
    switch (toolName) {
      case 'enrich_seed_data':
        return { entityType: String(input.target ?? 'unknown'), description: `Enriched ${input.target}` };
      case 'scan_project':
        return { entityType: 'index', description: 'Project scan completed' };
      case 'record_architecture_decision':
        return { entityType: 'adr', description: `ADR: ${String(input.title ?? 'new decision')}` };
      case 'register_ui_element':
        return { entityType: 'ui_element', description: `UI: ${String(input.id ?? 'element')}` };
      case 'solidify_cognitive_insight':
        return { entityType: 'tension', description: 'Insight solidified' };
      case 'dream_cycle':
        return { entityType: 'dream', description: 'Dream cycle completed' };
      default:
        return undefined;
    }
  }

  /* ---- Provider / model switching ---- */

  private async _changeProvider(provider: ArchitectProvider): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('dreamgraph.architect');
    await cfg.update('provider', provider, vscode.ConfigurationTarget.Workspace);

    const defaultUrls: Record<string, string> = {
      anthropic: 'https://api.anthropic.com/v1',
      openai: 'https://api.openai.com/v1',
      ollama: 'http://localhost:11434',
    };
    if (defaultUrls[provider]) {
      await cfg.update('baseUrl', defaultUrls[provider], vscode.ConfigurationTarget.Workspace);
    }

    // Clear model so user picks one for the new provider
    await cfg.update('model', undefined, vscode.ConfigurationTarget.Workspace);

    await this.architectLlm?.loadConfig();
    this._sendModelUpdate();

    // Proactively prompt for API key if the new provider needs one and none is stored
    if (provider !== 'ollama' && this.architectLlm) {
      const existingKey = await this.architectLlm.getApiKey(provider);
      if (!existingKey) {
        // Prompt immediately via the command palette flow
        await vscode.commands.executeCommand('dreamgraph.setArchitectApiKey');
        // Reload config after key was (potentially) set
        await this.architectLlm.loadConfig();
        this._sendModelUpdate();
      }
    }

    this._checkApiKeyWarning();
  }

  private async _changeModel(model: string): Promise<void> {
    await vscode.workspace
      .getConfiguration('dreamgraph.architect')
      .update('model', model, vscode.ConfigurationTarget.Workspace);
    await this.architectLlm?.loadConfig();
    this._sendModelUpdate();
  }

  private _sendModelUpdate(): void {
    if (!this.architectLlm) return;
    const config = this.architectLlm.currentConfig;
    const provider = config?.provider ?? '';
    const currentModel = config?.model ?? '';
    const presetModels = this._getModelsForProvider(provider as ArchitectProvider);

    // Ensure current model always appears (handles custom names)
    const models = currentModel && !presetModels.includes(currentModel)
      ? [currentModel, ...presetModels]
      : presetModels;

    void this.postMessage({
      type: 'updateModels',
      providers: ['anthropic', 'openai', 'ollama'],
      models,
      current: { provider, model: currentModel },
    });
  }

  private _getModelsForProvider(provider: ArchitectProvider): string[] {
    switch (provider) {
      case 'anthropic': return [...ANTHROPIC_MODELS];
      case 'openai':    return [...OPENAI_MODELS];
      case 'ollama':    return []; // dynamic — user enters custom
      default:          return [];
    }
  }

  private _checkApiKeyWarning(): void {
    if (!this.architectLlm) return;
    const config = this.architectLlm.currentConfig;
    if (!config?.provider) {
      void this.postMessage({
        type: 'error',
        error: 'No Architect provider configured. Select one in the dropdown above.',
      });
      return;
    }
    if (config.provider !== 'ollama' && !config.apiKey) {
      void this.postMessage({
        type: 'error',
        error: `No API key for ${config.provider}. Use "DreamGraph: Set Architect API Key".`,
      });
    }
  }

  /* ---- Tool result truncation ---- */

  private _truncateToolResult(toolName: string, raw: string): string {
    const MAX = ChatPanel._toolResultLimit(toolName);
    if (raw.length <= MAX) return raw;

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'ok' in parsed) {
        if (parsed.ok && parsed.data) return this._summarizeObject(toolName, parsed.data, MAX);
        if (!parsed.ok && parsed.error) return JSON.stringify({ ok: false, error: parsed.error }).slice(0, MAX);
      }
      return this._summarizeObject(toolName, parsed, MAX);
    } catch {
      return raw.slice(0, MAX) + `\n... [truncated, ${raw.length} chars total]`;
    }
  }

  private _summarizeObject(toolName: string, obj: unknown, max: number): string {
    if (Array.isArray(obj)) {
      const preview = obj.slice(0, 3).map((item) => {
        if (typeof item === 'object' && item !== null) {
          const keys = ['id', 'name', 'title', 'message', 'status', 'type'];
          const pick: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in item) pick[k] = (item as Record<string, unknown>)[k];
          }
          return Object.keys(pick).length > 0 ? pick : '[object]';
        }
        return item;
      });
      return JSON.stringify({ _tool: toolName, _count: obj.length, _preview: preview }).slice(0, max);
    }

    if (typeof obj === 'object' && obj !== null) {
      const record = obj as Record<string, unknown>;
      const summaryKeys = [
        'message', 'summary', 'status', 'ok', 'error',
        'entries_received', 'entries_inserted', 'entries_updated',
        'total_entries', 'index_entries', 'target', 'file', 'mode',
        'validation_errors', 'count', 'name', 'id', 'repos',
        'features_count', 'workflows_count', 'data_model_count',
        'capabilities_count', 'total_files', 'total_entities',
      ];
      const compact: Record<string, unknown> = { _tool: toolName };
      for (const k of summaryKeys) {
        if (k in record) {
          const val = record[k];
          compact[k] = Array.isArray(val) ? (val.length <= 5 ? val : `[${val.length} items]`) : val;
        }
      }
      if (Object.keys(compact).length <= 1) {
        compact._keys = Object.keys(record).slice(0, 20);
        for (const k of Object.keys(record).slice(0, 5)) {
          const v = record[k];
          if (typeof v === 'string' && v.length <= 200) compact[k] = v;
          else if (typeof v === 'number' || typeof v === 'boolean') compact[k] = v;
          else if (Array.isArray(v)) compact[k] = `[${v.length} items]`;
        }
      }
      return JSON.stringify(compact).slice(0, max);
    }

    return String(obj).slice(0, max);
  }

  /**
   * Build a short, human-readable preview of a tool result for displaying
   * inline in the chat window. The goal is to show something useful — not JSON.
   */
  private _humanReadablePreview(toolName: string, raw: string, max: number): string {
    try {
      const json = JSON.parse(raw);
      const obj = typeof json === 'object' && json !== null && 'data' in json ? json.data : json;

      // run_command: summarise exit code + tail of relevant output
      if (toolName === 'run_command' && obj) {
        const exit = obj.exitCode ?? '?';
        const timedOut = obj.timedOut ? ' [TIMED OUT]' : '';
        const out = (exit !== 0 && obj.stderr) ? String(obj.stderr) : String(obj.relevant ?? obj.stdout ?? '');
        const tail = out.split('\n').filter((l: string) => l.trim()).slice(-8).join('\n');
        return `exit ${exit}${timedOut}${tail ? ' — ' + tail.slice(0, max - 30) : ''}`;
      }

      // read_local_file: show full file path and line range
      if (toolName === 'read_local_file' && obj?.filePath) {
        const fp = String(obj.filePath);
        const range = obj.range ? ` L${obj.range}` : '';
        const lines = obj.totalLines ? ` (${obj.totalLines} lines)` : '';
        return `${fp}${range}${lines}`.slice(0, max);
      }

      // modify_entity / write_file: show result message
      if ((toolName === 'modify_entity' || toolName === 'write_file') && obj?.message) {
        return String(obj.message).slice(0, max);
      }

      // Scan / enrichment results
      if (obj.message && typeof obj.message === 'string') return obj.message.slice(0, max);

      // Simple ok / error (accept both ok:false and success:false)
      if ((obj.ok === false || obj.success === false) && obj.error) return `Error: ${String(obj.error).slice(0, max)}`;

      // Counts-style results
      const parts: string[] = [];
      const pick = ['repos_scanned', 'files_discovered', 'features', 'workflows',
        'data_model', 'index_entries', 'llm_tokens_used', 'entries_inserted',
        'entries_updated', 'total_entries', 'count', 'edges_proposed',
        'edges_promoted', 'status', 'state'];
      for (const k of pick) {
        if (k in obj) {
          const v = obj[k];
          if (typeof v === 'object' && v !== null && 'total' in v) {
            parts.push(`${k}: ${v.inserted ?? 0} new / ${v.total} total`);
          } else {
            parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
          }
        }
      }
      if (parts.length > 0) return parts.join(' · ').slice(0, max);

      // Array result
      if (Array.isArray(obj)) return `${obj.length} item(s) returned`;

      // Smart array-summariser: for objects whose values are mostly arrays,
      // show counts and a one-line sample instead of dumping raw JSON.
      const allKeys = Object.keys(obj);
      const arrayKeys = allKeys.filter(k => Array.isArray(obj[k]));
      if (arrayKeys.length > 0 && arrayKeys.length >= allKeys.length * 0.4) {
        const summaryParts: string[] = [];
        for (const k of allKeys) {
          const v = obj[k];
          if (Array.isArray(v)) {
            if (v.length === 0) {
              summaryParts.push(`${k}: (none)`);
            } else {
              // Show count + first item's key fields as sample
              const first = v[0];
              let sample = '';
              if (typeof first === 'object' && first !== null) {
                const id = first.id ?? first.edge_id ?? first.tension_id ?? first.schedule_id ?? '';
                const label = first.name ?? first.from ?? first.entity_id ?? '';
                if (id || label) sample = ` — e.g. ${id || label}`;
              }
              summaryParts.push(`${k}: ${v.length}${sample}`);
            }
          } else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
            summaryParts.push(`${k}: ${v}`);
          }
        }
        if (summaryParts.length > 0) return summaryParts.join(' · ').slice(0, max);
      }

      // Fallback: first 5 keys as key=value (generous per-key limit for paths)
      const fKeys = allKeys.slice(0, 5);
      return fKeys.map(k => `${k}: ${JSON.stringify(obj[k]).slice(0, 300)}`).join(' · ').slice(0, max);
    } catch {
      // Not JSON — just trim the raw text
      return raw.length > max ? raw.slice(0, max) + '…' : raw;
    }
  }

  /**
   * Produce a human-readable one-liner describing what a tool call will do,
   * based on the tool name and the input arguments the model sent.
   */
  private _describeToolCall(name: string, input: Record<string, unknown>): string {
    const descriptions: Record<string, (i: Record<string, unknown>) => string> = {
      scan_project: (i) => {
        const depth = i.depth ?? 'deep';
        const targets = Array.isArray(i.targets) ? i.targets.join(', ') : 'all';
        return `Scanning project (${depth}, targets: ${targets})…`;
      },
      init_graph: () => 'Initializing knowledge graph…',
      enrich_seed_data: (i) => {
        const target = i.target ?? '?';
        const count = Array.isArray(i.entries) ? i.entries.length : '?';
        return `Enriching ${target} (${count} entries, mode: ${i.mode ?? 'merge'})…`;
      },
      dream_cycle: (i) => `Running dream cycle (strategy: ${i.strategy ?? 'all'})…`,
      read_source_code: (i) => {
        if (i.entity) return `Reading entity "${i.entity}" from ${i.filePath ?? '?'}…`;
        return `Reading ${i.filePath ?? '?'}${i.startLine ? ` L${i.startLine}–${i.endLine ?? '?'}` : ''}…`;
      },
      query_resource: (i) => `Querying ${i.type ?? 'resource'}${i.name ? ` "${i.name}"` : ''}…`,
      search_data_model: (i) => `Searching data model for "${i.entity ?? i.query ?? '?'}"…`,
      cognitive_status: () => 'Checking cognitive engine status…',
      get_dream_insights: () => 'Fetching dream insights…',
      get_causal_insights: () => 'Fetching causal chains…',
      get_temporal_insights: () => 'Fetching temporal patterns…',
      get_remediation_plan: (i) => `Getting remediation plan for "${i.tension_id ?? '?'}"…`,
      query_architecture_decisions: (i) => `Querying ADRs${i.status ? ` (status: ${i.status})` : ''}…`,
      record_architecture_decision: (i) => `Recording ADR: "${i.title ?? '?'}"…`,
      register_ui_element: (i) => `Registering UI element: "${i.id ?? '?'}"…`,
      solidify_cognitive_insight: (i) => `Solidifying insight: "${i.description?.toString().slice(0, 60) ?? '?'}"…`,
      git_log: (i) => `Reading git log${i.filePath ? ` for ${i.filePath}` : ''}…`,
      git_blame: (i) => `Reading git blame for ${i.filePath ?? '?'}…`,
      get_workflow: (i) => `Getting workflow: "${i.id ?? '?'}"…`,
      query_api_surface: (i) => `Querying API surface${i.member_name ? ` for "${i.member_name}"` : ''}…`,
      fetch_web_page: (i) => `Fetching ${i.url ?? '?'}…`,
      schedule_dream: (i) => `Scheduling ${i.total_cycles ?? '?'} dream cycles…`,
      export_living_docs: () => 'Exporting living documentation…',
      normalize_dreams: () => 'Normalizing dream graph…',
      edit_entity: (i) => `Editing entity "${i.entity ?? '?'}" in ${i.filePath ?? '?'}…`,
      edit_file: (i) => `Editing ${i.filePath ?? '?'}…`,
      run_command: (i) => `Running: \`${String(i.command ?? '?').slice(0, 80)}\`…`,
      modify_entity: (i) => `Modifying ${i.parentEntity ? `${i.parentEntity}.` : ''}${i.entity ?? '?'} in ${i.filePath ?? '?'}…`,
      write_file: (i) => `Writing ${i.filePath ?? '?'}…`,
      read_local_file: (i) => `Reading ${i.filePath ?? '?'}${i.startLine ? ` L${i.startLine}–${i.endLine ?? '?'}` : ''}…`,
    };

    const fn = descriptions[name];
    if (fn) {
      try { return fn(input); } catch { /* fall through */ }
    }

    // Generic fallback: show key params (generous limit for file paths)
    const keys = Object.keys(input);
    if (keys.length === 0) return 'Running…';
    const pairs = keys.slice(0, 3).map(k => {
      const v = input[k];
      const s = typeof v === 'string' ? v : Array.isArray(v) ? `[${v.length}]` : JSON.stringify(v);
      return `${k}: ${String(s).slice(0, 160)}`;
    });
    return pairs.join(', ') + '…';
  }

  /* ---- State management ---- */

  private async restoreMessages(): Promise<void> {
    if (!this.memory) {
      return;
    }

    const persisted = await this.memory.load(this.currentInstanceId);
    this.messages.splice(0, this.messages.length, ...persisted.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    })));

    await this.postState();
  }

  private async persistMessages(): Promise<void> {
    if (!this.memory) {
      return;
    }

    const persisted: PersistedMessage[] = this.messages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    }));

    await this.memory.save(this.currentInstanceId, persisted);
  }

  private async rehydrateWebview(): Promise<void> {
    await this.restoreMessages();
    await this.postState();
    this._sendModelUpdate();

    // If a streaming response is in progress, restore the full accumulated content.
    // This handles the case where the webview was fully destroyed and recreated
    // (retainContextWhenHidden prevents this in most cases, but not panel close/reopen).
    if (this.streaming && this.streamingContent) {
      await this.postMessage({ type: 'stream-start' });
      await this.postMessage({ type: 'stream-chunk', chunk: this.streamingContent });
      // Also tell the webview to show steering UI (stop button, changed placeholder)
      // by sending a synthetic stream-start first (already done above)
    }

    // Restore draft text in the prompt input
    if (this.draftText) {
      await this.postMessage({ type: 'restoreDraft', text: this.draftText });
    }
  }

  private async postState(): Promise<void> {
    await this.postMessage({
      type: 'state',
      state: {
        messages: [...this.messages],
      },
    });
  }

  private async postMessage(message: ExtensionToWebviewMessage): Promise<void> {
    await this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = String(Date.now());
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DreamGraph Chat</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
    }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex;
      flex-direction: column;
    }
    /* Config header */
    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    .header select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      padding: 2px 4px;
      font-size: 11px;
      font-family: inherit;
      flex: 1;
      min-width: 0;
    }
    #messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
    }
    .message {
      padding: 8px 10px;
      border-radius: 8px;
      white-space: pre-wrap;
      word-break: break-word;
      max-width: 90%;
    }
    .user {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      align-self: flex-end;
    }
    .assistant, .system {
      background: var(--vscode-editor-inactiveSelectionBackground);
      color: var(--vscode-foreground);
      align-self: flex-start;
    }
    .error-msg {
      color: var(--vscode-errorForeground);
      border: 1px solid var(--vscode-errorForeground);
      text-align: center;
      align-self: center;
      font-size: 0.9em;
      padding: 8px 10px;
      border-radius: 8px;
    }
    .error-msg a { color: var(--vscode-textLink-foreground); cursor: pointer; }
    #composer {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    #prompt {
      flex: 1;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      outline: none;
    }
    #prompt:focus {
      border-color: var(--vscode-focusBorder);
    }
    #prompt::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    button {
      padding: 6px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    #clear {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    #clear:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
    .streaming-cursor::after {
      content: '▊';
      animation: blink 1s step-start infinite;
    }
    @keyframes blink {
      50% { opacity: 0; }
    }
  </style>
</head>
<body>
  <div class="header">
    <select id="providerSelect" title="Provider">
      <option value="">Provider…</option>
      <option value="anthropic">anthropic</option>
      <option value="openai">openai</option>
      <option value="ollama">ollama</option>
    </select>
    <select id="modelSelect" title="Model">
      <option value="">Model…</option>
    </select>
  </div>

  <div id="messages"></div>
  <form id="composer">
    <input id="prompt" type="text" placeholder="Ask DreamGraph…" autocomplete="off" />
    <button id="sendBtn" type="submit">Send</button>
    <button id="stopBtn" type="button" style="display:none;background:var(--vscode-errorForeground);color:#fff">Stop</button>
    <button id="clear" type="button">Clear</button>
  </form>

  <script nonce="${nonce}">
    (function() {
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const form = document.getElementById('composer');
    const promptEl = document.getElementById('prompt');
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    const clearEl = document.getElementById('clear');
    const providerSelect = document.getElementById('providerSelect');
    const modelSelect = document.getElementById('modelSelect');
    let streamingEl = null;

    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function createBubble(role, content) {
      const div = document.createElement('div');
      div.className = 'message ' + role;
      div.textContent = content;
      return div;
    }

    function render(messages) {
      messagesEl.innerHTML = '';
      streamingEl = null;
      for (const message of messages) {
        messagesEl.appendChild(createBubble(message.role, message.content));
      }
      scrollToBottom();
    }

    /* ---- Provider / model change ---- */
    providerSelect.addEventListener('change', function() {
      vscode.postMessage({ type: 'changeProvider', provider: this.value });
    });
    modelSelect.addEventListener('change', function() {
      vscode.postMessage({ type: 'changeModel', model: this.value });
    });

    function updateModels(providers, models, current) {
      providerSelect.value = current.provider || '';

      modelSelect.innerHTML = '';
      if (models.length === 0) {
        var opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Model…';
        modelSelect.appendChild(opt);
      }
      models.forEach(function(m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelSelect.appendChild(opt);
      });

      // "Custom…" entry for free-text model names
      var customOpt = document.createElement('option');
      customOpt.value = '__custom__';
      customOpt.textContent = 'Custom model…';
      modelSelect.appendChild(customOpt);

      modelSelect.value = current.model || '';
    }

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function showError(message) {
      var el = document.createElement('div');
      el.className = 'message error-msg';
      if (message.indexOf('API key') !== -1 || message.indexOf('Set Architect') !== -1) {
        el.innerHTML = escapeHtml(message)
          + '<br><a href="#" id="setKeyLink">Set API Key</a>';
        messagesEl.appendChild(el);
        el.querySelector('#setKeyLink').addEventListener('click', function(e) {
          e.preventDefault();
          vscode.postMessage({ type: 'setApiKey' });
        });
      } else {
        el.textContent = message;
        messagesEl.appendChild(el);
      }
      scrollToBottom();
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'state':
          if (message.state) {
            render(message.state.messages || []);
          }
          break;
        case 'addMessage':
          if (message.message) {
            messagesEl.appendChild(createBubble(message.message.role, message.message.content));
            scrollToBottom();
          }
          break;
        case 'stream-start':
          streamingEl = createBubble('assistant', '');
          streamingEl.classList.add('streaming-cursor');
          messagesEl.appendChild(streamingEl);
          scrollToBottom();
          // Keep input enabled so user can send steering prompts
          promptEl.placeholder = 'Steer the conversation…';
          sendBtn.textContent = 'Steer';
          stopBtn.style.display = '';
          break;
        case 'stream-chunk':
          if (streamingEl && message.chunk) {
            streamingEl.textContent += message.chunk;
            scrollToBottom();
          }
          break;
        case 'stream-end':
          if (streamingEl) {
            streamingEl.classList.remove('streaming-cursor');
            streamingEl = null;
          }
          promptEl.disabled = false;
          promptEl.placeholder = 'Ask DreamGraph…';
          sendBtn.textContent = 'Send';
          sendBtn.style.display = '';
          stopBtn.style.display = 'none';
          promptEl.focus();
          break;
        case 'updateModels':
          updateModels(message.providers, message.models, message.current);
          break;
        case 'error':
          if (message.error) {
            showError(message.error);
          }
          break;
        case 'restoreDraft':
          if (message.text) {
            promptEl.value = message.text;
            vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: message.text }));
          }
          break;
      }
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = promptEl.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'send', text });
      promptEl.value = '';
      vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: '' }));
      vscode.postMessage({ type: 'saveDraft', text: '' });
    });

    stopBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'stop' });
    });

    clearEl.addEventListener('click', () => {
      vscode.postMessage({ type: 'clear' });
    });

    /* ---- Draft persistence ---- */
    // Restore from VS Code webview state (survives hide/show within same lifecycle)
    var savedState = vscode.getState();
    if (savedState && savedState.draft) {
      promptEl.value = savedState.draft;
    }

    // Save draft on every input keystroke
    promptEl.addEventListener('input', function() {
      var draft = promptEl.value;
      vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: draft }));
      vscode.postMessage({ type: 'saveDraft', text: draft });
    });

    // Listen for restoreDraft from extension host (handles full webview recreation)
    // Already wired in the message listener above — add the case:
    // (handled inside the existing message switch)

    vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }
}
