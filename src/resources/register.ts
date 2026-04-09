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
import { config } from "../config/config.js";
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
  // system://capabilities — Dynamic meta-resource: runtime server state
  // -----------------------------------------------------------------------
  server.resource(
    "system-capabilities",
    "system://capabilities",
    {
      description:
        "Dynamic meta-resource showing runtime server capabilities: version, configured repositories, " +
        "available tool categories, resource URIs, and cognitive engine strategies. " +
        "Read this first to understand what you can do.",
      mimeType: "application/json",
    },
    async (uri) => {
      logger.debug(`Resource requested: ${uri.href}`);

      // Build dynamic capabilities from actual runtime config
      const repos = Object.entries(config.repos).map(([name, path]) => ({
        name,
        path,
      }));

      const capabilities = {
        server: {
          name: config.server.name,
          version: config.server.version,
        },
        repositories: {
          configured: repos,
          note: "Use these names as the 'repo' parameter for read_source_code, list_directory, git_log, git_blame.",
        },
        tools: {
          foundation: {
            count: 22,
            categories: [
              "Code Senses (read_source_code, list_directory)",
              "Git Senses (git_log, git_blame)",
              "Web Senses (fetch_web_page)",
              "DB Senses (query_db_schema)" + (config.database.connectionString ? " — configured" : " — not configured"),
              "Runtime Senses (query_runtime_metrics)",
              "Knowledge Tools (init_graph, get_workflow, search_data_model, query_resource)",
              "Enrichment (enrich_seed_data — targets: features, workflows, data_model, capabilities)",
              "Visual Architect (generate_visual_flow)",
              "ADR Historian (record/query/deprecate_architecture_decision)",
              "UI Registry (register/query_ui_elements, generate_ui_migration_plan)",
              "Insight Injection (solidify_cognitive_insight)",
              "Living Docs (export_living_docs)",
            ],
          },
          cognitive: {
            count: 23,
            categories: [
              "Core Cycle (dream_cycle, normalize_dreams, nightmare_cycle)",
              "Introspection (cognitive_status, get_dream_insights, metacognitive_analysis)",
              "Temporal & Causal (get_temporal_insights, get_causal_insights)",
              "Tension (resolve_tension, get_remediation_plan)",
              "Federation (export/import_dream_archetypes)",
              "Narrative (get_system_story, get_system_narrative)",
              "Scheduling (schedule_dream, list/update/delete/run_schedule, get_schedule_history)",
              "Events (dispatch_cognitive_event, clear_dreams)",
            ],
          },
          discipline: {
            count: 9,
            note: "Five-phase execution model: INGEST → AUDIT → PLAN → EXECUTE → VERIFY",
          },
        },
        resources: [
          "system://overview", "system://features", "system://workflows",
          "system://data-model", "system://capabilities", "system://index",
          "dream://graph", "dream://candidates", "dream://validated",
          "dream://status", "dream://tensions", "dream://history",
          "dream://adrs", "dream://ui-registry", "dream://threats",
          "dream://archetypes", "dream://metacognition", "dream://events",
          "dream://story", "dream://schedules", "dream://schedule-history",
          "discipline://manifest",
        ],
        cognitive_engine: {
          states: ["AWAKE", "REM", "NORMALIZING", "NIGHTMARE"],
          dream_strategies: [
            "gap_detection", "weak_reinforcement", "cross_domain",
            "missing_abstraction", "symmetry_completion", "tension_directed",
            "causal_replay",
          ],
          nightmare_strategies: [
            "privilege_escalation", "data_leak_path", "injection_surface",
            "missing_validation", "broken_access_control",
          ],
        },
        enrichment_schema_notes: {
          note: "enrich_seed_data accepts lenient schemas — plain strings auto-coerce to full objects.",
          links: "string 'entity_id' → {target: 'entity_id', type: 'feature', relationship: 'related_to', strength: 'moderate'}",
          source_files: "string paths accepted directly",
          steps: "string 'step name' → {order: auto, name: 'step name', description: ''}",
          key_fields: "string 'field_name' → {name: 'field_name', type: 'unknown', description: ''}",
          relationships: "string 'target_id' → {type: 'references', target: 'target_id', via: ''}",
        },
      };

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(capabilities, null, 2),
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
