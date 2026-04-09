/**
 * DreamGraph MCP Server - Configuration.
 *
 * All project-specific values are loaded from environment variables.
 * See README.md for the full list of supported env vars.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EventRouterConfig, NarrativeConfig, SchedulerConfig } from "../cognitive/types.js";
import {
  DEFAULT_EVENT_ROUTER_CONFIG,
  DEFAULT_NARRATIVE_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
} from "../cognitive/types.js";
import type { LlmConfig } from "../cognitive/llm.js";
import { parseLlmConfig } from "../cognitive/llm.js";

/** Project root — two levels up from dist/config/config.js */
const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/**
 * Resolve the data directory.
 * If DREAMGRAPH_DATA_DIR is an absolute path, use it as-is.
 * If relative (or unset, defaulting to "data"), resolve against project root.
 */
function resolveDataDir(): string {
  const raw = process.env.DREAMGRAPH_DATA_DIR ?? "data";
  return resolve(PROJECT_ROOT, raw);     // resolve() treats absolute paths as absolute
}

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

function parseEventRouterConfig(): EventRouterConfig {
  const raw = process.env.DREAMGRAPH_EVENTS;
  if (!raw) return { ...DEFAULT_EVENT_ROUTER_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_EVENT_ROUTER_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_EVENT_ROUTER_CONFIG };
  }
}

function parseNarrativeConfig(): NarrativeConfig {
  const raw = process.env.DREAMGRAPH_NARRATIVE;
  if (!raw) return { ...DEFAULT_NARRATIVE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NARRATIVE_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_NARRATIVE_CONFIG };
  }
}

function parseSchedulerConfig(): SchedulerConfig {
  const raw = process.env.DREAMGRAPH_SCHEDULER;
  if (!raw) return { ...DEFAULT_SCHEDULER_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SCHEDULER_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_SCHEDULER_CONFIG };
  }
}

export const config = {
  /** Server metadata */
  server: {
    name: "dreamgraph",
    version: "6.2.0",
  },

  /**
   * Local repository paths for code-senses and git-senses tools.
   * Set via DREAMGRAPH_REPOS env var as a JSON object:
   *   {"my-app": "/home/user/repos/my-app", "api": "/home/user/repos/api"}
   *
   * In instance mode, repos from mcp.json are merged at startup.
   * If project_root is set and no repos are mapped, it is auto-registered.
   */
  repos: parseRepos() as Record<string, string>,

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

  /**
   * Resolved absolute path to the data directory.
   * In legacy mode (no UUID), this is the primary data dir.
   * In instance mode, this is overridden by getEffectiveDataDir().
   */
  dataDir: resolveDataDir(),

  /** Environment flags */
  env: {
    /** Enable verbose stderr logging */
    debug: process.env.DREAMGRAPH_DEBUG === "true",
  },

  /**
   * v6.0 La Catedral — Instance architecture configuration.
   */
  instance: {
    /** UUID of the active instance (if running in instance mode). */
    uuid: process.env.DREAMGRAPH_INSTANCE_UUID ?? null,
    /** Master directory override. Default: ~/.dreamgraph/ */
    masterDir: process.env.DREAMGRAPH_MASTER_DIR ?? null,
  },

  /** v5.1 — Event-driven dreaming configuration */
  events: parseEventRouterConfig(),

  /** v5.1 — Continuous narrative intelligence configuration */
  narrative: parseNarrativeConfig(),

  /** v5.2 — Dream scheduler configuration */
  scheduler: parseSchedulerConfig(),

  /** v6.0.1 — LLM provider configuration for dream engine */
  llm: parseLlmConfig(),
} as const;

/**
 * Update the database connection string at runtime.
 * Needs a mutable cast because the config object is frozen with `as const`.
 */
export function updateDatabaseConnectionString(connectionString: string): void {
  (config.database as { connectionString: string }).connectionString = connectionString;
}