/**
 * DreamGraph MCP Server - DB Senses tool.
 *
 * Gives the AI agent READ-ONLY access to the live PostgreSQL database
 * schema via information_schema and pg_catalog queries.
 *
 * This resolves the agent's blind-spot: "I trust schema.sql and
 * migration files, but I don't know which migrations are actually
 * applied in production."
 *
 * Safety:
 *   - NO raw SQL execution. Only curated, pre-written queries.
 *   - Only reads from information_schema / pg_catalog (metadata).
 *   - Connection uses pg.Pool with max 3 connections.
 *   - Connection acquisition timeout: 5 seconds.
 *   - Statement timeout: 5 seconds.
 *   - Overall operation timeout: 10 seconds.
 *   - Idle connections recycled after 30 seconds.
 *   - Automatic pool recovery on persistent failures.
 *   - Table name is parameterized ($1) to prevent injection.
 *
 * READ-ONLY: This tool only reads database metadata.
 * It does NOT modify any data, tables, or schema.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "../config/config.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { ToolResponse } from "../types/index.js";

// Lazy-import pg so the server doesn't crash if the pg module is
// broken or missing (it's only needed when DATABASE_URL is set).
let Pool: typeof import("pg").default.Pool;

// ---------------------------------------------------------------------------
// Connection pool (lazy singleton)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any = null;

/** Track consecutive failures for automatic pool recovery. */
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

async function createPool(): Promise<import("pg").default.Pool> {
  if (!config.database.connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Set it to your PostgreSQL connection string " +
        "(e.g. postgresql://user:password@host:5432/dbname)."
    );
  }

  // Lazy-load pg on first use
  if (!Pool) {
    const pg = await import("pg");
    Pool = pg.default.Pool;
  }

  const newPool = new Pool({
    connectionString: config.database.connectionString,
    max: config.database.maxConnections,
    statement_timeout: config.database.statementTimeoutMs,
    // Prevent blocking forever when all connections are in use
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    // Recycle idle connections to avoid stale TCP sockets
    idleTimeoutMillis: config.database.idleTimeoutMs,
    // SSL — set to false or configure per your hosting provider
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  // Log pool errors (don't crash)
  newPool.on("error", (err) => {
    logger.error("DB pool background error: " + err.message);
  });

  logger.info(
    "DB connection pool initialized (max " +
      config.database.maxConnections +
      ", conn timeout " +
      config.database.connectionTimeoutMs +
      "ms, idle timeout " +
      config.database.idleTimeoutMs +
      "ms)"
  );

  return newPool;
}

async function getPool(): Promise<InstanceType<typeof Pool>> {
  if (!pool) {
    pool = await createPool();
  }
  return pool;
}

/**
 * Test a PostgreSQL connection string by connecting and running SELECT 1.
 * If connectionString is omitted, uses the current config.database value.
 * Returns { ok, message, latencyMs } — never throws.
 */
export async function testDbConnection(
  connectionString?: string,
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const connStr = connectionString ?? config.database.connectionString;
  if (!connStr) {
    return { ok: false, message: "No connection string configured.", latencyMs: 0 };
  }

  // Lazy-load pg on first use
  if (!Pool) {
    try {
      const pg = await import("pg");
      Pool = pg.default.Pool;
    } catch {
      return { ok: false, message: "pg module is not installed.", latencyMs: 0 };
    }
  }

  const t0 = Date.now();
  const testPool = new Pool({
    connectionString: connStr,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  try {
    const client = await testPool.connect();
    try {
      const { rows } = await client.query("SELECT 1 AS ok");
      const latencyMs = Date.now() - t0;
      if (rows?.[0]?.ok === 1) {
        return { ok: true, message: "Connection successful.", latencyMs };
      }
      return { ok: true, message: "Connected (unexpected result).", latencyMs };
    } finally {
      client.release();
    }
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: msg, latencyMs };
  } finally {
    try { await testPool.end(); } catch { /* ignore */ }
  }
}

/**
 * Reset the active DB pool so subsequent queries use the updated config.
 * Call this after changing config.database.connectionString at runtime.
 */
export async function resetDbPool(): Promise<void> {
  if (pool) {
    try { await pool.end(); } catch { /* ignore */ }
    pool = null;
  }
  consecutiveFailures = 0;
}

/**
 * Drain and destroy the current pool, then create a fresh one.
 * Used to recover from persistent failures (dead connections, etc.).
 */
async function resetPool(): Promise<void> {
  if (pool) {
    logger.warn("Resetting DB pool after " + consecutiveFailures + " consecutive failures");
    try {
      await pool.end();
    } catch (err) {
      logger.error("Error ending old pool: " + (err instanceof Error ? err.message : String(err)));
    }
    pool = null;
  }
  consecutiveFailures = 0;
}

/**
 * Execute a curated query with an overall operation timeout.
 * This prevents the tool from blocking indefinitely even if both
 * connection acquisition AND query execution together exceed the budget.
 */
async function queryWithTimeout(
  dbPool: InstanceType<typeof Pool>,
  sql: string,
  params: string[]
): Promise<{ rows: Record<string, unknown>[] }> {
  const timeoutMs = config.database.operationTimeoutMs;

  return new Promise<{ rows: Record<string, unknown>[] }>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          "Operation timed out after " + timeoutMs + "ms " +
          "(includes connection acquisition + query execution). " +
          "The database may be unreachable or overloaded."
        )
      );
    }, timeoutMs);

    dbPool
      .query(sql, params)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Curated queries - the ONLY queries that can be executed
// ---------------------------------------------------------------------------

type QueryType =
  | "columns"
  | "constraints"
  | "indexes"
  | "check_constraints"
  | "foreign_keys"
  | "rls_policies";

interface CuratedQuery {
  sql: string;
  description: string;
}

const CURATED_QUERIES: Record<QueryType, CuratedQuery> = {
  columns: {
    description: "List all columns with types, nullability, and defaults",
    sql: `
      SELECT
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        character_maximum_length,
        ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position
    `,
  },

  constraints: {
    description: "List all constraints (PK, FK, UNIQUE, CHECK)",
    sql: `
      SELECT
        constraint_name,
        constraint_type
      FROM information_schema.table_constraints
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY constraint_type, constraint_name
    `,
  },

  indexes: {
    description: "List all indexes with their definitions",
    sql: `
      SELECT
        indexname,
        indexdef
      FROM pg_catalog.pg_indexes
      WHERE schemaname = $1
        AND tablename = $2
      ORDER BY indexname
    `,
  },

  check_constraints: {
    description: "List CHECK constraints with their clauses",
    sql: `
      SELECT
        tc.constraint_name,
        cc.check_clause
      FROM information_schema.table_constraints tc
      JOIN information_schema.check_constraints cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'CHECK'
      ORDER BY tc.constraint_name
    `,
  },

  foreign_keys: {
    description: "List foreign key relationships with target table/column",
    sql: `
      SELECT
        tc.constraint_name,
        kcu.column_name,
        ccu.table_schema AS foreign_schema,
        ccu.table_name AS foreign_table,
        ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
        AND tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.constraint_name
    `,
  },

  rls_policies: {
    description: "List Row Level Security policies",
    sql: `
      SELECT
        pol.policyname,
        pol.cmd,
        pol.permissive,
        pol.roles,
        pg_get_expr(pol.qual, pol.polrelid) AS using_expression,
        pg_get_expr(pol.with_check, pol.polrelid) AS with_check_expression
      FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class cls ON cls.oid = pol.polrelid
      JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
      WHERE nsp.nspname = $1
        AND cls.relname = $2
      ORDER BY pol.policyname
    `,
  },
};

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface SchemaQueryResult {
  table: string;
  schema: string;
  query_type: QueryType;
  description: string;
  row_count: number;
  rows: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDbSensesTools(server: McpServer): void {
  server.tool(
    "query_db_schema",
    "Query the live PostgreSQL database schema (read-only). " +
      "Returns table structure, constraints, indexes, CHECK clauses, " +
      "foreign keys, or RLS policies for a given table. " +
      "Use this to verify what is ACTUALLY in production vs. what " +
      "migration files say SHOULD be there.",
    {
      query_type: z
        .enum([
          "columns",
          "constraints",
          "indexes",
          "check_constraints",
          "foreign_keys",
          "rls_policies",
        ])
        .describe(
          "Type of schema information to retrieve. " +
            "'columns' = column names/types/defaults, " +
            "'constraints' = PK/FK/UNIQUE/CHECK names, " +
            "'indexes' = index definitions, " +
            "'check_constraints' = CHECK constraint clauses, " +
            "'foreign_keys' = FK relationships with target table/column, " +
            "'rls_policies' = Row Level Security policies."
        ),
      table_name: z
        .string()
        .min(1)
        .max(128)
        .describe(
          "Name of the table to inspect (e.g. 'accounting_exports', 'work_entries')."
        ),
      schema: z
        .string()
        .min(1)
        .max(128)
        .optional()
        .describe(
          "Database schema (default: 'public')."
        ),
    },
    async ({ query_type, table_name, schema: schemaName }) => {
      const dbSchema = schemaName ?? "public";

      logger.info(
        "query_db_schema called: type=" + query_type +
        ", table=" + dbSchema + "." + table_name
      );

      const result = await safeExecute<SchemaQueryResult>(
        async (): Promise<ToolResponse<SchemaQueryResult>> => {
          // Validate table name (prevent any injection via identifier)
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table_name)) {
            return error(
              "INVALID_TABLE",
              "Table name contains invalid characters. " +
                "Only letters, digits, and underscores allowed."
            );
          }

          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbSchema)) {
            return error(
              "INVALID_SCHEMA",
              "Schema name contains invalid characters. " +
                "Only letters, digits, and underscores allowed."
            );
          }

          const curated = CURATED_QUERIES[query_type];
          if (!curated) {
            return error(
              "INVALID_QUERY_TYPE",
              "Unknown query_type: " + query_type
            );
          }

          let dbPool: InstanceType<typeof Pool>;
          try {
            dbPool = await getPool();
          } catch (err) {
            return error(
              "NO_CONNECTION",
              err instanceof Error ? err.message : String(err)
            );
          }

          try {
            const { rows } = await queryWithTimeout(
              dbPool,
              curated.sql,
              [dbSchema, table_name]
            );

            // Success — reset failure counter
            consecutiveFailures = 0;

            logger.debug(
              "query_db_schema: " + query_type +
              " on " + dbSchema + "." + table_name +
              " returned " + rows.length + " rows"
            );

            return success<SchemaQueryResult>({
              table: table_name,
              schema: dbSchema,
              query_type,
              description: curated.description,
              row_count: rows.length,
              rows: rows as Record<string, unknown>[],
            });
          } catch (err) {
            consecutiveFailures++;
            const msg = err instanceof Error ? err.message : String(err);

            logger.warn(
              "query_db_schema failed (" + consecutiveFailures + "/" +
              MAX_CONSECUTIVE_FAILURES + "): " + msg
            );

            // Auto-recover: if we've hit too many failures in a row,
            // the pool is likely in a bad state — reset it.
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              await resetPool();
            }

            if (msg.includes("Operation timed out")) {
              return error(
                "OPERATION_TIMEOUT",
                "The entire operation (connect + query) timed out after " +
                  (config.database.operationTimeoutMs / 1000) +
                  " seconds. The database may be unreachable or overloaded."
              );
            }

            if (msg.includes("timeout") && msg.includes("connection")) {
              return error(
                "POOL_EXHAUSTED",
                "Could not acquire a database connection within " +
                  (config.database.connectionTimeoutMs / 1000) +
                  " seconds. All pool connections may be in use or the " +
                  "database is unreachable."
              );
            }

            if (msg.includes("timeout")) {
              return error(
                "QUERY_TIMEOUT",
                "Query timed out after " +
                  (config.database.statementTimeoutMs / 1000) +
                  " seconds."
              );
            }

            if (msg.includes("connect")) {
              return error(
                "CONNECTION_ERROR",
                "Could not connect to database. Check DATABASE_URL. Error: " + msg
              );
            }

            return error("QUERY_ERROR", "Query failed: " + msg);
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

  logger.info("Registered 1 db-senses tool (query_db_schema)");
}
