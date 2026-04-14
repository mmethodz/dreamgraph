/**
 * DreamGraph MCP Server — In-memory cache layer.
 *
 * Mtime-aware Map-based cache: on each read we check the file's last-
 * modified time and only re-parse when the file has actually changed.
 * A short MIN_CHECK_MS interval prevents excessive stat() calls during
 * rapid bursts within a single operation, while guaranteeing fresh data
 * between dream cycles (even back-to-back ones).
 *
 * v7.0 El Alarife: The cache resolves data files through a pluggable
 * `resolveDataPath` function so it works in both legacy (flat data/)
 * and UUID-scoped instance modes.
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config/config.js";
import { logger } from "./logger.js";

/** Minimum milliseconds between mtime checks for the same file. */
const MIN_CHECK_MS = 5_000;

/**
 * Pluggable data directory resolver.
 * In legacy mode this returns config.dataDir.
 * In instance mode, lifecycle.ts overrides it at startup.
 */
let dataDirResolver: () => string = () => config.dataDir;

/**
 * Set the data directory resolver.
 * Called once at startup by the instance lifecycle module.
 */
export function setDataDirResolver(resolver: () => string): void {
  dataDirResolver = resolver;
}

interface CacheEntry<T = unknown> {
  data: T;
  mtimeMs: number;      // file mtime when data was read
  checkedAt: number;     // Date.now() of last stat() check
}

const cache = new Map<string, CacheEntry>();

/**
 * Load a JSON file from the data directory.
 * Results are cached in memory and automatically refreshed when the
 * underlying file changes (detected via mtime).
 */
export async function loadJsonData<T = unknown>(filename: string): Promise<T> {
  const filePath = resolve(dataDirResolver(), filename);
  const now = Date.now();
  const entry = cache.get(filename) as CacheEntry<T> | undefined;

  // If we have a cached entry and checked recently, skip the stat
  if (entry && now - entry.checkedAt < MIN_CHECK_MS) {
    logger.debug(`Cache hit (within check interval): ${filename}`);
    return entry.data;
  }

  // Check file mtime
  try {
    const fileStat = await stat(filePath);
    const mtimeMs = fileStat.mtimeMs;

    // If cached and mtime hasn't changed, just update checkedAt
    if (entry && entry.mtimeMs === mtimeMs) {
      entry.checkedAt = now;
      logger.debug(`Cache hit (mtime unchanged): ${filename}`);
      return entry.data;
    }

    // File is new or modified — read and parse
    logger.debug(`Loading from disk (${entry ? "mtime changed" : "first load"}): ${filePath}`);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as T;
    cache.set(filename, { data, mtimeMs, checkedAt: now });
    return data;
  } catch (err) {
    // If file doesn't exist and we have stale data, clear it
    if (entry) {
      cache.delete(filename);
    }
    throw err;
  }
}

/**
 * Invalidate a specific cache entry or the entire cache.
 */
export function invalidateCache(filename?: string): void {
  if (filename) {
    cache.delete(filename);
  } else {
    cache.clear();
  }
}

/**
 * Load a JSON file that is expected to be a flat array.
 *
 * Defensively coerces: if an agent wrote the file as a wrapper object
 * (e.g. `{ "entities": [...] }` instead of `[...]`), we extract the
 * first array-valued property. Returns an empty array on any failure.
 *
 * Use this for seed files: features.json, workflows.json, data_model.json.
 */
export async function loadJsonArray<T>(filename: string): Promise<T[]> {
  try {
    const raw = await loadJsonData<unknown>(filename);
    if (Array.isArray(raw)) return raw as T[];

    // Object wrapper — find the first array-valued property
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const val of Object.values(raw as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          logger.warn(
            `${filename}: expected flat array, found wrapper object. Auto-extracting array property.`
          );
          return val as T[];
        }
      }
    }

    logger.warn(`${filename}: expected array, got ${typeof raw}. Returning [].`);
    return [];
  } catch {
    return [];
  }
}
