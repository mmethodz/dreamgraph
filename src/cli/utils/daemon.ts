/**
 * DreamGraph v7.0 "El Alarife" — Daemon Utilities.
 *
 * Shared utilities for dg start / stop / restart / status commands.
 * Implements ADR-003 (server.json metadata), ADR-004 (port collision),
 * ADR-005 (binary resolution), ADR-006 (detached spawn + log rotation),
 * ADR-007 (advisory lock).
 */

import { readFile, writeFile, rename, unlink, stat, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../config/config.js";
import {
  loadRegistry,
  findInstance,
  resolveMasterDir,
} from "../../instance/index.js";
import type { RegistryEntry } from "../../instance/index.js";

/* ------------------------------------------------------------------ */
/*  ServerMeta — runtime/server.json schema (ADR-003)                 */
/* ------------------------------------------------------------------ */

export interface ServerMeta {
  pid: number;
  uuid: string;
  command: "dreamgraph";
  bin_path: string;
  transport: "http" | "stdio";
  port: number | null;
  started_at: string;
  version: string;
}

/* ------------------------------------------------------------------ */
/*  Runtime file I/O                                                  */
/* ------------------------------------------------------------------ */

function runtimeDir(instanceRoot: string): string {
  return resolve(instanceRoot, "runtime");
}

function serverMetaPath(instanceRoot: string): string {
  return resolve(runtimeDir(instanceRoot), "server.json");
}

function serverLockPath(instanceRoot: string): string {
  return resolve(runtimeDir(instanceRoot), "server.lock");
}

function logsDir(instanceRoot: string): string {
  return resolve(instanceRoot, "logs");
}

export function serverLogPath(instanceRoot: string): string {
  return resolve(logsDir(instanceRoot), "server.log");
}

/**
 * Read runtime/server.json. Returns null if missing or corrupt.
 */
export async function readServerMeta(
  instanceRoot: string,
): Promise<ServerMeta | null> {
  const p = serverMetaPath(instanceRoot);
  try {
    const raw = await readFile(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.pid === "number" &&
      typeof parsed.uuid === "string"
    ) {
      return parsed as ServerMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write runtime/server.json atomically (ADR-003 guard rail #5).
 * Writes to a temp file first, then renames.
 */
export async function writeServerMeta(
  instanceRoot: string,
  meta: ServerMeta,
): Promise<void> {
  const dir = runtimeDir(instanceRoot);
  await mkdir(dir, { recursive: true });

  const target = serverMetaPath(instanceRoot);
  const tmp = target + ".tmp";
  await writeFile(tmp, JSON.stringify(meta, null, 2), "utf-8");
  await rename(tmp, target);
}

/**
 * Clean up all runtime files (server.json + server.lock).
 * Idempotent — silently ignores missing files.
 */
export async function cleanRuntimeFiles(
  instanceRoot: string,
): Promise<void> {
  for (const p of [serverMetaPath(instanceRoot), serverLockPath(instanceRoot)]) {
    try {
      await unlink(p);
    } catch {
      // file doesn't exist — fine
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Advisory lock (ADR-007)                                           */
/* ------------------------------------------------------------------ */

const STALE_LOCK_THRESHOLD_MS = 30_000;

/**
 * Acquire an advisory lock for the start operation.
 * Returns a release function. Throws if lock already held (non-stale).
 */
export async function acquireStartLock(
  instanceRoot: string,
): Promise<() => Promise<void>> {
  const lockPath = serverLockPath(instanceRoot);
  const dir = runtimeDir(instanceRoot);
  await mkdir(dir, { recursive: true });

  const content = JSON.stringify({ cli_pid: process.pid, ts: Date.now() });

  try {
    // Exclusive create — fails if file already exists
    await writeFile(lockPath, content, { flag: "wx" });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      // Lock exists — check if stale
      try {
        const lockStat = await stat(lockPath);
        const ageMs = Date.now() - lockStat.mtimeMs;
        if (ageMs > STALE_LOCK_THRESHOLD_MS) {
          // Stale lock — CLI must have crashed
          await unlink(lockPath);
          // Retry exclusive create
          await writeFile(lockPath, content, { flag: "wx" });
        } else {
          throw new Error(
            "Another start operation is in progress. " +
            `Lock file age: ${Math.round(ageMs / 1000)}s. ` +
            "If this is a mistake, delete runtime/server.lock manually."
          );
        }
      } catch (innerErr) {
        if (innerErr instanceof Error && innerErr.message.includes("Another start")) {
          throw innerErr;
        }
        // Could not stat or delete — surface original error
        throw new Error("Another start operation is in progress.");
      }
    } else {
      throw err;
    }
  }

  // Return release function
  const release = async (): Promise<void> => {
    try {
      await unlink(lockPath);
    } catch {
      // already deleted — fine
    }
  };
  return release;
}

/* ------------------------------------------------------------------ */
/*  Process management                                                */
/* ------------------------------------------------------------------ */

/**
 * Check if a process with the given PID is alive.
 * Uses process.kill(pid, 0) which is cross-platform in Node.js.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate that a server.json entry belongs to the expected instance (ADR-003).
 * Checks uuid match AND command === "dreamgraph".
 */
export function validateOwnership(
  meta: ServerMeta,
  expectedUuid: string,
): boolean {
  return meta.uuid === expectedUuid && meta.command === "dreamgraph";
}

/**
 * Wait for a process to exit, polling at 200ms intervals.
 * Returns true if the process exited within the timeout.
 */
export async function waitForExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await sleep(200);
  }
  return !isProcessAlive(pid);
}

/* ------------------------------------------------------------------ */
/*  Port management (ADR-004)                                         */
/* ------------------------------------------------------------------ */

/**
 * Check if a port is currently in use.
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      server.close();
      resolve(err.code === "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find the first available port starting at startPort.
 * Tries startPort, startPort+1, ..., startPort+maxAttempts-1.
 * Throws if all ports are in use (ADR-004 guard rail #2: max 10).
 */
export async function findAvailablePort(
  startPort: number,
  maxAttempts: number = 10,
): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const inUse = await isPortInUse(port);
    if (!inUse) return port;
  }
  throw new Error(
    `No available port in range ${startPort}–${startPort + maxAttempts - 1}. ` +
    "Close other services or specify a different --port."
  );
}

/* ------------------------------------------------------------------ */
/*  Health check                                                      */
/* ------------------------------------------------------------------ */

/**
 * Poll an HTTP health endpoint until it responds 200 or timeout.
 * Returns true on success.
 */
export async function healthCheck(
  port: number,
  timeoutMs: number = 5000,
): Promise<boolean> {
  const intervalMs = 500;
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ok = await fetchHealth(port);
      if (ok) return true;
    } catch {
      // connection refused — server not ready yet
    }
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Single health check attempt.
 */
async function fetchHealth(port: number): Promise<boolean> {
  const http = await import("node:http");
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/health", method: "GET", timeout: 2000 },
      (res) => {
        res.resume(); // drain
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  Log management (ADR-006)                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_GENERATIONS = 3;

/**
 * Rotate server.log if it exceeds maxBytes.
 * Rotation chain: server.log → .1 → .2 → .3 (deleted).
 * ADR-006 guard rail #4: rotation happens BEFORE opening the log FD.
 */
export async function rotateLogIfNeeded(
  logPath: string,
  maxBytes: number = DEFAULT_MAX_LOG_BYTES,
): Promise<void> {
  // Ensure logs directory exists
  const dir = dirname(logPath);
  await mkdir(dir, { recursive: true });

  try {
    const s = await stat(logPath);
    if (s.size <= maxBytes) return; // under threshold — no rotation needed
  } catch {
    return; // file doesn't exist — nothing to rotate
  }

  // Delete oldest generation
  const oldest = `${logPath}.${MAX_LOG_GENERATIONS}`;
  try { await unlink(oldest); } catch { /* doesn't exist */ }

  // Shift generations down: .2 → .3, .1 → .2
  for (let i = MAX_LOG_GENERATIONS - 1; i >= 1; i--) {
    const from = `${logPath}.${i}`;
    const to = `${logPath}.${i + 1}`;
    try { await rename(from, to); } catch { /* doesn't exist */ }
  }

  // Current → .1
  try { await rename(logPath, `${logPath}.1`); } catch { /* ignore */ }
}

/**
 * Read the last N lines of a log file.
 * Returns empty string if file is missing.
 */
export async function readLogTail(
  logPath: string,
  lines: number = 10,
): Promise<string> {
  try {
    const content = await readFile(logPath, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Version check (ADR-005)                                           */
/* ------------------------------------------------------------------ */

interface VersionCheckResult {
  mismatch: boolean;
  runtimeVersion: string | null;
}

/**
 * Check if the CLI version matches the installed runtime version.
 * Reads ~/.dreamgraph/bin/version.json.
 */
export function checkVersionMismatch(cliVersion: string): VersionCheckResult {
  const masterDir = resolveMasterDir();
  const versionPath = resolve(masterDir, "bin", "version.json");

  try {
    if (!existsSync(versionPath)) {
      return { mismatch: false, runtimeVersion: null };
    }
    // Synchronous read — called once at startup, not hot path
    const raw = readFileSync(versionPath, "utf-8");
    const parsed = JSON.parse(raw);
    const runtimeVersion = parsed.version ?? null;
    return {
      mismatch: runtimeVersion !== null && runtimeVersion !== cliVersion,
      runtimeVersion,
    };
  } catch {
    return { mismatch: false, runtimeVersion: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Binary resolution (ADR-005)                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the path to the DreamGraph server entry point (index.js).
 * Resolution chain: DREAMGRAPH_BIN_DIR → ~/.dreamgraph/bin/ → local dev.
 */
export function resolveBinPath(): string {
  // 1. Explicit override
  const envBin = process.env.DREAMGRAPH_BIN_DIR;
  if (envBin) {
    const p = resolve(envBin, "dist", "index.js");
    if (existsSync(p)) return p;
  }

  // 2. Global install
  const masterDir = resolveMasterDir();
  const globalPath = resolve(masterDir, "bin", "dist", "index.js");
  if (existsSync(globalPath)) return globalPath;

  // 3. Local (relative to this CLI file: dist/cli/utils/daemon.js → dist/index.js)
  const localPath = resolve(
    fileURLToPath(import.meta.url), "..", "..", "..", "index.js"
  );
  if (existsSync(localPath)) return localPath;

  throw new Error(
    "DreamGraph server binary not found. Run install script or set DREAMGRAPH_BIN_DIR."
  );
}

/* ------------------------------------------------------------------ */
/*  Shutdown verification                                              */
/* ------------------------------------------------------------------ */

/**
 * Check if the server log indicates a graceful scheduler shutdown.
 * Looks for "Scheduler stopped" or "stopScheduler" in the last 20 lines.
 */
export async function verifyGracefulShutdown(
  logPath: string,
): Promise<boolean> {
  const tail = await readLogTail(logPath, 20);
  return (
    tail.includes("Scheduler stopped") ||
    tail.includes("stopScheduler") ||
    tail.includes("Shutdown complete")
  );
}

/* ------------------------------------------------------------------ */
/*  Instance resolution for commands                                   */
/* ------------------------------------------------------------------ */

/**
 * Resolve an instance from a CLI query (UUID or name) + flags.
 * Returns the registry entry, instance root path, and master dir.
 */
export async function resolveInstanceForCommand(
  query: string | undefined,
  flags: Record<string, string | true>,
): Promise<{ entry: RegistryEntry; instanceRoot: string; masterDir: string }> {
  if (!query) {
    throw new Error(
      "No instance specified. Usage: dg <command> <instance-name-or-uuid>"
    );
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry, masterDir: resolvedMasterDir } =
    await loadRegistry(masterDir);
  const entry = findInstance(registry, query);

  if (!entry) {
    throw new Error(
      `Instance not found: ${query}\nRun 'dg instances list' to see available instances.`
    );
  }

  if (entry.status !== "active") {
    throw new Error(
      `Instance '${entry.name}' has status '${entry.status}'. Only active instances can be started.`
    );
  }

  const instanceRoot = resolve(resolvedMasterDir, entry.uuid);
  return { entry, instanceRoot, masterDir: resolvedMasterDir };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format bytes to a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
