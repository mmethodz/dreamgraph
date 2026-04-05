/**
 * DreamGraph MCP Server — get_workflow tool.
 *
 * Retrieves a specific workflow by its ID.
 * Returns detailed step-by-step workflow information including
 * trigger conditions and source files.
 *
 * READ-ONLY: This tool only reads from cached JSON data.
 * It does NOT modify any files or repositories.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadJsonArray } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { Workflow, ToolResponse } from "../types/index.js";

/** Zod schema for get_workflow input */
export const GetWorkflowInputSchema = {
  name: z
    .string()
    .describe(
      'The workflow ID to retrieve, e.g. "invoice_creation", "user_onboarding", "field_report_submission", "data_sync".'
    ),
};

export function registerGetWorkflowTool(server: McpServer): void {
  server.tool(
    "get_workflow",
    "Retrieve a specific workflow by name/ID. Returns detailed step-by-step workflow information including trigger conditions, ordered steps with descriptions, and source file locations. Use this to understand how a business process flows through the your system.",
    GetWorkflowInputSchema,
    async ({ name }) => {
      logger.debug(`get_workflow called with name="${name}"`);

      const result = await safeExecute<Workflow>(async (): Promise<ToolResponse<Workflow>> => {
        // READ-ONLY: Load workflows from cached JSON data
        const workflows = await loadJsonArray<Workflow>("workflows.json");

        const workflow = workflows.find(
          (w) => w.id.toLowerCase() === name.toLowerCase()
        );

        if (!workflow) {
          const available = workflows.map((w) => w.id).join(", ");
          return error(
            "NOT_FOUND",
            `Workflow "${name}" not found. Available workflows: ${available}`
          );
        }

        return success(workflow);
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}
