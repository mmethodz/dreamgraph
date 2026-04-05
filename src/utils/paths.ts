/**
 * DreamGraph v6.0 "La Catedral" — Data path resolver.
 *
 * Provides a lazy-evaluated data directory that works in both legacy
 * (flat data/) and UUID-scoped instance modes.
 *
 * Module-scope code should use `dataPath("file.json")` instead of
 * `resolve(config.dataDir, "file.json")` — the path is resolved at
 * call time, not import time, so it picks up the correct instance
 * data directory even if set after module loading.
 */

import { resolve } from "node:path";
import { config } from "../config/config.js";

/**
 * Override set by the instance lifecycle at startup.
 * null = legacy mode (use config.dataDir).
 */
let dataDirOverride: string | null = null;

/**
 * Set the data directory override.
 * Called once at startup by resolveInstanceAtStartup().
 */
export function setDataDirOverride(dir: string): void {
  dataDirOverride = dir;
}

/**
 * Get the effective data directory.
 * Instance mode → UUID-scoped dir.
 * Legacy mode → config.dataDir.
 */
export function getDataDir(): string {
  return dataDirOverride ?? config.dataDir;
}

/**
 * Resolve a filename within the effective data directory.
 *
 * Use this instead of `resolve(config.dataDir, filename)` in any
 * code path that may run under instance mode.
 *
 * @example
 *   // Before (eager, breaks in instance mode):
 *   const META_LOG_PATH = resolve(config.dataDir, "meta_log.json");
 *
 *   // After (lazy, works in both modes):
 *   const metaLogPath = () => dataPath("meta_log.json");
 */
export function dataPath(filename: string): string {
  return resolve(getDataDir(), filename);
}
