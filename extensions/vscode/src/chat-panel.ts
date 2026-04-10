/**
 * DreamGraph Chat Panel — M5 WebviewPanel controller.
 *
 * Owns all chat state (messages, streaming, model selection).
 * The webview is a dumb renderer — the extension host is the single source of truth.
 *
 * @see TDD §7.1.1 (Webview Architecture), §7.2 (Model Selector), §7.3 (Chat Message),
 *      §7.4 (Chat Flow)
 */

import * as vscode from "vscode";
import {
  ArchitectLlm,
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  type ArchitectMessage,
  type ArchitectProvider,
  type ToolDefinition,
  type ToolUseRequest,
  type ArchitectToolResponse,
} from "./architect-llm.js";
import { ContextBuilder } from "./context-builder.js";
import { assemblePrompt, inferTask, type ArchitectTask } from "./prompts/index.js";
import type { McpClient } from "./mcp-client.js";
import type { EditorContextEnvelope, IntentMode } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Chat message type (§7.3)                                          */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  metadata?: {
    toolsUsed: { name: string; duration_ms: number; result_summary: string }[];
    resourcesRead: string[];
    intentMode: IntentMode;
    confidence?: number;
    warnings: { severity: "info" | "warning" | "error"; message: string; source: string }[];
    fileReferences: { path: string; line?: number; description: string }[];
    reasoningBasis: {
      features: string[];
      adrs: string[];
      workflows: string[];
      uiElements: string[];
      tensions: string[];
      summary: string;
    };
    proposedChanges: { path: string; description: string }[];
  };
}

/* ------------------------------------------------------------------ */
/*  Message protocol (§7.1.1)                                         */
/* ------------------------------------------------------------------ */

type ExtensionToWebviewMessage =
  | { type: "addMessage"; message: SerializedChatMessage }
  | { type: "streamChunk"; content: string; messageId: string }
  | { type: "streamEnd"; messageId: string }
  | { type: "setLoading"; loading: boolean }
  | { type: "updateModels"; providers: string[]; models: string[]; current: { provider: string; model: string } }
  | { type: "error"; message: string };

type WebviewToExtensionMessage =
  | { type: "sendMessage"; content: string }
  | { type: "changeProvider"; provider: string }
  | { type: "changeModel"; model: string }
  | { type: "openFile"; filePath: string; line?: number }
  | { type: "setApiKey" }
  | { type: "ready" };

/** JSON-safe version of ChatMessage */
interface SerializedChatMessage {
  role: string;
  content: string;
  timestamp: string;
  metadata?: ChatMessage["metadata"];
}

/* ------------------------------------------------------------------ */
/*  Chat Panel Controller                                             */
/* ------------------------------------------------------------------ */

export class ChatPanel implements vscode.Disposable {
  private _panel: vscode.WebviewPanel | null = null;
  private _messages: ChatMessage[] = [];
  private _disposables: vscode.Disposable[] = [];
  private _isStreaming = false;
  private _streamAbort: AbortController | null = null;
  private _mcpTools: ToolDefinition[] = [];

  /**
   * Hard cap on characters fed back to the Architect per tool result.
   * ~1500 chars ≈ ~400 tokens. The daemon's small models do the heavy
   * lifting; the Architect only needs a status summary.
   */
  private static readonly TOOL_RESULT_MAX_CHARS = 1500;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _architectLlm: ArchitectLlm,
    private readonly _contextBuilder: ContextBuilder,
    private readonly _mcpClient: McpClient,
  ) {}

  get isVisible(): boolean {
    return this._panel?.visible ?? false;
  }

  /* ---- Panel lifecycle ---- */

  /**
   * Open or reveal the chat panel.
   */
  open(): void {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      "dreamgraph-chat",
      "DreamGraph Chat",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [this._extensionUri],
      },
    );

    this._panel.webview.html = this._getHtml(this._panel.webview);

    // Handle messages from webview
    this._disposables.push(
      this._panel.webview.onDidReceiveMessage(
        (msg: WebviewToExtensionMessage) => void this._handleWebviewMessage(msg),
      ),
    );

    // Handle panel disposal
    this._panel.onDidDispose(
      () => {
        this._panel = null;
        this._cancelStream();
      },
      null,
      this._disposables,
    );

    // Re-send state when panel becomes visible again
    this._disposables.push(
      this._panel.onDidChangeViewState(() => {
        if (this._panel?.visible) {
          this._resendState();
        }
      }),
    );
  }

  /**
   * Add a message from an external command (e.g., explainFile result).
   */
  addExternalMessage(role: "user" | "assistant" | "system", content: string): void {
    const msg: ChatMessage = { role, content, timestamp: new Date() };
    this._messages.push(msg);
    this._postMessage({ type: "addMessage", message: this._serialize(msg) });
  }

  /* ---- Webview message handler ---- */

  private async _handleWebviewMessage(msg: WebviewToExtensionMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        this._resendState();
        break;

      case "sendMessage":
        await this._handleUserMessage(msg.content);
        break;

      case "changeProvider":
        await this._changeProvider(msg.provider as ArchitectProvider);
        break;

      case "changeModel":
        if (msg.model === "__custom__") {
          const custom = await vscode.window.showInputBox({
            prompt: "Enter a custom model name",
            placeHolder: "e.g. claude-sonnet-4",
          });
          if (custom) {
            await this._changeModel(custom);
          } else {
            // User cancelled — resend current state so dropdown reverts
            this._sendModelUpdate();
          }
        } else {
          await this._changeModel(msg.model);
        }
        break;

      case "openFile":
        await this._openFile(msg.filePath, msg.line);
        break;

      case "setApiKey":
        await vscode.commands.executeCommand("dreamgraph.setArchitectApiKey");
        break;
    }
  }

  /* ---- Chat message handling ---- */

  private async _handleUserMessage(content: string): Promise<void> {
    if (this._isStreaming) return;

    // Check configuration
    if (!this._architectLlm.isConfigured) {
      this._postMessage({
        type: "error",
        message: "Architect not configured. Set provider and model in settings, then set your API key.",
      });
      return;
    }

    // Add user message
    const userMsg: ChatMessage = { role: "user", content, timestamp: new Date() };
    this._messages.push(userMsg);
    this._postMessage({ type: "addMessage", message: this._serialize(userMsg) });
    this._postMessage({ type: "setLoading", loading: true });

    try {
      // Fetch MCP tool definitions if not cached
      await this._refreshMcpTools();

      // Build context envelope
      const envelope = await this._contextBuilder.buildEnvelope(content);
      const fileContent = this._contextBuilder.readActiveFileContent();

      // Assemble context block
      const contextBlock = this._contextBuilder.assembleContextBlock(
        envelope,
        fileContent,
        new Map(),
      );

      // Infer task and assemble prompt
      const task = inferTask(envelope.intentMode);
      const { system } = assemblePrompt(task, envelope, contextBlock.text);

      // Build initial message array for the API
      // We track raw API messages separately for tool_use/tool_result round-trips
      const provider = this._architectLlm.currentConfig?.provider ?? "anthropic";
      const rawApiMessages: unknown[] = [];

      // Include recent conversation history (last 10 messages for context)
      const historyWindow = this._messages.slice(-11, -1);
      for (const m of historyWindow) {
        if (m.role === "user" || m.role === "assistant") {
          rawApiMessages.push({ role: m.role, content: m.content });
        }
      }

      // Add current user message
      rawApiMessages.push({ role: "user", content });

      // Also build ArchitectMessage array for system prompt extraction
      const llmMessages: ArchitectMessage[] = [
        { role: "system", content: system },
      ];

      // Agentic tool loop — up to 25 iterations
      const MAX_TOOL_ROUNDS = 25;
      let round = 0;
      let fullContent = "";
      const toolsUsed: ChatMessage["metadata"] extends undefined ? never : NonNullable<ChatMessage["metadata"]>["toolsUsed"] = [];
      this._isStreaming = true;
      const messageId = `msg-${Date.now()}`;

      while (round < MAX_TOOL_ROUNDS) {
        round++;

        // Call LLM with tools
        const response: ArchitectToolResponse = await this._architectLlm.callWithTools(
          llmMessages,
          this._mcpTools,
          rawApiMessages,
        );

        // Accumulate text content
        if (response.content) {
          fullContent += response.content;
          this._postMessage({ type: "streamChunk", content: response.content, messageId });
        }

        // If no tool calls, we're done
        if (response.toolCalls.length === 0 || response.stopReason !== "tool_use") {
          break;
        }

        // Execute tool calls via MCP
        // First, add the assistant response (with tool_use blocks) to rawApiMessages
        if (provider === "anthropic") {
          const assistantContent: unknown[] = [];
          if (response.content) {
            assistantContent.push({ type: "text", text: response.content });
          }
          for (const tc of response.toolCalls) {
            assistantContent.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });
          }
          rawApiMessages.push({ role: "assistant", content: assistantContent });
        } else if (provider === "openai") {
          rawApiMessages.push({
            role: "assistant",
            content: response.content || null,
            tool_calls: response.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: JSON.stringify(tc.input) },
            })),
          });
        }

        // Show tool calls in the UI
        const toolStatusParts: string[] = [];
        for (const tc of response.toolCalls) {
          toolStatusParts.push(`\n\n🔧 **Calling tool:** \`${tc.name}\``);
          if (Object.keys(tc.input).length > 0) {
            toolStatusParts.push(`  _args:_ \`${JSON.stringify(tc.input).slice(0, 200)}\``);
          }
        }
        const toolStatusText = toolStatusParts.join("\n");
        fullContent += toolStatusText;
        this._postMessage({ type: "streamChunk", content: toolStatusText, messageId });

        // Execute each tool call via MCP and collect results
        const toolResults: Array<{ id: string; result: string; isError: boolean }> = [];
        for (const tc of response.toolCalls) {
          const toolStart = Date.now();
          let resultText: string;
          let isError = false;
          try {
            const result = await this._mcpClient.callTool(tc.name, tc.input);
            resultText = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          } catch (err) {
            resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
            isError = true;
          }
          const toolDuration = Date.now() - toolStart;

          // Truncate before storing — the Architect gets a compact summary,
          // not the raw multi-KB payload. The daemon's small models already
          // did the abstraction; prevent million-token context blowup.
          const truncatedResult = isError
            ? resultText
            : this._truncateToolResult(tc.name, resultText);

          toolResults.push({ id: tc.id, result: truncatedResult, isError });
          toolsUsed.push({
            name: tc.name,
            duration_ms: toolDuration,
            result_summary: truncatedResult.slice(0, 200),
          });

          // Show abbreviated result in UI
          const resultPreview = resultText.length > 500
            ? resultText.slice(0, 500) + "…"
            : resultText;
          const resultStatus = isError
            ? `\n❌ **${tc.name}** failed: ${resultPreview}`
            : `\n✅ **${tc.name}** completed (${toolDuration}ms)`;
          fullContent += resultStatus;
          this._postMessage({ type: "streamChunk", content: resultStatus, messageId });
        }

        // Feed tool results back to the LLM
        if (provider === "anthropic") {
          rawApiMessages.push({
            role: "user",
            content: toolResults.map((tr) => ({
              type: "tool_result",
              tool_use_id: tr.id,
              content: tr.result,
              ...(tr.isError ? { is_error: true } : {}),
            })),
          });
        } else if (provider === "openai") {
          for (const tr of toolResults) {
            rawApiMessages.push({
              role: "tool",
              tool_call_id: tr.id,
              content: tr.result,
            });
          }
        }
      }

      // Stream complete
      this._postMessage({ type: "streamEnd", messageId });

      // Store assistant message
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: fullContent,
        timestamp: new Date(),
        metadata: {
          toolsUsed,
          resourcesRead: [],
          intentMode: envelope.intentMode,
          confidence: envelope.intentConfidence,
          warnings: [],
          fileReferences: [],
          reasoningBasis: {
            features: envelope.graphContext?.relatedFeatures ?? [],
            adrs: envelope.graphContext?.applicableAdrs ?? [],
            workflows: envelope.graphContext?.relatedWorkflows ?? [],
            uiElements: envelope.graphContext?.uiPatterns ?? [],
            tensions: [],
            summary: this._buildReasoningSummary(envelope),
          },
          proposedChanges: [],
        },
      };
      this._messages.push(assistantMsg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this._postMessage({ type: "error", message: errMsg });
    } finally {
      this._isStreaming = false;
      this._postMessage({ type: "setLoading", loading: false });
    }
  }

  /* ---- MCP Tool Discovery ---- */

  /**
   * Fetch available MCP tools from the daemon and cache them as ToolDefinitions.
   * If the client isn't connected, attempts to connect first.
   * Posts a warning to the chat if tools can't be loaded.
   */
  private async _refreshMcpTools(): Promise<void> {
    try {
      // Auto-connect if not already connected
      if (!this._mcpClient.isConnected) {
        try {
          await this._mcpClient.connect();
        } catch {
          this._postMessage({
            type: "streamChunk",
            content: "\n\n⚠️ **Cannot reach DreamGraph daemon** — MCP tools are unavailable. " +
              "Make sure the daemon is running and the connection is configured " +
              "(`dreamgraph.daemonHost` / `dreamgraph.daemonPort` in settings, or run **DreamGraph: Connect**).\n\n",
            messageId: `warn-${Date.now()}`,
          });
          return;
        }
      }
      const tools = await this._mcpClient.listTools();
      this._mcpTools = tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      }));
    } catch {
      // Keep existing cache if refresh fails
      if (this._mcpTools.length === 0) {
        this._postMessage({
          type: "streamChunk",
          content: "\n\n⚠️ **Failed to load MCP tools from daemon.** The Architect will respond without tool access.\n\n",
          messageId: `warn-${Date.now()}`,
        });
      }
    }
  }

  /* ---- Provider / model switching ---- */

  private async _changeProvider(provider: ArchitectProvider): Promise<void> {
    await vscode.workspace
      .getConfiguration("dreamgraph.architect")
      .update("provider", provider, vscode.ConfigurationTarget.Workspace);

    // Also update base URL to match the new provider's default
    const defaultUrls: Record<string, string> = {
      anthropic: "https://api.anthropic.com/v1",
      openai: "https://api.openai.com/v1",
      ollama: "http://localhost:11434",
    };
    if (defaultUrls[provider]) {
      await vscode.workspace
        .getConfiguration("dreamgraph.architect")
        .update("baseUrl", defaultUrls[provider], vscode.ConfigurationTarget.Workspace);
    }

    // Clear model so user picks a valid one for the new provider
    await vscode.workspace
      .getConfiguration("dreamgraph.architect")
      .update("model", undefined, vscode.ConfigurationTarget.Workspace);

    await this._architectLlm.loadConfig();
    this._sendModelUpdate();
  }

  private async _changeModel(model: string): Promise<void> {
    await vscode.workspace
      .getConfiguration("dreamgraph.architect")
      .update("model", model, vscode.ConfigurationTarget.Workspace);
    await this._architectLlm.loadConfig();
    this._sendModelUpdate();
  }

  private _sendModelUpdate(): void {
    const config = this._architectLlm.currentConfig;
    const provider = config?.provider ?? "";
    const currentModel = config?.model ?? "";
    const presetModels = this._getModelsForProvider(provider as ArchitectProvider);

    // Ensure the current model always appears in the list (handles custom names)
    const models = currentModel && !presetModels.includes(currentModel)
      ? [currentModel, ...presetModels]
      : presetModels;

    this._postMessage({
      type: "updateModels",
      providers: ["anthropic", "openai", "ollama"],
      models,
      current: {
        provider,
        model: currentModel,
      },
    });
  }

  private _getModelsForProvider(provider: ArchitectProvider): string[] {
    switch (provider) {
      case "anthropic":
        return [...ANTHROPIC_MODELS];
      case "openai":
        return [...OPENAI_MODELS];
      case "ollama":
        return []; // Dynamic — fetched separately
      default:
        return [];
    }
  }

  /* ---- File navigation ---- */

  private async _openFile(filePath: string, line?: number): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) return;

    const uri = vscode.Uri.joinPath(workspaceRoot, filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

    if (line !== undefined) {
      const position = new vscode.Position(line - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  /* ---- State management ---- */

  private _resendState(): void {
    if (!this._panel) return;

    // Send model state
    this._sendModelUpdate();

    // Re-send all messages
    for (const msg of this._messages) {
      this._postMessage({ type: "addMessage", message: this._serialize(msg) });
    }

    // Check for API key warning
    this._checkApiKeyWarning();
  }

  private async _checkApiKeyWarning(): Promise<void> {
    const config = this._architectLlm.currentConfig;
    if (!config?.provider) {
      this._postMessage({
        type: "error",
        message: 'No Architect provider configured. Set "dreamgraph.architect.provider" in settings.',
      });
      return;
    }

    if (config.provider !== "ollama" && !config.apiKey) {
      this._postMessage({
        type: "error",
        message: `No API key configured for ${config.provider}. Use "DreamGraph: Set Architect API Key" to store one.`,
      });
    }
  }

  private _cancelStream(): void {
    if (this._streamAbort) {
      this._streamAbort.abort();
      this._streamAbort = null;
    }
    this._isStreaming = false;
  }

  /* ---- Helpers ---- */

  private _serialize(msg: ChatMessage): SerializedChatMessage {
    return {
      role: msg.role,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
      metadata: msg.metadata,
    };
  }

  private _buildReasoningSummary(envelope: EditorContextEnvelope): string {
    const parts: string[] = [];
    const gc = envelope.graphContext;
    if (!gc) return "No graph context available";

    if (gc.applicableAdrs.length > 0) {
      parts.push(...gc.applicableAdrs.slice(0, 3));
    }
    if (gc.relatedFeatures.length > 0) {
      parts.push(...gc.relatedFeatures.slice(0, 3));
    }
    if (gc.relatedWorkflows.length > 0) {
      parts.push(...gc.relatedWorkflows.slice(0, 2));
    }

    return parts.length > 0 ? `Based on: ${parts.join(", ")}` : "Based on: file content only (no graph context)";
  }

  /* ---- Tool Result Truncation ---- */

  /**
   * Compress a raw tool result into a compact summary suitable for the
   * Architect LLM. The daemon's small models already did the heavy work;
   * the Architect only needs enough to decide the next step.
   *
   * Strategy:
   * 1. For known tools, extract just the status/summary fields.
   * 2. For JSON payloads, extract top-level keys and counts.
   * 3. Hard-cap at TOOL_RESULT_MAX_CHARS.
   */
  private _truncateToolResult(toolName: string, raw: string): string {
    const MAX = ChatPanel.TOOL_RESULT_MAX_CHARS;

    // Short results pass through
    if (raw.length <= MAX) return raw;

    // Try to parse as JSON and extract a summary
    try {
      const parsed = JSON.parse(raw);

      // Success/error wrapper: { ok, data } or { ok, error }
      if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
        if (parsed.ok && parsed.data) {
          return this._summarizeObject(toolName, parsed.data, MAX);
        }
        if (!parsed.ok && parsed.error) {
          return JSON.stringify({ ok: false, error: parsed.error }).slice(0, MAX);
        }
      }

      // Direct object/array
      return this._summarizeObject(toolName, parsed, MAX);
    } catch {
      // Not JSON — just hard truncate
      return raw.slice(0, MAX) + `\n... [truncated, ${raw.length} chars total]`;
    }
  }

  /**
   * Produce a compact summary of a parsed tool result object.
   */
  private _summarizeObject(toolName: string, obj: unknown, max: number): string {
    // Arrays: show count + first few items
    if (Array.isArray(obj)) {
      const preview = obj.slice(0, 3).map((item) => {
        if (typeof item === "object" && item !== null) {
          const keys = ["id", "name", "title", "message", "status", "type"];
          const pick: Record<string, unknown> = {};
          for (const k of keys) {
            if (k in item) pick[k] = (item as Record<string, unknown>)[k];
          }
          return Object.keys(pick).length > 0 ? pick : "[object]";
        }
        return item;
      });
      const summary = JSON.stringify({
        _tool: toolName,
        _count: obj.length,
        _preview: preview,
      });
      return summary.slice(0, max);
    }

    // Objects: extract known summary fields, drop bulk data
    if (typeof obj === "object" && obj !== null) {
      const record = obj as Record<string, unknown>;
      const summaryKeys = [
        "message", "summary", "status", "ok", "error",
        "entries_received", "entries_inserted", "entries_updated",
        "total_entries", "index_entries", "target", "file", "mode",
        "validation_errors", "count", "name", "id", "repos",
        "features_count", "workflows_count", "data_model_count",
        "capabilities_count", "total_files", "total_entities",
      ];

      const compact: Record<string, unknown> = { _tool: toolName };
      for (const k of summaryKeys) {
        if (k in record) {
          const val = record[k];
          // Truncate nested arrays to counts
          if (Array.isArray(val)) {
            compact[k] = val.length <= 5 ? val : `[${val.length} items]`;
          } else {
            compact[k] = val;
          }
        }
      }

      // If we got nothing useful, list the top-level keys
      if (Object.keys(compact).length <= 1) {
        compact._keys = Object.keys(record).slice(0, 20);
        for (const k of Object.keys(record).slice(0, 5)) {
          const v = record[k];
          if (typeof v === "string" && v.length <= 200) compact[k] = v;
          else if (typeof v === "number" || typeof v === "boolean") compact[k] = v;
          else if (Array.isArray(v)) compact[k] = `[${v.length} items]`;
        }
      }

      return JSON.stringify(compact).slice(0, max);
    }

    // Primitives
    return String(obj).slice(0, max);
  }

  private _postMessage(msg: ExtensionToWebviewMessage): void {
    this._panel?.webview.postMessage(msg);
  }

  /* ---- Webview HTML ---- */

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>DreamGraph Chat</title>
  <style nonce="${nonce}">
    :root {
      --dg-bg: var(--vscode-editor-background);
      --dg-fg: var(--vscode-editor-foreground);
      --dg-input-bg: var(--vscode-input-background);
      --dg-input-fg: var(--vscode-input-foreground);
      --dg-input-border: var(--vscode-input-border);
      --dg-button-bg: var(--vscode-button-background);
      --dg-button-fg: var(--vscode-button-foreground);
      --dg-button-hover: var(--vscode-button-hoverBackground);
      --dg-border: var(--vscode-panel-border);
      --dg-user-bg: var(--vscode-textBlockQuote-background);
      --dg-assistant-bg: var(--vscode-editor-background);
      --dg-error: var(--vscode-errorForeground);
      --dg-warning: var(--vscode-editorWarning-foreground);
      --dg-muted: var(--vscode-descriptionForeground);
      --dg-link: var(--vscode-textLink-foreground);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--dg-fg);
      background: var(--dg-bg);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--dg-border);
      flex-shrink: 0;
    }
    .header-title {
      font-weight: 600;
      flex: 1;
    }
    .header select {
      background: var(--dg-input-bg);
      color: var(--dg-input-fg);
      border: 1px solid var(--dg-input-border);
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 12px;
      font-family: inherit;
    }

    /* Messages */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      padding: 10px 14px;
      border-radius: 6px;
      max-width: 95%;
      word-wrap: break-word;
      white-space: pre-wrap;
      line-height: 1.5;
    }
    .message.user {
      background: var(--dg-user-bg);
      align-self: flex-end;
      border: 1px solid var(--dg-border);
    }
    .message.assistant {
      background: var(--dg-assistant-bg);
      align-self: flex-start;
      border: 1px solid var(--dg-border);
    }
    .message.system {
      color: var(--dg-muted);
      font-style: italic;
      font-size: 0.9em;
      text-align: center;
      align-self: center;
    }
    .message.error {
      color: var(--dg-error);
      border: 1px solid var(--dg-error);
      text-align: center;
      align-self: center;
      font-size: 0.9em;
    }

    .message .reasoning-basis {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--dg-border);
      font-size: 0.85em;
      color: var(--dg-muted);
    }

    .message .timestamp {
      font-size: 0.8em;
      color: var(--dg-muted);
      margin-top: 4px;
    }

    .message code {
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.95em;
    }

    .message pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px 12px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 6px 0;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      line-height: 1.4;
    }

    .streaming-cursor::after {
      content: "▌";
      animation: blink 0.7s step-end infinite;
    }
    @keyframes blink { 50% { opacity: 0; } }

    /* Loading indicator */
    .loading {
      display: none;
      align-self: center;
      color: var(--dg-muted);
      font-style: italic;
      padding: 8px;
    }
    .loading.visible { display: block; }

    /* Input area */
    .input-area {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--dg-border);
      flex-shrink: 0;
    }
    .input-area textarea {
      flex: 1;
      background: var(--dg-input-bg);
      color: var(--dg-input-fg);
      border: 1px solid var(--dg-input-border);
      border-radius: 4px;
      padding: 8px 10px;
      font-family: inherit;
      font-size: inherit;
      resize: none;
      min-height: 40px;
      max-height: 120px;
      line-height: 1.4;
    }
    .input-area textarea:focus {
      outline: 1px solid var(--dg-button-bg);
    }
    .input-area button {
      background: var(--dg-button-bg);
      color: var(--dg-button-fg);
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      align-self: flex-end;
    }
    .input-area button:hover {
      background: var(--dg-button-hover);
    }
    .input-area button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-title">DreamGraph Chat</span>
    <select id="providerSelect" title="Provider">
      <option value="">Select provider…</option>
      <option value="anthropic">anthropic</option>
      <option value="openai">openai</option>
      <option value="ollama">ollama</option>
    </select>
    <select id="modelSelect" title="Model">
      <option value="">Select model…</option>
    </select>
  </div>

  <div class="messages" id="messages"></div>
  <div class="loading" id="loading">Thinking…</div>

  <div class="input-area">
    <textarea id="input" placeholder="Ask the Architect…" rows="1"></textarea>
    <button id="sendBtn">Send</button>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const messagesEl = document.getElementById("messages");
      const loadingEl = document.getElementById("loading");
      const inputEl = document.getElementById("input");
      const sendBtn = document.getElementById("sendBtn");
      const providerSelect = document.getElementById("providerSelect");
      const modelSelect = document.getElementById("modelSelect");

      let streamingEl = null;

      /* ---- Send message ---- */
      function send() {
        const content = inputEl.value.trim();
        if (!content) return;
        vscode.postMessage({ type: "sendMessage", content: content });
        inputEl.value = "";
        inputEl.style.height = "40px";
      }

      sendBtn.addEventListener("click", send);
      inputEl.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });

      /* Auto-resize textarea */
      inputEl.addEventListener("input", function() {
        this.style.height = "40px";
        this.style.height = Math.min(this.scrollHeight, 120) + "px";
      });

      /* ---- Provider/model change ---- */
      providerSelect.addEventListener("change", function() {
        vscode.postMessage({ type: "changeProvider", provider: this.value });
      });
      modelSelect.addEventListener("change", function() {
        vscode.postMessage({ type: "changeModel", model: this.value });
      });

      /* ---- Receive messages from extension ---- */
      window.addEventListener("message", function(event) {
        const msg = event.data;
        switch (msg.type) {
          case "addMessage":
            addMessage(msg.message);
            break;
          case "streamChunk":
            appendStreamChunk(msg.content, msg.messageId);
            break;
          case "streamEnd":
            endStream(msg.messageId);
            break;
          case "setLoading":
            loadingEl.classList.toggle("visible", msg.loading);
            sendBtn.disabled = msg.loading;
            break;
          case "updateModels":
            updateModels(msg.providers, msg.models, msg.current);
            break;
          case "error":
            showError(msg.message);
            break;
        }
      });

      function addMessage(msg) {
        const el = document.createElement("div");
        el.className = "message " + msg.role;
        el.innerHTML = escapeHtml(msg.content);

        if (msg.metadata && msg.metadata.reasoningBasis && msg.metadata.reasoningBasis.summary) {
          const basis = document.createElement("div");
          basis.className = "reasoning-basis";
          basis.textContent = msg.metadata.reasoningBasis.summary;
          el.appendChild(basis);
        }

        messagesEl.appendChild(el);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function appendStreamChunk(content, messageId) {
        if (!streamingEl) {
          streamingEl = document.createElement("div");
          streamingEl.className = "message assistant streaming-cursor";
          streamingEl.dataset.messageId = messageId;
          messagesEl.appendChild(streamingEl);
        }
        streamingEl.textContent += content;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function endStream(messageId) {
        if (streamingEl) {
          streamingEl.classList.remove("streaming-cursor");
          streamingEl = null;
        }
      }

      function updateModels(providers, models, current) {
        providerSelect.value = current.provider || "";

        /* Rebuild model dropdown */
        modelSelect.innerHTML = "";
        if (models.length === 0) {
          var opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "Select model…";
          modelSelect.appendChild(opt);
        }
        models.forEach(function(m) {
          var opt = document.createElement("option");
          opt.value = m;
          opt.textContent = m;
          modelSelect.appendChild(opt);
        });

        /* Add "Custom…" entry to allow free-text model names */
        var customOpt = document.createElement("option");
        customOpt.value = "__custom__";
        customOpt.textContent = "Custom model…";
        modelSelect.appendChild(customOpt);

        modelSelect.value = current.model || "";
      }

      function showError(message) {
        var el = document.createElement("div");
        el.className = "message error";

        /* Make "Set Architect API Key" clickable */
        if (message.indexOf("Set Architect API Key") !== -1) {
          el.innerHTML = escapeHtml(message) +
            '<br><a href="#" style="color:var(--dg-link);cursor:pointer" id="setKeyLink">Set API Key</a>';
          el.querySelector("#setKeyLink").addEventListener("click", function(e) {
            e.preventDefault();
            vscode.postMessage({ type: "setApiKey" });
          });
        } else {
          el.textContent = message;
        }

        messagesEl.appendChild(el);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function escapeHtml(text) {
        var div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
      }

      /* Signal readiness */
      vscode.postMessage({ type: "ready" });
    })();
  </script>
</body>
</html>`;
  }

  /* ---- Dispose ---- */

  dispose(): void {
    this._cancelStream();
    this._panel?.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}

/* ------------------------------------------------------------------ */
/*  Utility                                                           */
/* ------------------------------------------------------------------ */

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
