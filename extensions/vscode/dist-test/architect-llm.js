"use strict";
/**
 * DreamGraph Architect LLM Provider — Layer 2 (Context Orchestration).
 *
 * Calls the Architect model (Anthropic, OpenAI, or Ollama) with
 * structured prompts assembled from the context orchestration layer.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchitectLlm = exports.OPENAI_MODELS = exports.ANTHROPIC_MODELS = void 0;
const vscode = __importStar(require("vscode"));
exports.ANTHROPIC_MODELS = [
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
];
exports.OPENAI_MODELS = [
    "gpt-5",
    "gpt-5.4",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4o-mini",
    "o3",
    "o4-mini",
];
class ArchitectLlm {
    _config = null;
    _secretStorage;
    constructor(secretStorage) {
        this._secretStorage = secretStorage;
    }
    get isConfigured() {
        return this._config !== null && this._config.provider.length > 0;
    }
    get provider() {
        return this._config?.provider ?? null;
    }
    get currentConfig() {
        return this._config ? { ...this._config } : null;
    }
    /** Apply a config directly in memory (skips settings round-trip). */
    applyConfig(config) {
        this._config = {
            ...config,
            baseUrl: config.baseUrl || this._defaultBaseUrl(config.provider),
        };
    }
    getModelCapabilities(provider, model) {
        const effectiveProvider = provider ?? this._config?.provider ?? null;
        const effectiveModel = (model ?? this._config?.model ?? "").toLowerCase();
        if (!effectiveProvider) {
            return { textAttachments: false, imageAttachments: false };
        }
        switch (effectiveProvider) {
            case "anthropic":
                return { textAttachments: true, imageAttachments: effectiveModel.startsWith("claude") };
            case "openai": {
                const imageCapable = effectiveModel.startsWith("gpt-5") ||
                    effectiveModel.startsWith("gpt-4.1") ||
                    effectiveModel.startsWith("gpt-4o") ||
                    effectiveModel.startsWith("o4") ||
                    effectiveModel.startsWith("o3");
                return { textAttachments: true, imageAttachments: imageCapable };
            }
            case "ollama":
                return { textAttachments: true, imageAttachments: false };
            default:
                return { textAttachments: false, imageAttachments: false };
        }
    }
    _getAnthropicEffort(model) {
        const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
        const configured = (cfg.get("anthropic.effort") ?? "").trim().toLowerCase();
        const normalized = configured === "xhigh" || configured === "max" || configured === "high" || configured === "medium" || configured === "low"
            ? configured
            : undefined;
        if (normalized) {
            if (model.startsWith("claude-opus-4-6") && normalized === "xhigh") {
                return "high";
            }
            return normalized;
        }
        return model.startsWith("claude-opus-4-7") ? "xhigh" : "high";
    }
    _getAnthropicMaxTokens(model) {
        return model.startsWith("claude-opus-4-7") ? 65536 : 8192;
    }
    _getAnthropicThinking(model) {
        if (!model.startsWith("claude-opus-4-7")) {
            return undefined;
        }
        const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
        const enabled = cfg.get("anthropic.adaptiveThinking") ?? true;
        if (!enabled) {
            return undefined;
        }
        const summarized = cfg.get("anthropic.showThinkingSummary") ?? true;
        return summarized ? { type: "adaptive", display: "summarized" } : { type: "adaptive" };
    }
    _buildAnthropicMessagesRequest(config, messages, system, tools, stream) {
        const body = {
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
    async loadConfig() {
        const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
        const provider = (cfg.get("provider") ?? "");
        const model = cfg.get("model") ?? "";
        const baseUrl = cfg.get("baseUrl") || this._defaultBaseUrl(provider);
        let apiKey = "";
        if (provider && provider !== "ollama") {
            apiKey = (await this._secretStorage.get(`dreamgraph.apiKey.${provider}`)) ?? "";
        }
        this._config = { provider, model, baseUrl, apiKey };
    }
    async setApiKey(provider, key) {
        await this._secretStorage.store(`dreamgraph.apiKey.${provider}`, key);
        if (this._config && this._config.provider === provider) {
            this._config.apiKey = key;
        }
    }
    async getApiKey(provider) {
        return this._secretStorage.get(`dreamgraph.apiKey.${provider}`);
    }
    async call(messages, signal) {
        this._ensureConfigured();
        const config = this._config;
        const start = Date.now();
        switch (config.provider) {
            case "anthropic":
                return this._callAnthropic(config, messages, start, signal);
            case "openai":
                return this._callOpenAI(config, messages, start, signal);
            case "ollama":
                return this._callOllama(config, messages, start, signal);
            default:
                throw new Error(`Unknown Architect provider: ${config.provider}`);
        }
    }
    async stream(messages, onChunk, signal) {
        this._ensureConfigured();
        const config = this._config;
        const start = Date.now();
        switch (config.provider) {
            case "anthropic":
                return this._streamAnthropic(config, messages, onChunk, start, signal);
            case "openai":
                return this._streamOpenAI(config, messages, onChunk, start, signal);
            case "ollama":
                return this._streamOllama(config, messages, onChunk, start, signal);
            default:
                throw new Error(`Unknown Architect provider: ${config.provider}`);
        }
    }
    async callWithTools(messages, tools, rawMessages, signal) {
        this._ensureConfigured();
        const config = this._config;
        const start = Date.now();
        switch (config.provider) {
            case "anthropic":
                return this._callAnthropicWithTools(config, messages, tools, start, rawMessages, signal);
            case "openai":
                return this._callOpenAIWithTools(config, messages, tools, start, rawMessages, signal);
            case "ollama": {
                const resp = await this._callOllama(config, messages, start, signal);
                return { ...resp, toolCalls: [], stopReason: "end_turn" };
            }
            default:
                throw new Error(`Unknown Architect provider: ${config.provider}`);
        }
    }
    _messageTextContent(content) {
        if (typeof content === "string")
            return content;
        return content.filter((block) => block.type === "text").map((block) => block.text).join("\n\n");
    }
    _toAnthropicContent(content) {
        if (typeof content === "string")
            return content;
        return content.map((block) => {
            if (block.type === "text")
                return { type: "text", text: block.text };
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
    _toOpenAIContent(content) {
        if (typeof content === "string")
            return content;
        return content.map((block) => {
            if (block.type === "text")
                return { type: "text", text: block.text };
            return {
                type: "input_image",
                image_url: `data:${block.mimeType};base64,${block.dataBase64}`,
            };
        });
    }
    _toOllamaContent(content) {
        return this._messageTextContent(content);
    }
    _translateRawToOpenAI(raw) {
        const out = [];
        for (const msg of raw) {
            const m = msg;
            const role = m.role;
            const content = m.content;
            if (typeof content === "string") {
                out.push({ role, content });
                continue;
            }
            if (!Array.isArray(content)) {
                out.push(msg);
                continue;
            }
            const blocks = content;
            if (role === "assistant") {
                const textParts = blocks.filter((b) => b.type === "text").map((b) => b.text);
                const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
                const openaiMsg = {
                    role: "assistant",
                    content: textParts.join("") || null,
                };
                if (toolUseBlocks.length > 0) {
                    openaiMsg.tool_calls = toolUseBlocks.map((b) => ({
                        id: b.id,
                        type: "function",
                        function: {
                            name: b.name,
                            arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input),
                        },
                    }));
                }
                out.push(openaiMsg);
            }
            else if (role === "user") {
                const toolResults = blocks.filter((b) => b.type === "tool_result");
                const nonToolBlocks = blocks.filter((b) => b.type !== "tool_result");
                if (nonToolBlocks.length > 0) {
                    const translated = nonToolBlocks.map((b) => {
                        if (b.type === "image") {
                            const src = b.source;
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
                        tool_call_id: tr.tool_use_id,
                        content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
                    });
                }
            }
            else {
                out.push(msg);
            }
        }
        return out;
    }
    async _callAnthropic(config, messages, start, signal) {
        const { system, userMessages } = this._splitSystem(messages);
        const requestBody = this._buildAnthropicMessagesRequest(config, userMessages.map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) })), system);
        const res = await fetch(`${config.baseUrl}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": config.apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
            signal,
        });
        if (!res.ok)
            throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
        const data = (await res.json());
        return {
            content: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            durationMs: Date.now() - start,
        };
    }
    async _callAnthropicWithTools(config, messages, tools, start, rawMessages, signal) {
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
            body: JSON.stringify(requestBody),
            signal,
        });
        if (!res.ok)
            throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
        const data = (await res.json());
        return {
            content: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
            promptTokens: data.usage?.input_tokens ?? 0,
            completionTokens: data.usage?.output_tokens ?? 0,
            durationMs: Date.now() - start,
            toolCalls: data.content
                .filter((c) => c.type === "tool_use")
                .map((c) => ({ id: c.id, name: c.name, input: c.input ?? {} })),
            stopReason: data.stop_reason ?? "end_turn",
        };
    }
    async _callOpenAIWithTools(config, messages, tools, start, rawMessages, signal) {
        const openaiTools = tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }));
        const apiMessages = rawMessages
            ? this._translateRawToOpenAI(rawMessages)
            : messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) }));
        const { system } = this._splitSystem(messages);
        if (system && !apiMessages.some((m) => m.role === "system")) {
            apiMessages.unshift({ role: "system", content: system });
        }
        const res = await fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                max_completion_tokens: 16384,
                messages: apiMessages,
                tools: openaiTools,
            }),
            signal,
        });
        if (!res.ok)
            throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
        const data = (await res.json());
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
    async _streamAnthropic(config, messages, onChunk, start, signal) {
        const { system, userMessages } = this._splitSystem(messages);
        const requestBody = this._buildAnthropicMessagesRequest(config, userMessages.map((m) => ({ role: m.role, content: this._toAnthropicContent(m.content) })), system, undefined, true);
        const res = await fetch(`${config.baseUrl}/messages`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": config.apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
            signal,
        });
        if (!res.ok)
            throw new Error(`Anthropic API error (${res.status}): ${await res.text()}`);
        return this._readSSEStream(res, onChunk, start, "anthropic");
    }
    async _callOpenAI(config, messages, start, signal) {
        const res = await fetch(`${config.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                max_completion_tokens: 16384,
                messages: messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) })),
            }),
            signal,
        });
        if (!res.ok)
            throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
        const data = (await res.json());
        return {
            content: data.choices[0]?.message?.content ?? "",
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            durationMs: Date.now() - start,
        };
    }
    async _streamOpenAI(config, messages, onChunk, start, signal) {
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
                messages: messages.map((m) => ({ role: m.role, content: this._toOpenAIContent(m.content) })),
            }),
            signal,
        });
        if (!res.ok)
            throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);
        return this._readSSEStream(res, onChunk, start, "openai");
    }
    async _callOllama(config, messages, start, signal) {
        const res = await fetch(`${config.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: config.model,
                messages: messages.map((m) => ({ role: m.role, content: this._toOllamaContent(m.content) })),
                stream: false,
            }),
            signal,
        });
        if (!res.ok)
            throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);
        const data = (await res.json());
        return {
            content: data.message?.content ?? "",
            promptTokens: data.prompt_eval_count ?? 0,
            completionTokens: data.eval_count ?? 0,
            durationMs: Date.now() - start,
        };
    }
    async _streamOllama(config, messages, onChunk, start, signal) {
        const res = await fetch(`${config.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: config.model,
                messages: messages.map((m) => ({ role: m.role, content: this._toOllamaContent(m.content) })),
                stream: true,
            }),
            signal,
        });
        if (!res.ok)
            throw new Error(`Ollama API error (${res.status}): ${await res.text()}`);
        const reader = res.body?.getReader();
        if (!reader)
            throw new Error("No response body");
        const decoder = new TextDecoder();
        let fullContent = "";
        let promptTokens = 0;
        let completionTokens = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            const line = decoder.decode(value, { stream: true }).trim();
            if (!line)
                continue;
            try {
                const parsed = JSON.parse(line);
                const chunk = parsed.message?.content ?? "";
                if (chunk) {
                    fullContent += chunk;
                    onChunk(chunk);
                }
                if (parsed.done) {
                    promptTokens = parsed.prompt_eval_count ?? promptTokens;
                    completionTokens = parsed.eval_count ?? completionTokens;
                }
            }
            catch {
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
    async _readSSEStream(res, onChunk, start, provider) {
        let fullContent = "";
        let promptTokens = 0;
        let completionTokens = 0;
        const reader = res.body?.getReader();
        if (!reader)
            throw new Error("No response body");
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (!line.startsWith("data: "))
                    continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]")
                    continue;
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
                    }
                    else {
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
                }
                catch {
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
    _splitSystem(messages) {
        const systemMsgs = messages.filter((m) => m.role === "system");
        const userMessages = messages.filter((m) => m.role !== "system");
        const system = systemMsgs.length > 0 ? systemMsgs.map((m) => this._messageTextContent(m.content)).join("\n\n") : undefined;
        return { system, userMessages };
    }
    _defaultBaseUrl(provider) {
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
    _ensureConfigured() {
        if (!this._config || !this._config.provider) {
            throw new Error('Architect model not configured. Set "dreamgraph.architect.provider" and "dreamgraph.architect.model" in settings.');
        }
        if (!this._config.model) {
            throw new Error('Architect model name not set. Set "dreamgraph.architect.model" in settings.');
        }
        if (this._config.provider !== "ollama" && !this._config.apiKey) {
            throw new Error(`No API key stored for ${this._config.provider}. Use "DreamGraph: Set Architect API Key" to store one.`);
        }
    }
    dispose() {
        // Nothing to clean up
    }
}
exports.ArchitectLlm = ArchitectLlm;
//# sourceMappingURL=architect-llm.js.map