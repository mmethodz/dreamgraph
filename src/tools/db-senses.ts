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
import { atomicWriteFile } from "../utils/atomic-write.js";
import { invalidateCache, loadJsonArray } from "../utils/cache.js";
import { dataPath } from "../utils/paths.js";
import type { Datastore, DatastoreTable, DataModelEntity, ToolResponse } from "../types/index.js";

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

  registerScanDatabaseTool(server);

  logger.info("Registered 2 db-senses tools (query_db_schema, scan_database)");
}

// ---------------------------------------------------------------------------
// scan_database — populate datastore.tables[] from live schema
// (per plans/DATASTORE_AS_HUB.md, Slice 2)
// ---------------------------------------------------------------------------

const LIST_TABLES_SQL = `
  SELECT table_schema, table_name
  FROM information_schema.tables
  WHERE table_schema = ANY($1::text[])
    AND table_type = 'BASE TABLE'
  ORDER BY table_schema, table_name
`;

const COLUMN_COUNT_SQL = `
  SELECT table_schema, table_name, COUNT(*)::int AS col_count
  FROM information_schema.columns
  WHERE table_schema = ANY($1::text[])
  GROUP BY table_schema, table_name
`;

const FK_COUNT_SQL = `
  SELECT tc.table_schema, tc.table_name, COUNT(*)::int AS fk_count
  FROM information_schema.table_constraints tc
  WHERE tc.table_schema = ANY($1::text[])
    AND tc.constraint_type = 'FOREIGN KEY'
  GROUP BY tc.table_schema, tc.table_name
`;

class PgScanner implements DatastoreScanner {
  async scan(targetSchemas: string[], scanTimeoutMs: number): Promise<ScannerScanOutput> {
    const dbPool = await getPool();

    const queryDeadline = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`scan_database timed out after ${scanTimeoutMs}ms`)),
        scanTimeoutMs,
      ),
    );

    const [tRes, cRes, fRes] = (await Promise.race([
      Promise.all([
        dbPool.query(LIST_TABLES_SQL, [targetSchemas]),
        dbPool.query(COLUMN_COUNT_SQL, [targetSchemas]),
        dbPool.query(FK_COUNT_SQL, [targetSchemas]),
      ]),
      queryDeadline,
    ])) as [
      { rows: ScannedTableRow[] },
      { rows: ScannedColumnCountRow[] },
      { rows: ScannedFkCountRow[] },
    ];

    return {
      tables: tRes.rows,
      colCounts: cRes.rows,
      fkCounts: fRes.rows,
    };
  }
}

/** Tables/prefixes to skip — migration bookkeeping & framework noise. */
const TABLE_DENYLIST_PREFIX = ["pg_", "knex_"];
const TABLE_DENYLIST_EXACT = new Set([
  "_prisma_migrations",
  "schema_migrations",
  "ar_internal_metadata",
  "spatial_ref_sys",
]);

function isDenylisted(name: string, columns: number, fks: number): boolean {
  const lower = name.toLowerCase();
  if (TABLE_DENYLIST_EXACT.has(lower)) return true;
  if (TABLE_DENYLIST_PREFIX.some((p) => lower.startsWith(p))) return true;
  // Junction table heuristic: no FKs and < 3 columns is almost always noise.
  if (fks === 0 && columns > 0 && columns < 3) return true;
  return false;
}

interface ScanResult {
  datastore_id: string;
  tables_found: number;
  tables_kept: number;
  tables_skipped: number;
  skipped_reasons: Record<string, number>;
  /** Number of data_model entities created when create_missing=true. */
  data_models_created: number;
  last_scanned_at: string;
}

interface ScannedTableRow {
  table_schema: string;
  table_name: string;
}

interface ScannedColumnCountRow {
  table_schema: string;
  table_name: string;
  col_count: number;
}

interface ScannedFkCountRow {
  table_schema: string;
  table_name: string;
  fk_count: number;
}

interface ScannerScanOutput {
  tables: ScannedTableRow[];
  colCounts: ScannedColumnCountRow[];
  fkCounts: ScannedFkCountRow[];
}

interface DatastoreScanner {
  scan(targetSchemas: string[], scanTimeoutMs: number): Promise<ScannerScanOutput>;
  close?(): Promise<void> | void;
}

/**
 * Run a schema scan against the configured datastore and persist the result.
 * Shared between the `scan_database` MCP tool and the dashboard "Sync schema"
 * button. Returns a ToolResponse so callers can render the same error codes.
 */
export async function runDatastoreScan(opts: {
  datastoreId?: string;
  schemas?: string[];
  createMissing?: boolean;
}): Promise<ToolResponse<ScanResult>> {
  const targetSchemas = opts.schemas?.length ? opts.schemas : ["public"];
  const scanTimeoutMs = config.database.scanTimeoutMs;
  const t0 = Date.now();

  for (const s of targetSchemas) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
      return error("INVALID_SCHEMA", `Schema name '${s}' contains invalid characters.`);
    }
  }

  let datastores: Datastore[];
  try {
    datastores = await loadJsonArray<Datastore>("datastores.json");
  } catch {
    datastores = [];
  }
  const real = datastores.filter(
    (d) =>
      (d as unknown as Record<string, unknown>)._schema === undefined &&
      (d as unknown as Record<string, unknown>)._note === undefined,
  );
  if (real.length === 0) {
    return error(
      "NO_DATASTORE",
      "datastores.json is empty. Set DATABASE_URL and restart so the instance can auto-seed datastore:primary.",
    );
  }
  const target = opts.datastoreId
    ? real.find((d) => d.id === opts.datastoreId)
    : real[0];
  if (!target) {
    return error(
      "DATASTORE_NOT_FOUND",
      `No datastore with id='${opts.datastoreId}' in datastores.json.`,
    );
  }

  let scanner: DatastoreScanner;
  try {
    if (target.kind === "postgres") {
      scanner = new PgScanner();
    } else {
      return error(
        "SCAN_FAILED",
        `Datastore kind "${target.kind}" is not yet supported by scan_database.`,
      );
    }
  } catch (err) {
    return error("NO_CONNECTION", err instanceof Error ? err.message : String(err));
  }

  let tables: ScannedTableRow[];
  let colCounts: ScannedColumnCountRow[];
  let fkCounts: ScannedFkCountRow[];
  try {
    ({ tables, colCounts, fkCounts } = await scanner.scan(targetSchemas, scanTimeoutMs));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error("SCAN_FAILED", `Schema scan failed: ${msg}`);
  } finally {
    await scanner.close?.();
  }

  const colMap = new Map<string, number>();
  for (const r of colCounts) colMap.set(`${r.table_schema}.${r.table_name}`, r.col_count);
  const fkMap = new Map<string, number>();
  for (const r of fkCounts) fkMap.set(`${r.table_schema}.${r.table_name}`, r.fk_count);

  const skipReasons: Record<string, number> = {};
  const kept: DatastoreTable[] = [];
  for (const t of tables) {
    const key = `${t.table_schema}.${t.table_name}`;
    const cols = colMap.get(key) ?? 0;
    const fks = fkMap.get(key) ?? 0;
    const lower = t.table_name.toLowerCase();
    if (TABLE_DENYLIST_EXACT.has(lower)) {
      skipReasons.exact = (skipReasons.exact ?? 0) + 1;
      continue;
    }
    if (TABLE_DENYLIST_PREFIX.some((p) => lower.startsWith(p))) {
      skipReasons.prefix = (skipReasons.prefix ?? 0) + 1;
      continue;
    }
    if (isDenylisted(t.table_name, cols, fks)) {
      skipReasons.junction = (skipReasons.junction ?? 0) + 1;
      continue;
    }
    kept.push({ schema: t.table_schema, name: t.table_name, columns: cols, fk_count: fks });
  }

  const lastScannedAt = new Date().toISOString();
  const updated: Datastore = { ...target, tables: kept, last_scanned_at: lastScannedAt };
  const next = datastores.map((d) => (d.id === target.id ? updated : d));
  try {
    await atomicWriteFile(dataPath("datastores.json"), JSON.stringify(next, null, 2));
    invalidateCache("datastores.json");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error("WRITE_FAILED", `Failed to write datastores.json: ${msg}`);
  }

  consecutiveFailures = 0;

  // ---------------------------------------------------------------------
  // Optional: materialize stub data_model entries for kept tables that
  // have no representation yet. Uses lenient name matching to avoid
  // duplicating entities the user already authored.
  // ---------------------------------------------------------------------
  let dataModelsCreated = 0;
  if (opts.createMissing && kept.length > 0) {
    try {
      const existing = await loadJsonArray<DataModelEntity>("data_model.json");
      const norm = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const claimed = new Set<string>();
      for (const dm of existing) {
        const leaf = (dm.id?.split(/[:.]/).pop() ?? dm.id ?? "");
        if (leaf) claimed.add(norm(leaf));
        if (dm.name) claimed.add(norm(dm.name));
        if (dm.table_name) claimed.add(norm(dm.table_name));
      }
      const additions: DataModelEntity[] = [];
      const nowIso = lastScannedAt;
      for (const t of kept) {
        if (claimed.has(norm(t.name))) continue;
        const id = `data_model:db.${t.schema}.${t.name}`;
        if (existing.some((e) => e.id === id)) continue;
        additions.push({
          id,
          type: "data_model",
          uri: `dreamgraph://resource/data_model/${id}`,
          name: t.name,
          description: `Auto-created from datastore introspection (${target.id}).`,
          source_repo: target.repos?.[0] ?? "",
          source_files: [],
          tags: ["introspected"],
          created_at: nowIso,
          updated_at: nowIso,
          table_name: t.name,
          storage: target.kind,
          key_fields: [],
          relationships: [],
          domain: t.schema,
          keywords: [t.name, t.schema, target.kind],
          status: "introspected",
          links: [
            {
              target: target.id,
              type: "datastore",
              relationship: "stored_in",
              description: `Stored in ${target.name ?? target.id}.`,
              strength: "strong",
            },
          ],
        } as DataModelEntity);
        claimed.add(norm(t.name));
      }
      if (additions.length > 0) {
        const merged = [...existing, ...additions];
        await atomicWriteFile(
          dataPath("data_model.json"),
          JSON.stringify(merged, null, 2),
        );
        invalidateCache("data_model.json");
        dataModelsCreated = additions.length;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `scan_database: create_missing failed (kept ${kept.length} tables): ${msg}`,
      );
    }
  }

  const totalSkipped = Object.values(skipReasons).reduce((a, b) => a + b, 0);
  logger.info(
    `scan_database: ${target.id} found=${tables.length} kept=${kept.length} ` +
      `skipped=${totalSkipped} created=${dataModelsCreated} elapsed=${Date.now() - t0}ms`,
  );

  return success<ScanResult>({
    datastore_id: target.id,
    tables_found: tables.length,
    tables_kept: kept.length,
    tables_skipped: totalSkipped,
    skipped_reasons: skipReasons,
    data_models_created: dataModelsCreated,
    last_scanned_at: lastScannedAt,
  });
}

function registerScanDatabaseTool(server: McpServer): void {
  server.tool(
    "scan_database",
    "Scan the configured datastore for tables and populate the " +
      "target datastore record (datastores.json) with table metadata. " +
      "Supports backend-specific read-only introspection.",
    {
      datastore_id: z
        .string()
        .min(1)
        .max(128)
        .optional()
        .describe(
          "Target datastore id (default: first entry in datastores.json).",
        ),
      schemas: z
        .array(z.string().min(1).max(128))
        .optional()
        .describe("Schemas to scan (default: ['public'])."),
      create_missing: z
        .boolean()
        .optional()
        .describe(
          "When true, auto-create stub data_model entities for kept tables that have no representation. Defaults to false to avoid junction-table noise.",
        ),
    },
    async ({ datastore_id, schemas, create_missing }) => {
      logger.info(
        `scan_database called: datastore_id=${datastore_id ?? "<first>"}, ` +
          `schemas=[${(schemas ?? ["public"]).join(", ")}], create_missing=${create_missing === true}`,
      );
      const result = await safeExecute<ScanResult>(() =>
        runDatastoreScan({
          datastoreId: datastore_id,
          schemas,
          createMissing: create_missing,
        }),
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
