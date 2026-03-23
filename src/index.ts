#!/usr/bin/env node

/**
 * DreamGraph MCP Server — Entry point.
 *
 * Starts the MCP server using STDIO transport.
 * All communication happens over stdin/stdout (JSON-RPC).
 * All logging goes to stderr to avoid corrupting the MCP stream.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server/server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("DreamGraph MCP Server running on stdio");
}

main().catch((err) => {
  logger.error("Fatal error:", err);
  process.exit(1);
});
