/**
 * DreamGraph Architect LLM Provider — Layer 2 (Context Orchestration).
 *
 * Calls the Architect model (Anthropic, OpenAI, or Ollama) with
 * structured prompts assembled from the context orchestration layer.
 *
 * v1: Extension-side model execution (§1.3).
 * v2: Daemon-side via POST /api/orchestrate.
 *
 * @see TDD §1.3 (Architect Model), §7.2 (Model Selector), §7.5 (Prompt Architecture)
 */

import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type ArchitectProvider = "anthropic" | "openai" | "ollama";

export interface ArchitectConfig {
  provider: ArchitectProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export interface ArchitectMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ArchitectResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

/** A single tool call requested by the model */
export interface ToolUseRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Extended response that may contain tool calls instead of (or in addition to) text */
export interface ArchitectToolResponse extends ArchitectResponse {
  /** If non-empty, the model wants to call these tools before continuing */
  toolCalls: ToolUseRequest[];
  /** The stop reason from the API */
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | string;
}

/** MCP tool schema passed to the LLM for tool selection */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A tool result to feed back into the conversation */
export interface ToolResultMessage {
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
}

/** Callback for streamed chunks */
export type StreamCallback = (chunk: string) => void;

/* ------------------------------------------------------------------ */
/*  Model Lists (§7.2)                                                */
/* ------------------------------------------------------------------ */

export const ANTHROPIC_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

export const OPENAI_MODELS = [
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
];

/* ------------------------------------------------------------------ */
/*  Provider                                                          */
/* ------------------------------------------------------------------ */

export class ArchitectLlm implements vscode.Disposable {
  private _config: ArchitectConfig | null = null;
  private _secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this._secretStorage = secretStorage;
  }

  get isConfigured(): boolean {
    return this._config !== null && this._config.provider.length > 0;
  }

  get provider(): ArchitectProvider | null {
    return this._config?.provider ?? null;
  }

  get currentConfig(): ArchitectConfig | null {
    return this._config ? { ...this._config } : null;
  }

  /* ---- Configuration ---- */

  /**
   * Load configuration from VS Code settings + SecretStorage.
   */
  async loadConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const provider = (cfg.get<string>("provider") ?? "") as ArchitectProvider;
    const model = cfg.get<string>("model") ?? "";
    const baseUrl = cfg.get<string>("baseUrl") ?? this._defaultBaseUrl(provider);

    let apiKey = "";
    if (provider && provider !== "ollama") {
      apiKey = (await this._secretStorage.get(`dreamgraph.apiKey.${provider}`)) ?? "";
    }

    this._config = { provider, model, baseUrl, apiKey };
  }

  /**
   * Store an API key for a provider in SecretStorage.
   */
  async setApiKey(provider: ArchitectProvider, key: string): Promise<void> {
    await this._secretStorage.store(`dreamgraph.apiKey.${provider}`, key);
    if (this._config && this._config.provider === provider) {
      this._config.apiKey = key;
    }
  }

  /**
   * Get the API key for a provider from SecretStorage.
   */
  async getApiKey(provider: ArchitectProvider): Promise<string | undefined> {
    return this._secretStorage.get(`dreamgraph.apiKey.${provider}`);
  }

  /* ---- LLM Calls ---- */

  /**
   * Send messages to the Architect model and return the full response.
   */
  async call(messages: ArchitectMessage[]): Promise<ArchitectResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._callAnthropic(config, messages, start);
      case "openai":
        return this._callOpenAI(config, messages, start);
      case "ollama":
        return this._callOllama(config, messages, start);
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  /**
   * Send messages and stream the response chunk-by-chunk.
   */
  async stream(
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
  ): Promise<ArchitectResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._streamAnthropic(config, messages, onChunk, start);
      case "openai":
        return this._streamOpenAI(config, messages, onChunk, start);
      case "ollama":
        return this._streamOllama(config, messages, onChunk, start);
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  /* ---- Tool-enhanced call (agentic loop support) ---- */

  /**
   * Call the LLM with MCP tool definitions. Returns an ArchitectToolResponse
   * that may include tool_use requests the caller must execute and feed back.
   */
  async callWithTools(
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    rawMessages?: unknown[],
  ): Promise<ArchitectToolResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._callAnthropicWithTools(config, messages, tools, start, rawMessages);
      case "openai":
        return this._callOpenAIWithTools(config, messages, tools, start, rawMessages);
      case "ollama":
        // Ollama doesn't support tool use — fall back to regular call
        const resp = await this._callOllama(config, messages, start);
        return { ...resp, toolCalls: [], stopReason: "end_turn" };
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  /* ---- Anthropic ---- */

  private async _callAnthropic(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
  ): Promise<ArchitectResponse> {
    const { system, userMessages } = this._splitSystem(messages);
    const body = {
      model: config.model,
      max_tokens: 8192,
      ...(system ? { system } : {}),
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const content = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content,
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _callAnthropicWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
  ): Promise<ArchitectToolResponse> {
    const { system, userMessages } = this._splitSystem(messages);

    // Build Anthropic tool definitions
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));

    // Build messages — use raw messages (with tool_use/tool_result blocks) if provided
    const apiMessages = rawMessages ?? userMessages.map((m) => ({ role: m.role, content: m.content }));

    const body = {
      model: config.model,
      max_tokens: 8192,
      ...(system ? { system } : {}),
      tools: anthropicTools,
      messages: apiMessages,
    };

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    // Extract text content
    const textContent = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    // Extract tool_use blocks
    const toolCalls: ToolUseRequest[] = data.content
      .filter((c) => c.type === "tool_use")
      .map((c) => ({
        id: c.id!,
        name: c.name!,
        input: c.input ?? {},
      }));

    return {
      content: textContent,
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls,
      stopReason: data.stop_reason ?? "end_turn",
    };
  }

  /**
   * Translate Anthropic-style raw messages (tool_use / tool_result content
   * blocks) into OpenAI-compatible messages (tool_calls + role:"tool").
   * Messages that are already plain strings pass through unchanged.
   */
  private _translateRawToOpenAI(raw: unknown[]): unknown[] {
    const out: unknown[] = [];

    for (const msg of raw) {
      const m = msg as Record<string, unknown>;
      const role = m.role as string;
      const content = m.content;

      // Plain string content — pass through
      if (typeof content === 'string') {
        out.push({ role, content });
        continue;
      }

      // Array content — may contain Anthropic-style blocks
      if (!Array.isArray(content)) {
        out.push(msg);
        continue;
      }

      const blocks = content as Array<Record<string, unknown>>;

      if (role === 'assistant') {
        // Extract text + tool_use blocks → OpenAI assistant message with tool_calls
        const textParts = blocks.filter((b) => b.type === 'text').map((b) => b.text as string);
        const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');

        const openaiMsg: Record<string, unknown> = {
          role: 'assistant',
          content: textParts.join('') || null,
        };

        if (toolUseBlocks.length > 0) {
          openaiMsg.tool_calls = toolUseBlocks.map((b) => ({
            id: b.id as string,
            type: 'function',
            function: {
              name: b.name as string,
              arguments: typeof b.input === 'string' ? b.input : JSON.stringify(b.input),
            },
          }));
        }

        out.push(openaiMsg);
      } else if (role === 'user') {
        // tool_result blocks → separate role:"tool" messages for OpenAI
        const toolResults = blocks.filter((b) => b.type === 'tool_result');
        const nonToolBlocks = blocks.filter((b) => b.type !== 'tool_result');

        // Emit any non-tool-result blocks as a normal user message
        if (nonToolBlocks.length > 0) {
          const text = nonToolBlocks.map((b) => (b.text as string) ?? '').join('');
          if (text) {
            out.push({ role: 'user', content: text });
          }
        }

        // Each tool_result becomes a separate role:"tool" message
        for (const tr of toolResults) {
          out.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id as string,
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          });
        }
      } else {
        // Unknown role — pass through
        out.push(msg);
      }
    }

    return out;
  }

  private async _callOpenAIWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
  ): Promise<ArchitectToolResponse> {
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    // Translate Anthropic-style tool_use/tool_result blocks to OpenAI format
    const apiMessages = rawMessages
      ? this._translateRawToOpenAI(rawMessages)
      : messages.map((m) => ({ role: m.role, content: m.content }));

    // Ensure system message is included (rawMessages filters it out for Anthropic compat,
    // but OpenAI needs it in the messages array)
    const { system } = this._splitSystem(messages);
    if (system && !apiMessages.some((m) => (m as Record<string, unknown>).role === 'system')) {
      apiMessages.unshift({ role: 'system', content: system });
    }

    // Validate body is serializable before sending
    let bodyJson: string;
    try {
      bodyJson = JSON.stringify({
        model: config.model,
        max_completion_tokens: 16384,
        messages: apiMessages,
        tools: openaiTools,
      });
    } catch (serErr) {
      throw new Error(`Failed to serialize OpenAI request body: ${serErr instanceof Error ? serErr.message : String(serErr)}`);
    }

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: bodyJson,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];
    const toolCalls: ToolUseRequest[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls,
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : (choice?.finish_reason ?? "stop"),
    };
  }

  private async _streamAnthropic(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
  ): Promise<ArchitectResponse> {
    const { system, userMessages } = this._splitSystem(messages);
    const body = {
      model: config.model,
      max_tokens: 8192,
      stream: true,
      ...(system ? { system } : {}),
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    return this._readSSEStream(res, onChunk, start, "anthropic");
  }

  /* ---- OpenAI ---- */

  private async _callOpenAI(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_completion_tokens: 16384,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _streamOpenAI(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        max_completion_tokens: 16384,
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    return this._readSSEStream(res, onChunk, start, "openai");
  }

  /* ---- Ollama ---- */

  private async _callOllama(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content ?? "",
      promptTokens: data.prompt_eval_count ?? 0,
      completionTokens: data.eval_count ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _streamOllama(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    // Ollama streams newline-delimited JSON (not SSE)
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line) as {
            message?: { content: string };
            done?: boolean;
            prompt_eval_count?: number;
            eval_count?: number;
          };
          if (chunk.message?.content) {
            const text = chunk.message.content;
            fullContent += text;
            onChunk(text);
          }
          if (chunk.done) {
            promptTokens = chunk.prompt_eval_count ?? 0;
            completionTokens = chunk.eval_count ?? 0;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    return {
      content: fullContent,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - start,
    };
  }

  /* ---- SSE Stream Reader (Anthropic & OpenAI) ---- */

  private async _readSSEStream(
    res: Response,
    onChunk: StreamCallback,
    start: number,
    provider: "anthropic" | "openai",
  ): Promise<ArchitectResponse> {
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);

          if (provider === "anthropic") {
            // Anthropic SSE: content_block_delta with delta.text
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              fullContent += parsed.delta.text;
              onChunk(parsed.delta.text);
            }
            if (parsed.type === "message_delta" && parsed.usage) {
              completionTokens = parsed.usage.output_tokens ?? 0;
            }
            if (parsed.type === "message_start" && parsed.message?.usage) {
              promptTokens = parsed.message.usage.input_tokens ?? 0;
            }
          } else {
            // OpenAI SSE: choices[0].delta.content
            const text = parsed.choices?.[0]?.delta?.content;
            if (text) {
              fullContent += text;
              onChunk(text);
            }
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens ?? 0;
              completionTokens = parsed.usage.completion_tokens ?? 0;
            }
          }
        } catch {
          // Skip malformed SSE events
        }
      }
    }

    return {
      content: fullContent,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - start,
    };
  }

  /* ---- Helpers ---- */

  private _splitSystem(messages: ArchitectMessage[]): {
    system: string | undefined;
    userMessages: ArchitectMessage[];
  } {
    const systemMsgs = messages.filter((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");
    const system =
      systemMsgs.length > 0
        ? systemMsgs.map((m) => m.content).join("\n\n")
        : undefined;
    return { system, userMessages };
  }

  private _defaultBaseUrl(provider: ArchitectProvider): string {
    switch (provider) {
      case "anthropic":
        return "https://api.anthropic.com/v1";
      case "openai":
        return "https://api.openai.com/v1";
      case "ollama":
        return "http://localhost:11434";
      default:
        return "";
    }
  }

  private _ensureConfigured(): void {
    if (!this._config || !this._config.provider) {
      throw new Error(
        'Architect model not configured. Set "dreamgraph.architect.provider" and "dreamgraph.architect.model" in settings.',
      );
    }
    if (!this._config.model) {
      throw new Error(
        'Architect model name not set. Set "dreamgraph.architect.model" in settings.',
      );
    }
    if (
      this._config.provider !== "ollama" &&
      !this._config.apiKey
    ) {
      throw new Error(
        `No API key stored for ${this._config.provider}. Use "DreamGraph: Set Architect API Key" to store one.`,
      );
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}
