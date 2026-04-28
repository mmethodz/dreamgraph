/**
 * Data directory file watcher — synthetic producer for `cache.invalidated`.
 *
 * Phase 3 / Slice 1: When any file in the active data directory changes
 * (dream cycle, ADR write, schedule fired, manual edit), we emit a
 * `cache.invalidated` event on the GraphEventBus. Subscribers (the
 * GraphIndex cache) drop their state, and the next snapshot fetch will
 * detect the etag drift and emit `snapshot.changed` for SSE clients.
 *
 * Why fs.watch and not chokidar?
 *   - Zero new dependencies.
 *   - We only need a "something moved" signal — file granularity is fine.
 *   - Debounce coalesces bursts (a dream cycle writes ~6 files in <50ms).
 *
 * Caveats:
 *   - On Windows, `recursive: true` is supported natively; on Linux it's
 *     simulated. The data dir is shallow (~20 files), so recursive isn't
 *     strictly required, but we keep it for parity.
 *   - The watcher is best-effort: if it fails to start, the daemon
 *     continues without live invalidation. SSE clients can still resync
 *     by fetching the snapshot manually.
 */

import { watch, type FSWatcher } from "node:fs";
import { graphEventBus } from "./events.js";
import { getEffectiveDataDir } from "../instance/index.js";
import { logger } from "../utils/logger.js";

const DEBOUNCE_MS = 250;
const IGNORED_WATCH_FILES = new Set(["schedules.json"]);

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let pendingFiles = new Set<string>();

function flush(): void {
  debounceTimer = null;
  if (pendingFiles.size === 0) return;
  const files = [...pendingFiles];
  pendingFiles = new Set();
  graphEventBus.emit("cache.invalidated", {
    payload: { files },
  });
}

/**
 * Start watching the active data directory for changes.
 * Idempotent: a second call replaces the existing watcher.
 */
export function startDataDirWatcher(): void {
  stopDataDirWatcher();
  const dir = getEffectiveDataDir();
  try {
    watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const name =
        typeof filename === "string"
          ? filename
          : (filename as Buffer).toString("utf-8");
      const normalizedName = name.replace(/\\/g, "/");
      const baseName = normalizedName.split("/").pop() ?? normalizedName;
      // Ignore lock files, editor swap files, and schedule heartbeat writes —
      // they don't represent a semantic change to the graph for Explorer SSE.
      if (
        baseName.endsWith(".lock") ||
        baseName.endsWith(".swp") ||
        baseName.endsWith(".tmp") ||
        baseName.startsWith(".") ||
        IGNORED_WATCH_FILES.has(baseName)
      ) {
        return;
      }
      pendingFiles.add(normalizedName);
      if (debounceTimer === null) {
        debounceTimer = setTimeout(flush, DEBOUNCE_MS);
        if (typeof debounceTimer.unref === "function") debounceTimer.unref();
      }
    });
    watcher.on("error", (err) => {
      logger.warn(`Data dir watcher error: ${err.message}`);
    });
    logger.info(`Data dir watcher active on ${dir}`);
  } catch (err) {
    logger.warn(
      `Failed to start data dir watcher on ${dir}: ${(err as Error).message}`,
    );
    watcher = null;
  }
}

/** Stop the watcher (used on shutdown / test teardown). */
export function stopDataDirWatcher(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingFiles.clear();
  if (watcher) {
    try {
      watcher.close();
    } catch {
      // Best-effort.
    }
    watcher = null;
  }
}
