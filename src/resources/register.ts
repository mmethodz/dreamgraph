/**
 * DreamGraph MCP Server — Resource registration.
 *
 * Registers all MCP resources that expose structured system context.
 * Resources are READ-ONLY JSON datasets served from the /data directory.
 *
 * All resources are loaded via the in-memory cache layer.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadJsonArray, loadJsonData } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import type {
  SystemOverview,
  Feature,
  Workflow,
  DataModelEntity,
  Capabilities,
  ResourceIndex,
} from "../types/index.js";

export function registerResources(server: McpServer): void {
  // -----------------------------------------------------------------------
  // system://overview — High-level system overview
  // -----------------------------------------------------------------------
  server.resource(
    "system-overview",
    "system://overview",
    {
      description:
        "High-level overview of the your system including all repositories, technology stacks, and purpose.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadJsonData<SystemOverview>("system_overview.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // system://features — All system features
  // -----------------------------------------------------------------------
  server.resource(
    "system-features",
    "system://features",
    {
      description:
        "All system features across all repositories with descriptions, source files, tags, and current status.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadJsonArray<Feature>("features.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // system://workflows — Operational workflows
  // -----------------------------------------------------------------------
  server.resource(
    "system-workflows",
    "system://workflows",
    {
      description:
        "Step-by-step operational workflows describing key business processes in the your system.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadJsonArray<Workflow>("workflows.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // system://data-model — Entity definitions and relationships
  // -----------------------------------------------------------------------
  server.resource(
    "system-data-model",
    "system://data-model",
    {
      description:
        "Complete data model with entity definitions, field schemas, types, and inter-entity relationships.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadJsonArray<DataModelEntity>("data_model.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // system://capabilities — Meta-resource: what this server can do
  // -----------------------------------------------------------------------
  server.resource(
    "system-capabilities",
    "system://capabilities",
    {
      description:
        "Meta-resource listing all available MCP resources and tools this server exposes, to help AI agents understand what they can do.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadJsonData<Capabilities>("capabilities.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // system://index — Resource entity index for fast lookup
  // -----------------------------------------------------------------------
  server.resource(
    "system-index",
    "system://index",
    {
      description:
        "Central resource index mapping all entity IDs to their resource URIs and types. Enables fast lookup and cross-resource linking.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);
      const data = await loadJsonData<ResourceIndex>("index.json");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 6 resources");
}
