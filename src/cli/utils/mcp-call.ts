/**
 * DreamGraph CLI — MCP tool call helper.
 *
 * Connects to a running DreamGraph daemon via Streamable HTTP transport,
 * calls one MCP tool, and disconnects.  Used by CLI commands that need
 * to invoke server-side tools (e.g. `dg scan`, `dg schedule`).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpCallResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Call a single MCP tool on a running DreamGraph daemon.
 *
 * @param port    The daemon HTTP port.
 * @param tool    MCP tool name (e.g. "scan_project").
 * @param args    Tool input arguments.
 * @param timeoutMs  Request timeout (default: 5 minutes).
 * @returns       The tool result content array.
 */
export async function mcpCallTool(
  port: number,
  tool: string,
  args: Record<string, unknown> = {},
  timeoutMs = 300_000,
): Promise<McpCallResult> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );

  const client = new Client({
    name: "dreamgraph-cli",
    version: "8.1.0",
  });

  try {
    await client.connect(transport);

    const result = await Promise.race([
      client.callTool({ name: tool, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool call '${tool}' timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);

    return result as McpCallResult;
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors — the connection may already be closed
    }
  }
}

/**
 * List all available MCP tools on a running daemon.
 */
export async function mcpListTools(
  port: number,
): Promise<Array<{ name: string; description?: string }>> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${port}/mcp`),
  );

  const client = new Client({
    name: "dreamgraph-cli",
    version: "8.1.0",
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
    }));
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore
    }
  }
}
