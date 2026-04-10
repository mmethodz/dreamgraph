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
import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  MCP Client Wrapper                                                */
/* ------------------------------------------------------------------ */

export class McpClient implements vscode.Disposable {
  private _client: Client | null = null;
  private _transport: StreamableHTTPClientTransport | null = null;
  private _baseUrl: string;

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
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    this._ensureConnected();
    const result = await this._client!.callTool({ name, arguments: args });
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
   * Query a DreamGraph resource by type (feature, workflow, etc.)
   */
  async queryResource(
    type: string,
    name?: string,
  ): Promise<unknown> {
    return this.callTool("query_resource", { type, name });
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
