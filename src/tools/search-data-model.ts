/**
 * DreamGraph MCP Server — search_data_model tool.
 *
 * Searches the data model for a specific entity by name/ID.
 * Returns full entity schema including fields, types,
 * relationships, and source file locations.
 *
 * READ-ONLY: This tool only reads from cached JSON data.
 * It does NOT modify any files or repositories.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadJsonArray } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { DataModelEntity, ToolResponse } from "../types/index.js";

/** Zod schema for search_data_model input */
export const SearchDataModelInputSchema = {
  entity: z
    .string()
    .describe(
      'The entity ID to search for, e.g. "invoice", "customer", "user", "field_report", "site", "work_order".'
    ),
};

export function registerSearchDataModelTool(server: McpServer): void {
  server.tool(
    "search_data_model",
    "Search the data model for a specific entity by name. Returns the full entity schema including all fields with their types, descriptions, inter-entity relationships, and source file locations. Use this to understand the structure of a specific data entity in the your system.",
    SearchDataModelInputSchema,
    async ({ entity }) => {
      logger.debug(`search_data_model called with entity="${entity}"`);

      const result = await safeExecute<DataModelEntity>(
        async (): Promise<ToolResponse<DataModelEntity>> => {
          // READ-ONLY: Load data model from cached JSON data
          const entities = await loadJsonArray<DataModelEntity>("data_model.json");

          const found = entities.find(
            (e) => e.id.toLowerCase() === entity.toLowerCase()
          );

          if (!found) {
            const available = entities.map((e) => e.id).join(", ");
            return error(
              "NOT_FOUND",
              `Entity "${entity}" not found. Available entities: ${available}`
            );
          }

          return success(found);
        }
      );

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
