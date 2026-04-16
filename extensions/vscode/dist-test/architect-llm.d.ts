/**
 * DreamGraph Architect LLM Provider — Layer 2 (Context Orchestration).
 *
 * Calls the Architect model (Anthropic, OpenAI, or Ollama) with
 * structured prompts assembled from the context orchestration layer.
 */
import * as vscode from "vscode";
export type ArchitectProvider = "anthropic" | "openai" | "ollama";
export interface ArchitectConfig {
    provider: ArchitectProvider;
    model: string;
    baseUrl: string;
    apiKey: string;
}
export type ArchitectContentBlock = {
    type: "text";
    text: string;
} | {
    type: "image";
    mimeType: string;
    dataBase64: string;
    fileName?: string;
};
export interface ArchitectMessage {
    role: "system" | "user" | "assistant";
    content: string | ArchitectContentBlock[];
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
export declare const ANTHROPIC_MODELS: string[];
export declare const OPENAI_MODELS: string[];
export declare class ArchitectLlm implements vscode.Disposable {
    private _config;
    private _secretStorage;
    constructor(secretStorage: vscode.SecretStorage);
    get isConfigured(): boolean;
    get provider(): ArchitectProvider | null;
    get currentConfig(): ArchitectConfig | null;
    /** Apply a config directly in memory (skips settings round-trip). */
    applyConfig(config: ArchitectConfig): void;
    getModelCapabilities(provider?: ArchitectProvider | null, model?: string | null): ArchitectModelCapabilities;
    loadConfig(): Promise<void>;
    setApiKey(provider: ArchitectProvider, key: string): Promise<void>;
    getApiKey(provider: ArchitectProvider): Promise<string | undefined>;
    call(messages: ArchitectMessage[], signal?: AbortSignal): Promise<ArchitectResponse>;
    stream(messages: ArchitectMessage[], onChunk: StreamCallback, signal?: AbortSignal): Promise<ArchitectResponse>;
    callWithTools(messages: ArchitectMessage[], tools: ToolDefinition[], rawMessages?: unknown[], signal?: AbortSignal): Promise<ArchitectToolResponse>;
    private _messageTextContent;
    private _toAnthropicContent;
    private _toOpenAIContent;
    private _toOllamaContent;
    private _translateRawToOpenAI;
    private _callAnthropic;
    private _callAnthropicWithTools;
    private _callOpenAIWithTools;
    private _streamAnthropic;
    private _callOpenAI;
    private _streamOpenAI;
    private _callOllama;
    private _streamOllama;
    private _readSSEStream;
    private _splitSystem;
    private _defaultBaseUrl;
    private _ensureConfigured;
    dispose(): void;
}
//# sourceMappingURL=architect-llm.d.ts.map