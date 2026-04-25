/**
 * DreamGraph MCP Client — Layer 3.
 *
 * Wraps @modelcontextprotocol/sdk to connect to the daemon's /mcp endpoint
 * over Streamable HTTP. Provides typed helpers for tool calls and resource reads.
 *
 * @see TDD §1.4 (Communication Protocol)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  MCP Client Wrapper                                                */
/* ------------------------------------------------------------------ */

export class McpClient implements vscode.Disposable {
  private _client: Client | null = null;
  private _transport: StreamableHTTPClientTransport | null = null;
  private _baseUrl: string;

  /** External listener for server log/progress messages (set by ChatPanel). */
  public onServerLog: ((level: string, message: string) => void) | null = null;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  /* ---- Connection ---- */

  get isConnected(): boolean {
    return this._client !== null;
  }

  /**
   * Establish an MCP session with the daemon.
   */
  async connect(): Promise<void> {
    await this.disconnect();

    this._transport = new StreamableHTTPClientTransport(
      new URL(`${this._baseUrl}/mcp`),
    );

    this._client = new Client(
      { name: "dreamgraph-vscode", version: "0.1.0" },
      { capabilities: {} },
    );

    await this._client.connect(this._transport);

    // Subscribe to server log notifications and forward to the external listener
    this._client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (notification) => {
        if (this.onServerLog) {
          const p = notification.params;
          const msg = typeof p.data === 'string' ? p.data : JSON.stringify(p.data);
          this.onServerLog(p.level, msg);
        }
      },
    );
  }

  /**
   * Close the MCP session gracefully.
   */
  async disconnect(): Promise<void> {
    if (this._client) {
      try {
        await this._client.close();
      } catch {
        // Best-effort close
      }
      this._client = null;
      this._transport = null;
    }
  }

  /**
   * Update the MCP endpoint URL (e.g. after port change).
   */
  updateBaseUrl(url: string): void {
    this._baseUrl = url;
  }

  /* ---- Tool Calls ---- */

  /**
   * List all available MCP tools on the daemon.
   */
  async listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  > {
    this._ensureConnected();
    const result = await this._client!.listTools();
    return result.tools;
  }

  /**
   * Call an MCP tool by name with the given arguments.
   * @param timeoutMs Override request timeout (default 300 000 ms = 5 min).
   * @param onprogress Callback invoked with progress messages from the tool.
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
    timeoutMs = 300_000,
    onprogress?: (message: string, progress: number, total?: number) => void,
  ): Promise<unknown> {
    this._ensureConnected();
    const result = await this._client!.callTool(
      { name, arguments: args },
      undefined,
      {
        timeout: timeoutMs,
        ...(onprogress
          ? {
              onprogress: (p: { progress: number; total?: number; message?: string }) => {
                onprogress(p.message ?? `Step ${p.progress}`, p.progress, p.total);
              },
            }
          : {}),
      },
    );
    // MCP tool results have a `content` array; extract text content
    if (result.content && Array.isArray(result.content)) {
      const textParts = result.content
        .filter(
          (c: { type: string }) => c.type === "text",
        )
        .map((c: { type: string; text: string }) => c.text);
      if (textParts.length === 1) {
        // Try to parse as JSON
        try {
          return JSON.parse(textParts[0]);
        } catch {
          return textParts[0];
        }
      }
      return textParts.length > 0 ? textParts : result.content;
    }
    return result;
  }

  /* ---- Resource Reads ---- */

  /**
   * List all available MCP resources on the daemon.
   */
  async listResources(): Promise<
    Array<{ uri: string; name: string; description?: string }>
  > {
    this._ensureConnected();
    const result = await this._client!.listResources();
    return result.resources;
  }

  /**
   * Read an MCP resource by URI.
   */
  async readResource(uri: string): Promise<string | null> {
    this._ensureConnected();
    const result = await this._client!.readResource({ uri });
    if (result.contents && result.contents.length > 0) {
      const first = result.contents[0];
      if ("text" in first) {
        return first.text as string;
      }
    }
    return null;
  }

  /* ---- Convenience: DreamGraph-specific helpers ---- */

  /**
   * Get cognitive status from the daemon.
   */
  async getCognitiveStatus(): Promise<unknown> {
    return this.callTool("cognitive_status");
  }

  /**
   * Query a DreamGraph resource by URI and optional top-level field filter.
   *
   * Examples:
   * - queryResource("system://features")
   * - queryResource("dream://adrs", { status: "accepted" })
   */
  async queryResource(
    uri: string,
    filter?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callTool("query_resource", {
      uri,
      ...(filter && Object.keys(filter).length > 0 ? { filter } : {}),
    });
  }

  /**
   * Query architecture decisions.
   */
  async queryAdrs(status?: string): Promise<unknown> {
    return this.callTool("query_architecture_decisions", {
      ...(status ? { status } : {}),
    });
  }

  /* ---- Internal ---- */

  private _ensureConnected(): void {
    if (!this._client) {
      throw new Error(
        "MCP client is not connected. Call connect() first.",
      );
    }
  }

  /* ---- Dispose ---- */

  dispose(): void {
    void this.disconnect();
  }
}
