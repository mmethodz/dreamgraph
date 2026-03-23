/**
 * DreamGraph MCP Server — In-memory cache layer.
 *
 * Simple Map-based cache that stores loaded JSON resources to avoid
 * re-reading files from disk on every request. Cache is populated
 * lazily on first access and persists for the lifetime of the process.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger.js";

const cache = new Map<string, unknown>();

/** Resolve path relative to project root (two levels up from src/utils/) */
const projectRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/**
 * Load a JSON file from the data directory.
 * Results are cached in memory after first read.
 */
export async function loadJsonData<T = unknown>(filename: string): Promise<T> {
  if (cache.has(filename)) {
    logger.debug(`Cache hit: ${filename}`);
    return cache.get(filename) as T;
  }

  const filePath = resolve(projectRoot, "data", filename);
  logger.debug(`Loading from disk: ${filePath}`);

  const raw = await readFile(filePath, "utf-8");
  const data = JSON.parse(raw) as T;
  cache.set(filename, data);
  return data;
}

/**
 * Invalidate a specific cache entry (useful for future hot-reload).
 */
export function invalidateCache(filename?: string): void {
  if (filename) {
    cache.delete(filename);
  } else {
    cache.clear();
  }
}
