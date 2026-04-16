/**
 * DreamGraph Context Builder — Layer 2 (Context Orchestration).
 *
 * Assembles EditorContextEnvelope from editor state + DreamGraph knowledge.
 * Implements the §3.4 Context Assembly Pipeline and §3.7 Token Budget.
 *
 * @see TDD §3.2 (Context Envelope), §3.4 (Assembly Pipeline), §3.5 (Knowledge Integration), §3.7 (Token Budget)
 */
import type { McpClient } from "./mcp-client.js";
import type { DaemonClient } from "./daemon-client.js";
import type { EditorContextEnvelope, ResolvedInstance } from "./types.js";
export interface ContextBuilderOptions {
    maxContextTokens: number;
    instance: ResolvedInstance | null;
}
export declare class ContextBuilder {
    private _mcpClient;
    private _daemonClient;
    private _options;
    constructor(mcpClient: McpClient, daemonClient: DaemonClient, options: ContextBuilderOptions);
    updateOptions(options: Partial<ContextBuilderOptions>): void;
    /**
     * Build a full context envelope for the current editor state.
     * Optionally accepts a user prompt for intent detection.
     */
    buildEnvelope(prompt?: string, commandSource?: string): Promise<EditorContextEnvelope>;
    /**
     * Read the full content of the active file.
     * Returns null if no active editor.
     */
    readActiveFileContent(): string | null;
    /**
     * Read the current selection text.
     * Returns null if no selection.
     */
    readSelectionContent(): string | null;
    /**
     * Read a file by path (relative to workspace root).
     */
    readFile(relativePath: string): Promise<string | null>;
    private _shouldFetchGraphContext;
    private _fetchGraphContext;
    private _fetchDreamInsights;
    private _fetchCausalInsights;
    private _fetchTemporalInsights;
    private _fetchDataModelEntities;
    private _fetchCognitiveStatus;
    /**
     * Assemble context sections into a single text block, respecting token budget.
     * Returns the assembled context and budget metadata.
     */
    assembleContextBlock(envelope: EditorContextEnvelope, fileContent: string | null, additionalSections: Map<string, string>): {
        text: string;
        usedTokens: number;
        totalTokens: number;
        trimmedSections: string[];
    };
    private _trimActiveFile;
}
//# sourceMappingURL=context-builder.d.ts.map