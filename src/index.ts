#!/usr/bin/env node

/**
 * DreamGraph MCP Server — Entry point.
 *
 * Supports two transport modes:
 *   --transport stdio   (default) JSON-RPC over stdin/stdout
 *   --transport http    Streamable HTTP (MCP 2025-03-26 spec) on a given port
 *
 * Options:
 *   --port <number>     Port for HTTP mode (default: 8100)
 *
 * Examples:
 *   dreamgraph                               # stdio (default)
 *   dreamgraph --transport http              # Streamable HTTP on :8100
 *   dreamgraph --transport http --port 9000  # Streamable HTTP on :9000
 */

import { createServer } from "./server/server.js";
import { handleDashboardRoute, setDashboardContext } from "./server/dashboard.js";
import { handleApiRoute } from "./api/routes.js";
import { handleExplorerRoute } from "./explorer/routes.js";
import { startDataDirWatcher } from "./graph/watcher.js";
import { resolveInstanceAtStartup, updateInstanceCounters } from "./instance/index.js";
import { engine } from "./cognitive/engine.js";
import { initLlmProvider } from "./cognitive/llm.js";
import { logger } from "./utils/logger.js";

/* ------------------------------------------------------------------ */
/*  CLI argument parsing                                              */
/* ------------------------------------------------------------------ */

type TransportMode = "stdio" | "http";

interface CLIOptions {
  transport: TransportMode;
  port: number;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  let transport: TransportMode = "stdio";
  let port = 8100;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transport": {
        const val = args[++i];
        if (val === "stdio" || val === "http") {
          transport = val;
        } else {
          console.error(`Unknown transport "${val}". Use "stdio" or "http".`);
          process.exit(1);
        }
        break;
      }
      case "--port": {
        port = parseInt(args[++i], 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error("--port must be a valid port number (1–65535).");
          process.exit(1);
        }
        break;
      }
      case "--help":
      case "-h":
        console.log(
          [
            "Usage: dreamgraph [options]",
            "",
            "Options:",
            "  --transport <stdio|http>  Transport mode (default: stdio)",
            "  --port <number>           Port for HTTP mode  (default: 8100)",
            "  --help, -h                Show this help message",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }

  return { transport, port };
}

/* ------------------------------------------------------------------ */
/*  Transport launchers                                               */
/* ------------------------------------------------------------------ */

/** Start in STDIO mode — JSON-RPC over stdin/stdout. */
async function startStdio(): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("DreamGraph MCP Server running on stdio");
}

/**
 * Start in Streamable HTTP mode (MCP 2025-03-26 spec).
 *
 * Single endpoint:  POST /mcp  — JSON-RPC messages (response may be SSE stream or JSON)
 *                   GET  /mcp  — open standalone SSE stream for server-initiated notifications
 *                   DELETE /mcp — close session
 *
 * Each connecting client gets its own transport + McpServer instance
 * so sessions are fully isolated.
 */
async function startHTTP(port: number): Promise<void> {
  const http = await import("node:http");
  const crypto = await import("node:crypto");
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  // Map sessionId → { server, transport } for multi-client support
  const sessions = new Map<
    string,
    {
      transport: InstanceType<typeof StreamableHTTPServerTransport>;
    }
  >();

  // Provide runtime context to dashboard (session count, port)
  setDashboardContext({ getSessionCount: () => sessions.size, port });

  const httpServer = http.createServer(async (req, res) => {
    // --- CORS (allow any origin for local-dev / CLI usage) ----------
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id, X-DreamGraph-Instance, X-DreamGraph-Dry-Run, If-Match, If-None-Match, Last-Event-ID",
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id, ETag");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // ---- /mcp — the single Streamable HTTP endpoint ----------------
    // Accept both "/mcp" and "/mcp/" so clients (e.g. VS Code Copilot Chat)
    // that append a trailing slash to the configured URL still resolve.
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Existing session? Route to its transport.
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      // POST without a known session → likely an initialize request.
      // Create a new transport + server pair.
      if (req.method === "POST") {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            logger.info(`Streamable HTTP session initialized: ${id}`);
            sessions.set(id, { transport });
          },
        });

        // Clean up on transport close
        transport.onclose = () => {
          const id = transport.sessionId;
          if (id) {
            logger.info(`Session closed: ${id}`);
            sessions.delete(id);
          }
        };

        // Create a dedicated McpServer for this session
        const server = createServer();
        await server.connect(transport);

        // Now handle the original request (the initialize message)
        await transport.handleRequest(req, res);
        return;
      }

      // GET or DELETE without a valid session
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid or missing session" }));
      return;
    }

    // ---- /health — JSON for programmatic clients, HTML for browsers --
    if (req.method === "GET" && url.pathname === "/health") {
      const accept = req.headers.accept ?? "";
      const wantsJSON =
        accept.includes("application/json") ||
        !accept.includes("text/html");
      if (wantsJSON) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            transport: "streamable-http",
            sessions: sessions.size,
          }),
        );
        return;
      }
      // Fall through to dashboard for HTML rendering
    }

    // ---- /api/* — REST API endpoints for extension / HTTP clients ----
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApiRoute(req, res, url.pathname);
      if (handled) return;
    }

    // ---- /explorer/* — DreamGraph Explorer (Phase 0: read-only API) ----
    if (url.pathname.startsWith("/explorer/")) {
      const handled = await handleExplorerRoute(req, res, url.pathname);
      if (handled) return;
    }

    // ---- Dashboard pages: /, /status, /schedules, /config, /docs, /health --
    if (req.method === "GET" || (req.method === "POST" && (url.pathname === "/config" || url.pathname === "/config/test-db" || url.pathname === "/schedules" || url.pathname === "/restart"))) {
      const handled = await handleDashboardRoute(req, res, url.pathname);
      if (handled) return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  httpServer.listen(port, () => {
    logger.info(
      `DreamGraph MCP Server running on Streamable HTTP — http://localhost:${port}/mcp`,
    );
    // Start the data dir watcher so /explorer/events emits cache.invalidated
    // when files mutate (Phase 3 / Slice 1). HTTP mode only — stdio doesn't
    // expose the SSE endpoint.
    startDataDirWatcher();
  });
}

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

const opts = parseArgs();

// Resolve instance scope before starting any transport.
// In instance mode this sets the active InstanceScope and wires
// all three resolvers (dataDir, paths, mutex).  In legacy mode
// (no DREAMGRAPH_INSTANCE_UUID env var) this is a harmless no-op.
resolveInstanceAtStartup()
  .then(async () => {
    // Hydrate cognitive engine counters from persisted dream graph
    await engine.hydrate();

    // Initialize the LLM provider for dream cycles
    const llm = initLlmProvider();
    const available = await llm.isAvailable();
    if (available) {
      logger.info(`LLM provider "${llm.name}" is online — dreams will use LLM`);
    } else {
      logger.warn(`LLM provider "${llm.name}" is NOT reachable — dreams will be structural-only (degraded)`);
    }

    // Sync instance.json counters with actual persisted values
    const cycles = engine.getCurrentDreamCycle();
    if (cycles > 0) {
      await updateInstanceCounters({ total_dream_cycles: cycles });
    }

    // Start transport
    const transportPromise = opts.transport === "http" ? startHTTP(opts.port) : startStdio();
    await transportPromise;
  })
  .catch((err) => {
    logger.error("Fatal error:", err);
    process.exit(1);
  });
