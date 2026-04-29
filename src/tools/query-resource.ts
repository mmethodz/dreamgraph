/**
 * DreamGraph MCP Server — query_resource tool.
 *
 * A generic, flexible tool to dynamically fetch and filter any
 * resource data by URI. Avoids tool explosion by providing a
 * single entry point for querying all resource datasets.
 *
 * READ-ONLY: This tool only reads from cached JSON data.
 * It does NOT modify any files or repositories.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadJsonData } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { ToolResponse } from "../types/index.js";

/** Map resource URIs to their data files.
 *
 * Must stay in sync with the resources registered in
 * src/resources/register.ts and src/cognitive/register.ts. Any URI exposed
 * via `server.resource(...)` that is backed by a JSON file in `data/` should
 * also be queryable through this tool, otherwise the architect (and any
 * other MCP client using `query_resource`) sees INVALID_URI even though the
 * raw MCP `resources/read` would succeed.
 */
const URI_TO_FILE: Record<string, string> = {
  // System resources (src/resources/register.ts)
  "system://overview": "system_overview.json",
  "system://features": "features.json",
  "system://workflows": "workflows.json",
  "system://data-model": "data_model.json",
  "system://datastores": "datastores.json",
  "system://capabilities": "capabilities.json",
  "system://index": "index.json",
  // Cognitive / dream resources (src/cognitive/register.ts)
  "dream://graph": "dream_graph.json",
  "dream://candidates": "candidate_edges.json",
  "dream://validated": "validated_edges.json",
  "dream://tensions": "tension_log.json",
  "dream://history": "dream_history.json",
  "dream://adrs": "adr_log.json",
  "dream://ui-registry": "ui_registry.json",
  "dream://threats": "threat_log.json",
  "dream://archetypes": "dream_archetypes.json",
  "dream://metacognition": "meta_log.json",
  "dream://events": "event_log.json",
  "dream://story": "system_story.json",
  "dream://schedules": "schedules.json",
  "dream://lucid": "lucid_log.json",
  // Ops resources
  "ops://api-surface": "api_surface.json",
};

/** Zod schema for query_resource input */
export const QueryResourceInputSchema = {
  uri: z
    .string()
    .describe(
      'The resource URI to query, e.g. "system://features", "system://workflows", "system://data-model", "system://overview", "system://capabilities", "system://index".'
    ),
  filter: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional key/value pairs to filter results. Filters match against top-level fields of each entry. Example: { "status": "active" } or { "tags": "invoices" }.'
    ),
};

/**
 * Check whether a single resource entry matches the given filter.
 * Supports string matching, substring matching within arrays, and
 * case-insensitive comparison.
 */
function matchesFilter(
  entry: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  for (const [key, filterValue] of Object.entries(filter)) {
    const entryValue = entry[key];
    if (entryValue === undefined) return false;

    // Array field: check if filter value is contained in the array
    if (Array.isArray(entryValue)) {
      const filterStr = String(filterValue).toLowerCase();
      const found = entryValue.some(
        (item) => String(item).toLowerCase().includes(filterStr)
      );
      if (!found) return false;
      continue;
    }

    // String comparison: case-insensitive includes
    if (typeof entryValue === "string" && typeof filterValue === "string") {
      if (!entryValue.toLowerCase().includes(filterValue.toLowerCase())) {
        return false;
      }
      continue;
    }

    // Exact match fallback
    if (entryValue !== filterValue) return false;
  }

  return true;
}

export function registerQueryResourceTool(server: McpServer): void {
  server.tool(
    "query_resource",
    "Generic resource query tool. Fetch any resource by its URI and optionally filter results by field values. Supports filtering by source_repo, tags, status, id, name, or any top-level field. Use this as a flexible way to explore system data without needing a dedicated tool for each resource type.",
    QueryResourceInputSchema,
    async ({ uri, filter }) => {
      logger.debug(
        `query_resource called with uri="${uri}", filter=${JSON.stringify(filter)}`
      );

      const result = await safeExecute<unknown>(
        async (): Promise<ToolResponse<unknown>> => {
          try {
            const filename = URI_TO_FILE[uri];
            if (!filename) {
              const available = Object.keys(URI_TO_FILE).join(", ");
              return error(
                "INVALID_URI",
                `Unknown resource URI "${uri}". Available URIs: ${available}`
              );
            }

            // READ-ONLY: Load resource data from cached JSON
            const data = await loadJsonData<unknown>(filename);

            // If no filter, return the full dataset
            if (!filter || Object.keys(filter).length === 0) {
              return success(data);
            }

            // Apply filter to array resources
            if (Array.isArray(data)) {
              const filtered = data.filter((entry) =>
                matchesFilter(entry as Record<string, unknown>, filter)
              );
              if (filtered.length === 0) {
                return error(
                  "NO_MATCH",
                  `No entries matched the filter ${JSON.stringify(filter)} in resource "${uri}".`
                );
              }
              return success(filtered);
            }

            // For object resources, attempt to filter nested properties
            if (typeof data === "object" && data !== null) {
              const obj = data as Record<string, unknown>;
              // If the object has an "entities" key (like index.json), filter within it
              if ("entities" in obj && typeof obj.entities === "object") {
                const entities = obj.entities as Record<string, Record<string, unknown>>;
                const filtered: Record<string, Record<string, unknown>> = {};
                for (const [id, entry] of Object.entries(entities)) {
                  if (matchesFilter(entry, filter)) {
                    filtered[id] = entry;
                  }
                }
                if (Object.keys(filtered).length === 0) {
                  return error(
                    "NO_MATCH",
                    `No entries matched the filter ${JSON.stringify(filter)} in resource "${uri}".`
                  );
                }
                return success({ entities: filtered });
              }
              // Otherwise return the whole object (e.g., system_overview)
              return success(data);
            }

            return success(data);
          } catch (err) {
            logger.error(
              `query_resource unexpected failure for uri="${uri}"${filter ? `, filter=${JSON.stringify(filter)}` : ""}: ${err instanceof Error ? err.message : String(err)}`
            );
            throw err;
          }
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
