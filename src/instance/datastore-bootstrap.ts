/**
 * DreamGraph — Datastore bootstrap (per plans/DATASTORE_AS_HUB.md, Slice 1).
 *
 * Auto-seeds `data/datastores.json` with a `datastore:primary` record when:
 *   1. `DATABASE_URL` is set in the per-instance `engine.env`, AND
 *   2. The current `datastores.json` is missing, empty, or contains only
 *      template-stub entries (i.e. no real datastore has been declared yet).
 *
 * This is purely additive: instances with no DB configuration are left
 * completely untouched, so the feature stays inert when unused
 * (per Decision #7 in the plan).
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { atomicWriteFile } from "../utils/atomic-write.js";
import { dataPath } from "../utils/paths.js";
import { invalidateCache } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import type { Datastore } from "../types/index.js";

const FILENAME = "datastores.json";

/**
 * Strip the password component from a connection URL for safe display.
 * Returns "" if the input is falsy.
 */
function sanitizeConnectionString(url: string): string {
  if (!url) return "";
  return url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
}

/**
 * Returns true if the file is missing OR contains only template-stub
 * entries (the `_schema`/`_note` markers used by templates/default).
 */
async function isUnconfigured(): Promise<boolean> {
  const path = dataPath(FILENAME);
  if (!existsSync(path)) return true;
  try {
    const raw = await readFile(path, "utf-8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return true;
    if (arr.length === 0) return true;
    return arr.every(
      (entry: Record<string, unknown>) =>
        entry._schema !== undefined || entry._note !== undefined,
    );
  } catch {
    return true;
  }
}

/**
 * Auto-seed `datastore:primary` if appropriate. No-op when:
 *   - `DATABASE_URL` is not set (feature stays inert).
 *   - A real datastore record already exists (do not clobber user edits).
 *
 * `repos` is the merged repo registry from {@link resolveInstanceAtStartup}.
 * The seeded record claims membership of all currently registered repos,
 * matching the typical SaaS case where every repo shares the same DB.
 */
export async function autoSeedPrimaryDatastore(
  repos: Record<string, string>,
): Promise<void> {
  const path = dataPath(FILENAME);
  const url = process.env.DATABASE_URL;

  if (!existsSync(path)) {
    try {
      await atomicWriteFile(path, JSON.stringify([], null, 2));
      invalidateCache(FILENAME);
      logger.debug("Initialized datastores.json with [] during instance startup");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to initialize datastores.json: ${msg}`);
      return;
    }
  }

  if (!url || url.trim().length === 0) return;

  if (!(await isUnconfigured())) return;

  const record: Datastore = {
    id: "datastore:primary",
    name: "Primary Datastore",
    description:
      "Auto-seeded from DATABASE_URL. Run `scan_database` (Slice 2) to populate the table list.",
    source_repo: "",
    source_files: [],
    kind: "postgres",
    url_hint: sanitizeConnectionString(url),
    repos: Object.keys(repos),
    tables: [],
    tags: ["primary", "auto-seeded"],
    status: "active",
  };

  try {
    await atomicWriteFile(
      path,
      JSON.stringify([record], null, 2),
    );
    invalidateCache(FILENAME);
    logger.info(
      `Auto-seeded datastore:primary (kind=postgres, repos=[${record.repos?.join(", ")}])`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to auto-seed datastores.json: ${msg}`);
  }
}
