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
import os from "node:os";
import path from "node:path";

import { atomicWriteFile } from "../utils/atomic-write.js";
import { dataPath } from "../utils/paths.js";
import { invalidateCache } from "../utils/cache.js";
import { logger } from "../utils/logger.js";
import type { Datastore } from "../types/index.js";

const FILENAME = "datastores.json";

export interface ClassifiedDatastoreSource {
  kind: Datastore["kind"];
  urlHint: string;
  filename?: string;
}

/**
 * Strip the password component from a connection URL for safe display.
 * Returns "" if the input is falsy.
 */
function sanitizeConnectionString(url: string): string {
  if (!url) return "";
  return url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
}

function collapseHomeDir(filePath: string): string {
  const home = os.homedir();
  if (!home) return filePath;
  if (filePath === home) return "~";
  if (filePath.startsWith(`${home}${path.sep}`)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}

export function classifyDatastoreSource(rawUrl: string): ClassifiedDatastoreSource | null {
  const value = rawUrl.trim();
  if (!value) return null;

  if (
    value.startsWith("sqlite:") ||
    value.startsWith("file:") ||
    value.endsWith(".db") ||
    value.endsWith(".sqlite") ||
    value.endsWith(".sqlite3")
  ) {
    let filename = value;

    if (value.startsWith("sqlite:///")) {
      filename = value.slice("sqlite:///".length);
      if (process.platform === "win32" && /^([A-Za-z]:)(\/|\\)/.test(filename)) {
        filename = filename.replace(/\//g, path.sep);
      } else if (!filename.startsWith(path.sep)) {
        filename = `${path.sep}${filename}`;
      }
    } else if (value.startsWith("sqlite://")) {
      filename = value.slice("sqlite://".length);
    } else if (value.startsWith("sqlite:")) {
      filename = value.slice("sqlite:".length);
    } else if (value.startsWith("file://")) {
      filename = new URL(value).pathname;
      if (process.platform === "win32" && filename.startsWith("/")) {
        filename = filename.slice(1);
      }
      filename = filename.replace(/\//g, path.sep);
    }

    filename = decodeURIComponent(filename);

    return {
      kind: "sqlite",
      urlHint: collapseHomeDir(filename),
      filename,
    };
  }

  return {
    kind: "postgres",
    urlHint: sanitizeConnectionString(value),
  };
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

  const classified = classifyDatastoreSource(url ?? "");
  if (!classified) return;

  if (!(await isUnconfigured())) return;

  const record: Datastore = {
    id: "datastore:primary",
    name: "Primary Datastore",
    description:
      "Auto-seeded from DATABASE_URL. Run `scan_database` (Slice 2) to populate the table list.",
    source_repo: "",
    source_files: [],
    kind: classified.kind,
    url_hint: classified.urlHint,
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
      `Auto-seeded datastore:primary (kind=${record.kind}, repos=[${record.repos?.join(", ")}])`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to auto-seed datastores.json: ${msg}`);
  }
}
