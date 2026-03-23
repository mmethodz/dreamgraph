/**
 * DreamGraph MCP Server — Server setup and orchestration.
 *
 * Creates the McpServer instance and registers all resources and tools.
 * Connects via StdioServerTransport (NO Express, NO HTTP).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { registerResources } from "../resources/register.js";
import { registerTools } from "../tools/register.js";
import {
  registerCognitiveResources,
  registerCognitiveTools,
} from "../cognitive/register.js";
import { logger } from "../utils/logger.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: config.server.name,
    version: config.server.version,
  });

  logger.info(
    `Initializing ${config.server.name} v${config.server.version}`
  );

  // Register all MCP resources (READ-ONLY context data)
  registerResources(server);

  // Register all MCP tools (READ-ONLY query tools)
  registerTools(server);

  // Register cognitive dreaming system (resources + tools)
  registerCognitiveResources(server);
  registerCognitiveTools(server);

  return server;
}
