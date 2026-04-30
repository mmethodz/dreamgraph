/**
 * DreamGraph Architect LLM Provider â€” Layer 2 (Context Orchestration).
 *
 * Calls the Architect model (Anthropic, OpenAI, or Ollama) with
 * structured prompts assembled from the context orchestration layer.
 */

import * as vscode from "vscode";
import {
  buildOpenAIResponsesRequest,
  extractOpenAIResponsesText,
  extractOpenAIResponsesToolCalls,
  toOpenAIResponsesContent,
  translateRawToOpenAIResponses,
  usesOpenAIResponsesApi,
} from "./openai-responses-adapter";

export type ArchitectProvider = "anthropic" | "openai" | "ollama" | "lmstudio";
export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ArchitectConfig {
  provider: ArchitectProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export type ArchitectContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; dataBase64: string; fileName?: string };

export type ArchitectTextBlock = { type: "text"; text: string };
export type ArchitectImageBlock = { type: "image"; mimeType: string; dataBase64: string; fileName?: string };
export type ArchitectContent = ArchitectTextBlock | ArchitectImageBlock;

export interface ArchitectMessage {
  role: "system" | "user" | "assistant";
  content: string | ArchitectContent[];
}

export interface ArchitectModelCapabilities {
  textAttachments: boolean;
  imageAttachments: boolean;
}

export interface ArchitectResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

export interface ToolUseRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ArchitectToolResponse extends ArchitectResponse {
  toolCalls: ToolUseRequest[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "stop" | string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResultMessage {
  role: "user";
  content: Array<{
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }>;
}

export type StreamCallback = (chunk: string) => void;

export const ANTHROPIC_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
];

export const OPENAI_MODELS = [
  "gpt-5",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o-mini",
  "o3",
  "o4-mini",
];


/* ------------------------------------------------------------------ */
/*  Emergency input-budget brakes                                     */
/* ------------------------------------------------------------------ */
/**
 * Hard ceilings on the serialized request body sent to any LLM provider.
 * Exists to prevent runaway context regressions (e.g. accidental inclusion of
 * generated docs/, full graph JSON, or unbounded chat history) from silently
 * burning into the long-context pricing tier.
 *
 * If the budget is exceeded the request is aborted with a descriptive error
 * BEFORE the network call — failing fast is cheaper than failing slowly.
 *
 * Tunable via the `dreamgraph.architect.maxRequestChars` setting; default is
 * 320_000 chars (~80k tokens) which comfortably fits a fully-loaded
 * Architect prompt + 20-turn history but rejects 300k-char accidents.
 */
const DEFAULT_MAX_REQUEST_CHARS = 320_000;
/** Per-section warning threshold (chars). */
const SECTION_WARN_CHARS = 80_000;

/**
 * Optional sink that receives structured budget summaries.
 * Set by extension activation via `setRequestBudgetSink(inspector.logRequestBudget.bind(inspector))`
 * so output appears in the "DreamGraph Context" output channel.
 * Falls back to console.log/warn if no sink is registered.
 */
type RequestBudgetSink = (summary: {
  callsite: string;
  model: string;
  inputChars: number;
  approxTokens: number;
  sections: Array<{ name: string; chars: number; approxTokens: number }>;
  warn?: boolean;
}) => void;
let _budgetSink: RequestBudgetSink | undefined;
export function setRequestBudgetSink(sink: RequestBudgetSink | undefined): void {
  _budgetSink = sink;
}

function _logRequestBudget(callsite: string, model: string, body: Record<string, unknown>, serialized: string): void {
  // Per-section breakdown: top-level keys + system + per-message char counts.
  const sections: Array<{ name: string; chars: number; approxTokens: number }> = [];
  const push = (name: string, content: unknown): void => {
    const s = typeof content === 'string' ? content : JSON.stringify(content ?? '');
    const chars = s.length;
    sections.push({ name, chars, approxTokens: Math.ceil(chars / 4) });
  };
  if (typeof body.system === 'string') push('system', body.system);
  const messages = (body as { messages?: unknown[] }).messages;
  if (Array.isArray(messages)) {
    messages.forEach((m, i) => {
      const role = (m as { role?: string }).role ?? 'unknown';
      push(`messages[${i}].${role}`, (m as { content?: unknown }).content);
    });
  }
  const tools = (body as { tools?: unknown[] }).tools;
  if (Array.isArray(tools)) push('tools', tools);

  const inputChars = serialized.length;
  const approxTokens = Math.ceil(inputChars / 4);
  const oversizedSections = sections.filter((s) => s.chars > SECTION_WARN_CHARS);
  const warn = oversizedSections.length > 0 || inputChars > 200_000;
  const topSections = sections.sort((a, b) => b.chars - a.chars).slice(0, 10);

  if (_budgetSink) {
    _budgetSink({ callsite, model, inputChars, approxTokens, sections: topSections, warn });
    return;
  }
  // Fallback: console output if no sink registered yet (early activation).
  const summary = { callsite, model, inputChars, approxTokens, sections: topSections };
  if (warn) console.warn('[DreamGraph][llm_input_budget]', JSON.stringify(summary));
  else console.log('[DreamGraph][llm_input_budget]', JSON.stringify({ callsite, model, inputChars, approxTokens }));
}

function _enforceRequestBudget(callsite: string, model: string, body: Record<string, unknown>): string {
  const serialized = JSON.stringify(body);
  _logRequestBudget(callsite, model, body, serialized);
  const cfg = vscode.workspace.getConfiguration('dreamgraph.architect');
  const max = cfg.get<number>('maxRequestChars') ?? DEFAULT_MAX_REQUEST_CHARS;
  if (serialized.length > max) {
    throw new Error(
      `LLM request budget exceeded at ${callsite}: ${serialized.length.toLocaleString()} chars ` +
      `(~${Math.ceil(serialized.length / 4).toLocaleString()} tokens) > limit ${max.toLocaleString()}. ` +
      `Likely culprits: generated docs/ pulled into context, full graph JSON injected, unbounded chat history, ` +
      `or duplicated context sections. Raise dreamgraph.architect.maxRequestChars to override.`,
    );
  }
  return serialized;
}

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

  /** Apply a config directly in memory (skips settings round-trip). */
  applyConfig(config: ArchitectConfig): void {
    this._config = {
      ...config,
      baseUrl: config.baseUrl || this._defaultBaseUrl(config.provider),
    };
  }

  getModelCapabilities(provider?: ArchitectProvider | null, model?: string | null): ArchitectModelCapabilities {
    const effectiveProvider = provider ?? this._config?.provider ?? null;
    const effectiveModel = (model ?? this._config?.model ?? "").toLowerCase();

    if (!effectiveProvider) {
      return { textAttachments: false, imageAttachments: false };
    }

    switch (effectiveProvider) {
      case "anthropic":
        return { textAttachments: true, imageAttachments: effectiveModel.startsWith("claude") };
      case "openai": {
        const imageCapable =
          effectiveModel.startsWith("gpt-5") ||
          effectiveModel.startsWith("gpt-4.1") ||
          effectiveModel.startsWith("gpt-4o") ||
          effectiveModel.startsWith("o4") ||
          effectiveModel.startsWith("o3");
        return { textAttachments: true, imageAttachments: imageCapable };
      }
      case "ollama":
        return { textAttachments: true, imageAttachments: false };
      case "lmstudio":
        return { textAttachments: true, imageAttachments: false };
      default:
        return { textAttachments: false, imageAttachments: false };
    }
  }

  private _getAnthropicEffort(model: string): AnthropicEffort {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const configured = (cfg.get<string>("anthropic.effort") ?? "").trim().toLowerCase();
    const normalized = configured === "xhigh" || configured === "max" || configured === "high" || configured === "medium" || configured === "low"
      ? (configured as AnthropicEffort)
      : undefined;

    if (normalized) {
      if (model.startsWith("claude-opus-4-6") && normalized === "xhigh") {
        return "high";
      }
      return normalized;
    }

    return model.startsWith("claude-opus-4-7") ? "xhigh" : "high";
  }

  private _getAnthropicMaxTokens(model: string): number {
    return model.startsWith("claude-opus-4-7") ? 65536 : 8192;
  }

  private _getAnthropicThinking(model: string): { type: "adaptive"; display?: "summarized" } | undefined {
    if (!model.startsWith("claude-opus-4-7")) {
      return undefined;
    }

    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const enabled = cfg.get<boolean>("anthropic.adaptiveThinking") ?? true;
    if (!enabled) {
      return undefined;
    }

    const summarized = cfg.get<boolean>("anthropic.showThinkingSummary") ?? true;
    return summarized ? { type: "adaptive", display: "summarized" } : { type: "adaptive" };
  }

  private _buildAnthropicMessagesRequest(
    config: ArchitectConfig,
    messages: unknown[],
    system?: string,
    tools?: ToolDefinition[],
    stream?: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: this._getAnthropicMaxTokens(config.model),
      messages,
    };

    if (system) {
      body.system = system;
    }

    if (stream) {
      body.stream = true;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    }

    if (config.model.startsWith("claude-opus-4-7")) {
      body.output_config = { effort: this._getAnthropicEffort(config.model) };
      const thinking = this._getAnthropicThinking(config.model);
      if (thinking) {
        body.thinking = thinking;
      }
    }

    return body;
  }

  async loadConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const provider = (cfg.get<string>("provider") ?? "anthropic") as ArchitectProvider;
    const model = cfg.get<string>("model") ?? "claude-opus-4-6";
    const baseUrl = cfg.get<string>("baseUrl") || this._defaultBaseUrl(provider);

    let apiKey = "";
    if (provider === "lmstudio") {
      // LM Studio ignores the auth header but the OpenAI-compat code path
      // sends `Authorization: Bearer <key>` unconditionally. A literal
      // placeholder avoids "Bearer " (empty) which some setups reject.
      apiKey = "lm-studio";
    } else if (provider && provider !== "ollama") {
      apiKey = (await this._secretStorage.get(`dreamgraph.apiKey.${provider}`)) ?? "";
    }

    this._config = { provider, model, baseUrl, apiKey };
  }

  async setApiKey(provider: ArchitectProvider, key: string): Promise<void> {
    await this._secretStorage.store(`dreamgraph.apiKey.${provider}`, key);
    if (this._config && this._config.provider === provider) {
      this._config.apiKey = key;
    }
  }

  async getApiKey(provider: ArchitectProvider): Promise<string | undefined> {
    return this._secretStorage.get(`dreamgraph.apiKey.${provider}`);
  }

  async call(messages: ArchitectMessage[], signal?: AbortSignal): Promise<ArchitectResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._callAnthropic(config, messages, start, signal);
      case "openai":
      case "lmstudio":
        return this._callOpenAI(config, messages, start, signal);
      case "ollama":
        return this._callOllama(config, messages, start, signal);
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  async stream(messages: ArchitectMessage[], onChunk: StreamCallback, signal?: AbortSignal): Promise<ArchitectResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._streamAnthropic(config, messages, onChunk, start, signal);
      case "openai":
      case "lmstudio":
        return this._streamOpenAI(config, messages, onChunk, start, signal);
      case "ollama":
        return this._streamOllama(config, messages, onChunk, start, signal);
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  async callWithTools(
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    this._ensureConfigured();
    const config = this._config!;
    const start = Date.now();

    switch (config.provider) {
      case "anthropic":
        return this._callAnthropicWithTools(config, messages, tools, start, rawMessages, signal);
      case "openai":
      case "lmstudio":
        return this._callOpenAIWithTools(config, messages, tools, start, rawMessages, signal);
      case "ollama": {
        const resp = await this._callOllama(config, messages, start, signal);
        return { ...resp, toolCalls: [], stopReason: "end_turn" };
      }
      default:
        throw new Error(`Unknown Architect provider: ${config.provider}`);
    }
  }

  private _messageTextContent(content: string | ArchitectContent[]): string {
    if (typeof content === "string") return content;
    return content.filter((block): block is ArchitectTextBlock => block.type === "text").map((block) => block.text).join("\n\n");
  }

  private _toAnthropicContent(content: string | ArchitectContent[]): unknown {
    if (typeof content === "string") return content;
    return content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: block.mimeType,
          data: block.dataBase64,
        },
      };
    });
  }

  private _toOpenAIContent(content: string | ArchitectContent[]): unknown {
    if (typeof content === "string") return content;
    return content.map((block) => {
      if (block.type === "text") return { type: "text", text: block.text };
      return {
        type: "input_image",
        image_url: `data:${block.mimeType};base64,${block.dataBase64}`,
      };
    });
  }

  private _toOllamaContent(content: string | ArchitectContent[]): string {
    return this._messageTextContent(content);
  }

  private _translateRawToOpenAI(raw: unknown[]): unknown[] {
    const out: unknown[] = [];

    for (const msg of raw) {
      const m = msg as Record<string, unknown>;
      const role = m.role as string;
      const content = m.content;

      if (typeof content === "string") {
        out.push({ role, content });
        continue;
      }

      if (!Array.isArray(content)) {
        out.push(msg);
        continue;
      }

      const blocks = content as Array<Record<string, unknown>>;

      if (role === "assistant") {
        const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text as string);
        const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
        const openaiMsg: Record<string, unknown> = {
          role: "assistant",
          content: textParts.join("") || null,
        };
        if (toolUseBlocks.length > 0) {
          openaiMsg.tool_calls = toolUseBlocks.map((b) => ({
            id: b.id as string,
            type: "function",
            function: {
              name: b.name as string,
              arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input),
            },
          }));
        }
        out.push(openaiMsg);
      } else if (role === "user") {
        const toolResults = blocks.filter((b) => b.type === "tool_result");
        const nonToolBlocks = blocks.filter((b) => b.type !== "tool_result");
        if (nonToolBlocks.length > 0) {
          const translated = nonToolBlocks.map((b) => {
            if (b.type === "image") {
              const src = b.source as Record<string, unknown> | undefined;
              if (src && src.type === "base64") {
                return {
                  type: "image_url",
                  image_url: { url: `data:${src.media_type};base64,${src.data}` },
                };
              }
            }
            return b;
          });
          out.push({ role: "user", content: translated });
        }
        for (const tr of toolResults) {
          out.push({
            role: "tool",
            tool_call_id: tr.tool_use_id as string,
            content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
          });
        }
      } else {
        out.push(msg);
      }
    }

    return out;
  }

  private async _callAnthropic(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const { system, userMessages } = this._splitSystem(messages);
    const requestBody = this._buildAnthropicMessagesRequest(
      config,
      userMessages.map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) })),
      system,
    );

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: _enforceRequestBudget('callAnthropic', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      content: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
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
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    const { system } = this._splitSystem(messages);
    const apiMessages = rawMessages
      ? rawMessages
      : messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) }));

    const requestBody = this._buildAnthropicMessagesRequest(config, apiMessages, system, tools);
    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: _enforceRequestBudget('callAnthropicWithTools', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    return {
      content: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls: data.content
        .filter((c) => c.type === "tool_use")
        .map((c) => ({ id: c.id!, name: c.name!, input: c.input ?? {} })),
      stopReason: data.stop_reason ?? "end_turn",
    };
  }

    private _usesOpenAIResponsesApi(model: string): boolean {
    return usesOpenAIResponsesApi(model);
  }

  private _getOpenAIReasoningEffort(): "low" | "medium" | "high" | "xhigh" {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const configured = (cfg.get<string>("openai.reasoningEffort") ?? "").trim().toLowerCase();
    if (configured === "low" || configured === "medium" || configured === "high" || configured === "xhigh") {
      return configured;
    }
    return "medium";
  }

  private _getOpenAITextVerbosity(): "low" | "medium" | "high" {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    const configured = (cfg.get<string>("openai.verbosity") ?? "").trim().toLowerCase();
    if (configured === "low" || configured === "medium" || configured === "high") {
      return configured;
    }

    const reportingMode = (cfg.get<string>("reportingMode") ?? "standard").trim().toLowerCase();
    if (reportingMode === "deep" || reportingMode === "forensic") {
      return "medium";
    }
    return "low";
  }

    private _toOpenAIResponsesContent(content: string | ArchitectContent[]): unknown {
    return toOpenAIResponsesContent(content);
  }

    private _translateRawToOpenAIResponses(raw: unknown[]): unknown[] {
    return translateRawToOpenAIResponses(raw);
  }

    private _buildOpenAIResponsesRequest(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    rawMessages?: unknown[],
    tools?: ToolDefinition[],
  ): Record<string, unknown> {
    return buildOpenAIResponsesRequest(messages, {
      model: config.model,
      reasoningEffort: this._getOpenAIReasoningEffort(),
      textVerbosity: this._getOpenAITextVerbosity(),
      rawMessages,
      tools,
    });
  }

    private _extractOpenAIResponsesText(data: {
    output_text?: string;
    output?: Array<Record<string, unknown>>;
  }): string {
    return extractOpenAIResponsesText(data);
  }

    private _extractOpenAIResponsesToolCalls(data: { output?: Array<Record<string, unknown>> }): ToolUseRequest[] {
    return extractOpenAIResponsesToolCalls(data);
  }

  private async _callOpenAIResponses(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const requestBody = this._buildOpenAIResponsesRequest(config, messages);
    const res = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _enforceRequestBudget('callOpenAIResponses', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI Responses API error (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as {
      output_text?: string;
      output?: Array<Record<string, unknown>>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    return {
      content: this._extractOpenAIResponsesText(data),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
    };
  }

  private async _callOpenAIResponsesWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    const requestBody = this._buildOpenAIResponsesRequest(config, messages, rawMessages, tools);
    const res = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _enforceRequestBudget('callOpenAIResponsesWithTools', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI Responses API error (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as {
      output_text?: string;
      output?: Array<Record<string, unknown>>;
      usage?: { input_tokens?: number; output_tokens?: number };
      status?: string;
      incomplete_details?: { reason?: string };
    };
    const toolCalls = this._extractOpenAIResponsesToolCalls(data);

    return {
      content: this._extractOpenAIResponsesText(data),
      promptTokens: data.usage?.input_tokens ?? 0,
      completionTokens: data.usage?.output_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls,
      stopReason: toolCalls.length > 0
        ? "tool_use"
        : data.incomplete_details?.reason === "max_output_tokens"
          ? "max_tokens"
          : data.status ?? "end_turn",
    };
  }

  private async _callOpenAIWithTools(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    tools: ToolDefinition[],
    start: number,
    rawMessages?: unknown[],
    signal?: AbortSignal,
  ): Promise<ArchitectToolResponse> {
    if (this._usesOpenAIResponsesApi(config.model)) {
      return this._callOpenAIResponsesWithTools(config, messages, tools, start, rawMessages, signal);
    }

    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    const apiMessages = rawMessages
      ? this._translateRawToOpenAI(rawMessages)
      : messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) }));

    const { system } = this._splitSystem(messages);
    if (system && !apiMessages.some((m) => (m as Record<string, unknown>).role === "system")) {
      (apiMessages as Array<Record<string, unknown>>).unshift({ role: "system", content: system });
    }

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _enforceRequestBudget('callOpenAIWithTools', config.model, {
        model: config.model,
        max_completion_tokens: 16384,
        messages: apiMessages,
        tools: openaiTools,
      }),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);

    const data = (await res.json()) as {
      choices: Array<{
        message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const choice = data.choices[0];
    return {
      content: choice?.message?.content ?? "",
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - start,
      toolCalls: (choice?.message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      })),
      stopReason: choice?.finish_reason === "tool_calls" ? "tool_use" : (choice?.finish_reason ?? "stop"),
    };
  }

  private async _streamAnthropic(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    onChunk: StreamCallback,
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const { system, userMessages } = this._splitSystem(messages);
    const requestBody = this._buildAnthropicMessagesRequest(
      config,
      userMessages.map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) })),
      system,
      undefined,
      true,
    );

    const res = await fetch(`${config.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: _enforceRequestBudget('streamAnthropic', config.model, requestBody),
      signal,
    });

    if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
    return this._readSSEStream(res, onChunk, start, "anthropic");
  }

  private async _callOpenAI(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    if (this._usesOpenAIResponsesApi(config.model)) {
      return this._callOpenAIResponses(config, messages, start, signal);
    }

    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _enforceRequestBudget('callOpenAI', config.model, {
        model: config.model,
        max_completion_tokens: 16384,
        messages: messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) })),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);

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
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: _enforceRequestBudget('streamOpenAI', config.model, {
        model: config.model,
        max_completion_tokens: 16384,
        stream: true,
        messages: messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) })),
      }),
      signal,
    });

    if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
    return this._readSSEStream(res, onChunk, start, "openai");
  }


  private async _callOllama(
    config: ArchitectConfig,
    messages: ArchitectMessage[],
    start: number,
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: _enforceRequestBudget('callOllama', config.model, {
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: this._toOllamaContent(m.content) })),
        stream: false,
      }),
      signal,
    });

    if (!res.ok) throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);

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
    signal?: AbortSignal,
  ): Promise<ArchitectResponse> {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: _enforceRequestBudget('streamOllama', config.model, {
        model: config.model,
        messages: messages.map((m) => ({ role: m.role, content: this._toOllamaContent(m.content) })),
        stream: true,
      }),
      signal,
    });

    if (!res.ok) throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");
    const decoder = new TextDecoder();
    let fullContent = "";
    let promptTokens = 0;
    let completionTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const line = decoder.decode(value, { stream: true }).trim();
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const chunk = parsed.message?.content ?? "";
        if (chunk) {
          fullContent += chunk;
          onChunk(chunk);
        }
        if (parsed.done) {
          promptTokens = parsed.prompt_eval_count ?? promptTokens;
          completionTokens = parsed.eval_count ?? completionTokens;
        }
      } catch {
        // skip malformed lines
      }
    }

    return {
      content: fullContent,
      promptTokens,
      completionTokens,
      durationMs: Date.now() - start,
    };
  }

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

  private _splitSystem(messages: ArchitectMessage[]): { system: string | undefined; userMessages: ArchitectMessage[] } {
    const systemMsgs = messages.filter((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");
    const system = systemMsgs.length > 0 ? systemMsgs.map((m) => this._messageTextContent(m.content)).join("\n\n") : undefined;
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
      case "lmstudio":
        return "http://localhost:1234/v1";
      default:
        return "";
    }
  }

  private _ensureConfigured(): void {
    if (!this._config || !this._config.provider) {
      throw new Error('Architect model not configured. Set "dreamgraph.architect.provider" and "dreamgraph.architect.model" in settings.');
    }
    if (!this._config.model) {
      throw new Error('Architect model name not set. Set "dreamgraph.architect.model" in settings.');
    }
    if (this._config.provider !== "ollama" && this._config.provider !== "lmstudio" && !this._config.apiKey) {
      throw new Error(`No API key stored for ${this._config.provider}. Use "DreamGraph: Set Architect API Key" to store one.`);
    }
  }

  dispose(): void {
    // Nothing to clean up
  }
}
