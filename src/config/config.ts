/**
 * DreamGraph MCP Server - Configuration.
 *
 * All project-specific values are loaded from environment variables.
 * See README.md for the full list of supported env vars.
 */

function parseRepos(): Record<string, string> {
  const raw = process.env.DREAMGRAPH_REPOS ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, string>;
    }
  } catch {
    // ignore parse errors  repos will be empty
  }
  return {};
}

export const config = {
  /** Server metadata */
  server: {
    name: "dreamgraph",
    version: "1.0.0",
  },

  /**
   * Local repository paths for code-senses and git-senses tools.
   * Set via DREAMGRAPH_REPOS env var as a JSON object:
   *   {"my-app": "/home/user/repos/my-app", "api": "/home/user/repos/api"}
   */
  repos: parseRepos(),

  /**
   * Optional PostgreSQL connection for DB schema queries.
   * Set via DATABASE_URL env var (full postgres:// connection string).
   */
  database: {
    connectionString: process.env.DATABASE_URL ?? "",
    maxConnections: 3,
    statementTimeoutMs: 5_000,
    /** Max ms to wait for a free connection from the pool (0 = forever). */
    connectionTimeoutMs: 5_000,
    /** Close idle connections after this many ms to avoid stale sockets. */
    idleTimeoutMs: 30_000,
    /** Hard cap on the entire query_db_schema operation (acquire + query). */
    operationTimeoutMs: 10_000,
  },

  /** Data directory (relative to project root) */
  dataDir: process.env.DREAMGRAPH_DATA_DIR ?? "data",

  /** Environment flags */
  env: {
    /** Enable verbose stderr logging */
    debug: process.env.DREAMGRAPH_DEBUG === "true",
  },
} as const;