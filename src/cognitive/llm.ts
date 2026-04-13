/**
 * DreamGraph LLM Provider — The dream engine's brain.
 *
 * Dreams don't work without an LLM. The deterministic strategies find
 * structural patterns; the LLM provides the creative leap — proposing
 * connections no graph algorithm would discover. The normalizer then
 * filters hallucinations from insights.
 *
 * Provider hierarchy (tried in order):
 *   1. Direct API (Ollama / OpenAI-compatible / Anthropic) — autonomous daemon dreaming
 *   2. MCP Sampling — ask the connected client's LLM (human-in-the-loop)
 *   3. None — structural-only fallback (degraded mode)
 *
 * Configuration (env vars):
 *   Shared:
 *     DREAMGRAPH_LLM_PROVIDER   = "ollama" | "openai" | "anthropic" | "sampling" | "none"
 *     DREAMGRAPH_LLM_URL        = API base URL (default: http://localhost:11434 for Ollama)
 *     DREAMGRAPH_LLM_API_KEY    = API key for OpenAI-compatible providers
 *
 *   Dreamer (creative dream generation):
 *     DREAMGRAPH_LLM_DREAMER_MODEL       = model name (default: provider-specific)
 *     DREAMGRAPH_LLM_DREAMER_TEMPERATURE = creativity (default: 0.7)
 *     DREAMGRAPH_LLM_DREAMER_MAX_TOKENS  = max response tokens (default: 2048)
 *
 *   Normalizer (semantic validation):
 *     DREAMGRAPH_LLM_NORMALIZER_MODEL       = model name (default: provider-specific)
 *     DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE = temperature (default: 0.7)
 *     DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS  = max response tokens (default: 2048)
 */

import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type LlmProviderType = "ollama" | "openai" | "anthropic" | "sampling" | "none";

export interface LlmConfig {
  provider: LlmProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  text: string;
  model: string;
  tokensUsed?: number;
  stopReason?: string;
}

/**
 * Options for LLM completion requests.
 *
 * JSON enforcement hierarchy (OpenAI provider):
 *   1. `jsonSchema` — Structured Outputs (`strict: true`) — guaranteed schema conformance
 *   2. `jsonMode` — `response_format: json_object` — guaranteed valid JSON, no schema
 *   3. Neither — free-form text
 *
 * For Ollama both fall back to `format: "json"`.
 */
export interface LlmCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Override the model for this request (uses provider default if omitted) */
  model?: string;
  /** Basic JSON mode — model must output valid JSON (no schema enforcement) */
  jsonMode?: boolean;
  /**
   * Strict JSON Schema (OpenAI Structured Outputs).
   * When provided, the OpenAI provider sends `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`.
   * This guarantees the response matches the schema exactly — no malformed JSON, no missing fields.
   * Implies `jsonMode` — you don't need to set both.
   */
  jsonSchema?: {
    /** Schema name (e.g. "dream_response") */
    name: string;
    /** JSON Schema object */
    schema: Record<string, unknown>;
  };
}

export interface LlmProvider {
  readonly name: string;
  /** Check if provider is reachable */
  isAvailable(): Promise<boolean>;
  /** Generate a completion */
  complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Ollama Provider — local model, no API key, autonomous
// ---------------------------------------------------------------------------

class OllamaProvider implements LlmProvider {
  readonly name = "ollama";

  constructor(
    private baseUrl: string,
    private model: string,
    private defaultTemperature: number,
    private defaultMaxTokens: number,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    const temp = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;

    const model = options?.model ?? this.model;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: false,
      options: {
        temperature: temp,
        num_predict: maxTokens,
      },
    };

    // Ollama: both jsonSchema and jsonMode map to format: "json"
    // (Ollama doesn't support strict schema enforcement)
    if (options?.jsonSchema || options?.jsonMode) {
      body.format = "json";
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // 2 min timeout for large models
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Ollama ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      message?: { content?: string };
      model?: string;
      eval_count?: number;
      done_reason?: string;
    };

    return {
      text: data.message?.content ?? "",
      model: data.model ?? this.model,
      tokensUsed: data.eval_count,
      stopReason: data.done_reason,
    };
  }
}

// ---------------------------------------------------------------------------
// OpenAI-Compatible Provider — Anthropic, OpenAI, Groq, etc.
// ---------------------------------------------------------------------------

class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = "openai";

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private defaultTemperature: number,
    private defaultMaxTokens: number,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    const temp = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const model = options?.model ?? this.model;

    // Newer OpenAI models (o1/o3/o4-mini, gpt-4.1, gpt-5.4-nano, etc.) require
    // "max_completion_tokens" instead of the legacy "max_tokens" parameter.
    const useNewTokenParam = /^(o[1-9]|gpt-[4-9]\.[1-9]|gpt-5)/.test(model);

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: temp,
      ...(useNewTokenParam
        ? { max_completion_tokens: maxTokens }
        : { max_tokens: maxTokens }),
    };

    // Structured Outputs (strict schema) > basic JSON mode > free-form
    if (options?.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: options.jsonSchema.name,
          strict: true,
          schema: options.jsonSchema.schema,
        },
      };
    } else if (options?.jsonMode) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`OpenAI-compat ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      choices?: Array<{
        message?: { content?: string };
        finish_reason?: string;
      }>;
      model?: string;
      usage?: { completion_tokens?: number };
    };

    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      model: data.model ?? this.model,
      tokensUsed: data.usage?.completion_tokens,
      stopReason: choice?.finish_reason,
    };
  }
}

// ---------------------------------------------------------------------------
// Anthropic Provider — native Claude API
// ---------------------------------------------------------------------------

/**
 * Native Anthropic Messages API provider.
 * Uses /v1/messages endpoint with x-api-key auth and anthropic-version header.
 * System messages are extracted and sent as the top-level `system` param.
 */
class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string,
    private defaultTemperature: number,
    private defaultMaxTokens: number,
  ) {}

  async isAvailable(): Promise<boolean> {
    // Anthropic doesn't have a lightweight ping endpoint;
    // just verify we have an API key configured.
    return !!this.apiKey;
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    const temp = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens ?? this.defaultMaxTokens;
    const model = options?.model ?? this.model;

    // Anthropic requires system messages as a top-level param, not in the messages array
    const systemMessages = messages.filter(m => m.role === "system");
    const nonSystemMessages = messages.filter(m => m.role !== "system");
    const systemText = systemMessages.map(m => m.content).join("\n\n") || undefined;

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      temperature: temp,
      messages: nonSystemMessages.map(m => ({ role: m.role, content: m.content })),
    };

    if (systemText) {
      body.system = systemText;
    }

    // Anthropic doesn't support OpenAI-style structured outputs or json_mode,
    // but we can hint via a prefill trick: append an assistant message starting with "{"
    // to encourage JSON output when jsonMode or jsonSchema is requested.
    if (options?.jsonSchema || options?.jsonMode) {
      // Add instruction to system message
      const jsonHint = "\n\nYou MUST respond with valid JSON only. No markdown, no explanation — just the JSON object.";
      if (body.system) {
        body.system = (body.system as string) + jsonHint;
      } else {
        body.system = jsonHint.trim();
      }
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Anthropic ${res.status}: ${errText}`);
    }

    const data = await res.json() as {
      content?: Array<{ type: string; text?: string }>;
      model?: string;
      usage?: { output_tokens?: number };
      stop_reason?: string;
    };

    const textBlock = data.content?.find(b => b.type === "text");
    return {
      text: textBlock?.text ?? "",
      model: data.model ?? this.model,
      tokensUsed: data.usage?.output_tokens,
      stopReason: data.stop_reason,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP Sampling Provider — uses the connected client's LLM
// ---------------------------------------------------------------------------

/**
 * MCP Sampling provider — asks the connected client's LLM via the
 * MCP sampling/createMessage protocol.
 *
 * Requires:
 * - A connected client that supports sampling capability
 * - Human-in-the-loop approval from the client side
 * - Server reference set via setMcpServer()
 *
 * Use this when DreamGraph is connected to an AI IDE (VS Code + Copilot).
 * For autonomous daemon dreaming, prefer Ollama or OpenAI provider.
 */
class McpSamplingProvider implements LlmProvider {
  readonly name = "sampling";
  private _server: unknown = null;

  /** Inject the MCP Server instance after connection */
  setServer(server: unknown): void {
    this._server = server;
  }

  async isAvailable(): Promise<boolean> {
    if (!this._server) return false;
    try {
      // Check if the low-level Server has client capabilities with sampling
      const srv = this._server as {
        getClientCapabilities?: () => { sampling?: unknown } | undefined;
      };
      const caps = srv.getClientCapabilities?.();
      return !!caps?.sampling;
    } catch {
      return false;
    }
  }

  async complete(messages: LlmMessage[], options?: LlmCompletionOptions): Promise<LlmResponse> {
    if (!this._server) {
      throw new Error("MCP Sampling: No server connected");
    }

    const srv = this._server as {
      createMessage: (params: Record<string, unknown>) => Promise<{
        content: { type: string; text?: string } | Array<{ type: string; text?: string }>;
        model?: string;
        stopReason?: string;
      }>;
    };

    // Convert our messages to MCP sampling format
    // MCP sampling expects: messages array + optional systemPrompt
    const systemMsg = messages.find(m => m.role === "system");
    const nonSystemMsgs = messages.filter(m => m.role !== "system");

    const params: Record<string, unknown> = {
      messages: nonSystemMsgs.map(m => ({
        role: m.role,
        content: { type: "text", text: m.content },
      })),
      maxTokens: options?.maxTokens ?? 2048,
    };

    if (systemMsg) {
      params.systemPrompt = systemMsg.content;
    }

    if (options?.temperature !== undefined) {
      params.modelPreferences = {
        costPriority: 0.3,
        speedPriority: 0.5,
        intelligencePriority: 0.8,
      };
    }

    const result = await srv.createMessage(params);

    // Extract text from response content
    const content = Array.isArray(result.content)
      ? result.content
      : [result.content];
    const text = content
      .filter(c => c.type === "text")
      .map(c => c.text ?? "")
      .join("");

    return {
      text,
      model: result.model ?? "client-llm",
      stopReason: result.stopReason,
    };
  }
}

// ---------------------------------------------------------------------------
// Null Provider — structural-only fallback (degraded mode)
// ---------------------------------------------------------------------------

class NullProvider implements LlmProvider {
  readonly name = "none";

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async complete(): Promise<LlmResponse> {
    throw new Error(
      "LLM provider not configured. Dreams require an LLM. " +
      "Set DREAMGRAPH_LLM_PROVIDER=ollama and ensure Ollama is running, " +
      "or set DREAMGRAPH_LLM_PROVIDER=openai/anthropic with DREAMGRAPH_LLM_API_KEY."
    );
  }
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

export function parseLlmConfig(): LlmConfig {
  const provider = (process.env.DREAMGRAPH_LLM_PROVIDER ?? "ollama") as LlmProviderType;

  // Provider defaults — model/temperature/maxTokens serve as fallbacks
  // for per-component configs (dreamer, normalizer) when their env vars
  // are not set.  There are no base MODEL/TEMPERATURE/MAX_TOKENS env vars;
  // each component manages its own.
  const temperature = 0.7;
  const maxTokens = 2048;

  let model: string;
  let baseUrl: string;
  let apiKey: string;

  switch (provider) {
    case "ollama":
      model = "qwen3:8b";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "http://localhost:11434";
      apiKey = "";
      break;
    case "openai":
      model = "gpt-4o-mini";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "https://api.openai.com/v1";
      apiKey = process.env.DREAMGRAPH_LLM_API_KEY ?? "";
      break;
    case "anthropic":
      model = "claude-sonnet-4-20250514";
      baseUrl = process.env.DREAMGRAPH_LLM_URL ?? "https://api.anthropic.com/v1";
      apiKey = process.env.DREAMGRAPH_LLM_API_KEY ?? "";
      break;
    case "sampling":
      model = "client";
      baseUrl = "";
      apiKey = "";
      break;
    default: // "none"
      model = "";
      baseUrl = "";
      apiKey = "";
      break;
  }

  return { provider, model, baseUrl, apiKey, temperature, maxTokens };
}

// ---------------------------------------------------------------------------
// Per-component config — dreamer and normalizer can have different settings
// ---------------------------------------------------------------------------

/**
 * Parse per-component LLM settings.
 * Reads DREAMGRAPH_LLM_{COMPONENT}_MODEL / TEMPERATURE / MAX_TOKENS,
 * falling back to provider-specific defaults from the base LlmConfig.
 */
function parseComponentConfig(
  component: "DREAMER" | "NORMALIZER",
  base: LlmConfig,
): { model: string; temperature: number; maxTokens: number } {
  const prefix = `DREAMGRAPH_LLM_${component}`;
  const model = process.env[`${prefix}_MODEL`] ?? base.model;
  const temperature = process.env[`${prefix}_TEMPERATURE`]
    ? parseFloat(process.env[`${prefix}_TEMPERATURE`]!)
    : base.temperature;
  const maxTokens = process.env[`${prefix}_MAX_TOKENS`]
    ? parseInt(process.env[`${prefix}_MAX_TOKENS`]!, 10)
    : base.maxTokens;
  return { model, temperature, maxTokens };
}

let _dreamerConfig: { model: string; temperature: number; maxTokens: number } | null = null;
let _normalizerConfig: { model: string; temperature: number; maxTokens: number } | null = null;

/** Get dreamer-specific LLM settings (model, temperature, maxTokens) */
export function getDreamerLlmConfig(): { model: string; temperature: number; maxTokens: number } {
  if (!_dreamerConfig) {
    _dreamerConfig = parseComponentConfig("DREAMER", getLlmConfig());
    const base = getLlmConfig();
    if (_dreamerConfig.model !== base.model || _dreamerConfig.temperature !== base.temperature) {
      logger.info(
        `LLM dreamer config: model=${_dreamerConfig.model}, temp=${_dreamerConfig.temperature}, maxTokens=${_dreamerConfig.maxTokens}`
      );
    }
  }
  return _dreamerConfig;
}

/** Get normalizer-specific LLM settings (model, temperature, maxTokens) */
export function getNormalizerLlmConfig(): { model: string; temperature: number; maxTokens: number } {
  if (!_normalizerConfig) {
    _normalizerConfig = parseComponentConfig("NORMALIZER", getLlmConfig());
    const base = getLlmConfig();
    if (_normalizerConfig.model !== base.model || _normalizerConfig.temperature !== base.temperature) {
      logger.info(
        `LLM normalizer config: model=${_normalizerConfig.model}, temp=${_normalizerConfig.temperature}, maxTokens=${_normalizerConfig.maxTokens}`
      );
    }
  }
  return _normalizerConfig;
}

/** Update dreamer-specific LLM settings at runtime. */
export function updateDreamerLlmConfig(
  partial: Partial<{ model: string; temperature: number; maxTokens: number }>,
): void {
  const current = getDreamerLlmConfig();
  _dreamerConfig = { ...current, ...partial };
  logger.info(
    `LLM dreamer config updated: model=${_dreamerConfig.model}, temp=${_dreamerConfig.temperature}, maxTokens=${_dreamerConfig.maxTokens}`,
  );
}

/** Update normalizer-specific LLM settings at runtime. */
export function updateNormalizerLlmConfig(
  partial: Partial<{ model: string; temperature: number; maxTokens: number }>,
): void {
  const current = getNormalizerLlmConfig();
  _normalizerConfig = { ...current, ...partial };
  logger.info(
    `LLM normalizer config updated: model=${_normalizerConfig.model}, temp=${_normalizerConfig.temperature}, maxTokens=${_normalizerConfig.maxTokens}`,
  );
}

// ---------------------------------------------------------------------------
// Singleton — the active LLM provider
// ---------------------------------------------------------------------------

let _provider: LlmProvider | null = null;
let _samplingProvider: McpSamplingProvider | null = null;
let _config: LlmConfig | null = null;

/** Initialize the LLM provider based on config. Call once at startup. */
export function initLlmProvider(cfg?: LlmConfig): LlmProvider {
  const c = cfg ?? parseLlmConfig();
  _config = c;

  switch (c.provider) {
    case "ollama":
      _provider = new OllamaProvider(c.baseUrl, c.model, c.temperature, c.maxTokens);
      break;
    case "openai":
      if (!c.apiKey) {
        logger.warn("LLM: OpenAI provider configured but no API key set (DREAMGRAPH_LLM_API_KEY)");
      }
      _provider = new OpenAiCompatibleProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens);
      break;
    case "anthropic":
      if (!c.apiKey) {
        logger.warn("LLM: Anthropic provider configured but no API key set (DREAMGRAPH_LLM_API_KEY)");
      }
      _provider = new AnthropicProvider(c.baseUrl, c.model, c.apiKey, c.temperature, c.maxTokens);
      break;
    case "sampling":
      _samplingProvider = new McpSamplingProvider();
      _provider = _samplingProvider;
      break;
    default:
      _provider = new NullProvider();
      break;
  }

  logger.info(`LLM provider: ${c.provider} (model: ${c.model || "n/a"})`);
  return _provider;
}

/**
 * Inject the MCP Server reference for the sampling provider.
 * Call this after server.connect() when using provider="sampling".
 */
export function setMcpServerForSampling(server: unknown): void {
  if (_samplingProvider) {
    _samplingProvider.setServer(server);
  }
}

/** Get the active LLM provider. Initializes with defaults if not yet set. */
export function getLlmProvider(): LlmProvider {
  if (!_provider) {
    return initLlmProvider();
  }
  return _provider;
}

/** Get the current LLM config */
export function getLlmConfig(): LlmConfig {
  if (!_config) {
    _config = parseLlmConfig();
  }
  return _config;
}

/** Check if LLM dreaming is available */
export async function isLlmAvailable(): Promise<boolean> {
  const provider = getLlmProvider();
  return provider.isAvailable();
}
