/**
 * DreamGraph MCP Server — Server setup and orchestration.
 *
 * Creates the McpServer instance and registers all resources and tools.
 * Transport-agnostic: callers provide the transport (Stdio, SSE, etc.)
 * and call `server.connect(transport)` themselves.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { registerResources } from "../resources/register.js";
import { registerTools } from "../tools/register.js";
import {
  registerCognitiveResources,
  registerCognitiveTools,
} from "../cognitive/register.js";
import { registerDisciplineResource } from "../discipline/register.js";
import { startScheduler, stopScheduler } from "../cognitive/scheduler.js";
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

  // v6.0 — Register discipline execution system (ADR-001)
  registerDisciplineResource(server);

  // v5.2 — Start the dream scheduler
  startScheduler(config.scheduler);

  // Clean shutdown — flush logs before exiting so daemon can verify
  const gracefulExit = () => {
    stopScheduler();
    logger.info("Shutdown complete");
    // Allow stderr to flush to the log file descriptor before exiting
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", gracefulExit);
  process.on("SIGTERM", gracefulExit);

  return server;
}
