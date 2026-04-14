/**
 * DreamGraph MCP Server — Server setup and orchestration.
 *
 * Creates the McpServer instance and registers all resources and tools.
 * Transport-agnostic: callers provide the transport (Stdio, SSE, etc.)
 * and call `server.connect(transport)` themselves.
 *
 * The server sends `instructions` on initialization so AI agents know
 * how to use every tool from the first message — no trial-and-error.
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
import { recordToolCall } from "../instance/index.js";
import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Server instructions — injected into the AI's context on init
// ---------------------------------------------------------------------------

function buildInstructions(): string {
  const repoNames = Object.keys(config.repos);
  const repoList = repoNames.length > 0
    ? repoNames.map(r => `  - "${r}" → ${config.repos[r]}`).join("\n")
    : "  (none configured — run init_graph or set DREAMGRAPH_REPOS)";

  const hasDb = config.database.connectionString.length > 0;

  return `# DreamGraph MCP Server v${config.server.version}

You are connected to a DreamGraph cognitive knowledge-graph server.
Use these tools to understand, enrich, and reason about the project.

## Available Repositories
${repoList}

Use these repo names as the \`repo\` parameter for read_source_code, list_directory, git_log, and git_blame.

## Quick-Start Workflow
1. **Discover** — Read \`system://capabilities\` or call \`cognitive_status\` to see current state.
2. **Bootstrap** — If the knowledge graph is empty, configure LLM settings then call \`scan_project\` (or \`init_graph\`) to scan repos and populate seed data.
3. **Read code** — Use \`read_source_code\` and \`list_directory\` with repo="${repoNames[0] ?? "REPO_NAME"}".
4. **Git history** — Use \`git_log\` and \`git_blame\` with the same repo name.
5. **Enrich** — Call \`enrich_seed_data\` with target="features"|"workflows"|"data_model"|"capabilities".
   Schema is lenient: \`links\` accepts strings, \`steps\` accepts strings, \`source_files\` accepts strings.
6. **Dream** — Call \`dream_cycle\` to generate speculative edges and auto-normalize.
7. **Inspect** — Use \`query_resource\`, \`get_dream_insights\`, \`get_temporal_insights\`.
8. **Decide** — Use \`record_architecture_decision\` to capture design choices.

## Key Tool Patterns

### Code & Git (require \`repo\` parameter)
- \`read_source_code(repo, path)\` — Read file contents. Path is relative to repo root.
- \`list_directory(repo, path?)\` — List files/dirs. Omit path for repo root.
- \`git_log(repo, path?, maxCount?)\` — Commit history.
- \`git_blame(repo, path)\` — Per-line authorship.

### Knowledge Graph Enrichment
- \`enrich_seed_data(target, entries, mode?)\` — Upsert entities into the fact graph.
  Each entry needs \`id\` and \`name\` at minimum. All nested arrays (links, steps,
  source_files, key_fields, relationships) accept plain strings that auto-coerce to objects.
- \`init_graph(repos?, force?)\` — One-time bootstrap from source code scanning.

### Cognitive Dreaming
- \`dream_cycle(strategy?, max_dreams?)\` — Run the dream engine.
- \`nightmare_cycle(strategy?)\` — Adversarial security scan.
- \`normalize_dreams(threshold?)\` — Manual normalization pass.
- \`cognitive_status()\` — Engine state, cycle counts, graph stats.

### Query & Inspect
- \`query_resource(uri)\` — Read any resource: \`system://features\`, \`system://workflows\`,
  \`system://data-model\`, \`system://overview\`, \`dream://graph\`, \`dream://tensions\`, etc.
- \`get_dream_insights()\`, \`get_temporal_insights()\`, \`get_causal_insights()\`
- \`search_data_model(entity)\`, \`get_workflow(name)\`

### Architecture Decisions
- \`record_architecture_decision(...)\` — Capture a design decision with rationale.
- \`query_architecture_decisions(entity_id?, tag?, status?)\`
- \`deprecate_architecture_decision(adr_id, new_status, reason)\`

${hasDb ? "### Database\n- `query_db_schema(search?, table_name?)` — Inspect PostgreSQL schema.\n" : ""}### Web
- \`fetch_web_page(url, selector?, maxLength?)\` — Fetch and extract web content.

## Resources (read via query_resource or direct resource read)
System: system://overview, system://features, system://workflows, system://data-model, system://capabilities, system://index
Cognitive: dream://graph, dream://candidates, dream://validated, dream://status, dream://tensions, dream://history, dream://adrs, dream://ui-registry, dream://threats, dream://archetypes, dream://metacognition, dream://events, dream://story, dream://schedules, dream://schedule-history
Discipline: discipline://manifest
`;
}

export function createServer(): McpServer {
  const instructions = buildInstructions();

  const server = new McpServer(
    {
      name: config.server.name,
      version: config.server.version,
    },
    { instructions },
  );

  logger.info(
    `Initializing ${config.server.name} v${config.server.version}`
  );

  // ---- Wrap server.tool() to auto-count every MCP tool invocation ----
  // The handler is always the last argument regardless of which overload
  // is used:  tool(name, cb) | tool(name, desc, cb) | tool(name, schema, cb)
  //          | tool(name, desc, schema, cb)
  const _originalTool = server.tool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool = (...args: unknown[]) => {
    const lastIdx = args.length - 1;
    const originalHandler = args[lastIdx];
    if (typeof originalHandler === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args[lastIdx] = async (...handlerArgs: any[]) => {
        // Fire-and-forget — don't block the tool response on counter I/O
        recordToolCall().catch(() => {});
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (originalHandler as any)(...handlerArgs);
      };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_originalTool as any)(...args);
  };

  // Register all MCP resources (READ-ONLY context data)
  registerResources(server);

  // Register all MCP tools (READ-ONLY query tools)
  registerTools(server);

  // Register cognitive dreaming system (resources + tools)
  registerCognitiveResources(server);
  registerCognitiveTools(server);

  // v7.0 — Register discipline execution system (ADR-001)
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
