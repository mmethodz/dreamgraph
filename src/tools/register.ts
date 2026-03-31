/**
 * DreamGraph MCP Server — Tool registration barrel.
 *
 * Registers all MCP tools on the server instance.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGetWorkflowTool } from "./get-workflow.js";
import { registerSearchDataModelTool } from "./search-data-model.js";
import { registerQueryResourceTool } from "./query-resource.js";
import { registerCodeSensesTools } from "./code-senses.js";
import { registerSolidifyInsightTool } from "./solidify-insight.js";
import { registerWebSensesTools } from "./web-senses.js";
import { registerGitSensesTools } from "./git-senses.js";
import { registerDbSensesTools } from "./db-senses.js";
import { registerVisualArchitectTools } from "./visual-architect.js";
import { registerADRTools } from "./adr-historian.js";
import { registerUIRegistryTools } from "./ui-registry.js";
import { registerLivingDocsTools } from "./living-docs-exporter.js";
import { registerRuntimeSensesTools } from "./runtime-senses.js";
import { logger } from "../utils/logger.js";

export function registerTools(server: McpServer): void {
  registerGetWorkflowTool(server);
  registerSearchDataModelTool(server);
  registerQueryResourceTool(server);
  registerCodeSensesTools(server);
  registerSolidifyInsightTool(server);
  registerWebSensesTools(server);
  registerGitSensesTools(server);
  registerDbSensesTools(server);
  registerVisualArchitectTools(server);
  registerADRTools(server);
  registerUIRegistryTools(server);
  registerLivingDocsTools(server);
  registerRuntimeSensesTools(server);

  logger.info("Registered 20 tools");
}
