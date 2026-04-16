/**
 * DreamGraph MCP Client — Layer 3.
 *
 * Wraps @modelcontextprotocol/sdk to connect to the daemon's /mcp endpoint
 * over Streamable HTTP. Provides typed helpers for tool calls and resource reads.
 *
 * @see TDD §1.4 (Communication Protocol)
 */
import * as vscode from "vscode";
export declare class McpClient implements vscode.Disposable {
    private _client;
    private _transport;
    private _baseUrl;
    /** External listener for server log/progress messages (set by ChatPanel). */
    onServerLog: ((level: string, message: string) => void) | null;
    constructor(baseUrl: string);
    get isConnected(): boolean;
    /**
     * Establish an MCP session with the daemon.
     */
    connect(): Promise<void>;
    /**
     * Close the MCP session gracefully.
     */
    disconnect(): Promise<void>;
    /**
     * Update the MCP endpoint URL (e.g. after port change).
     */
    updateBaseUrl(url: string): void;
    /**
     * List all available MCP tools on the daemon.
     */
    listTools(): Promise<Array<{
        name: string;
        description?: string;
        inputSchema: unknown;
    }>>;
    /**
     * Call an MCP tool by name with the given arguments.
     * @param timeoutMs Override request timeout (default 300 000 ms = 5 min).
     * @param onprogress Callback invoked with progress messages from the tool.
     */
    callTool(name: string, args?: Record<string, unknown>, timeoutMs?: number, onprogress?: (message: string, progress: number, total?: number) => void): Promise<unknown>;
    /**
     * List all available MCP resources on the daemon.
     */
    listResources(): Promise<Array<{
        uri: string;
        name: string;
        description?: string;
    }>>;
    /**
     * Read an MCP resource by URI.
     */
    readResource(uri: string): Promise<string | null>;
    /**
     * Get cognitive status from the daemon.
     */
    getCognitiveStatus(): Promise<unknown>;
    /**
     * Query a DreamGraph resource by type (feature, workflow, etc.)
     */
    queryResource(type: string, name?: string): Promise<unknown>;
    /**
     * Query architecture decisions.
     */
    queryAdrs(status?: string): Promise<unknown>;
    private _ensureConnected;
    dispose(): void;
}
//# sourceMappingURL=mcp-client.d.ts.map