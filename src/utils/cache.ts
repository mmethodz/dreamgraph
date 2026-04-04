/**
 * DreamGraph MCP Server — In-memory cache layer.
 *
 * Mtime-aware Map-based cache: on each read we check the file's last-
 * modified time and only re-parse when the file has actually changed.
 * A short MIN_CHECK_MS interval prevents excessive stat() calls during
 * rapid bursts within a single operation, while guaranteeing fresh data
 * between dream cycles (even back-to-back ones).
 */

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config/config.js";
import { logger } from "./logger.js";

/** Minimum milliseconds between mtime checks for the same file. */
const MIN_CHECK_MS = 5_000;

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
  const filePath = resolve(config.dataDir, filename);
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
