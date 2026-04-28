/**
 * `dg start` — Start a DreamGraph MCP server.
 *
 * Two operational modes:
 *   • Background daemon (default) — HTTP transport only.  The spawned
 *     process detaches and listens on a network port so clients can
 *     connect via Streamable HTTP.
 *   • Foreground (`--foreground`) — runs in the current terminal with
 *     inherited stdio.  Suitable for both HTTP and stdio transports.
 *     MCP clients (e.g. Cursor) should configure their command to
 *     execute `dg start <name> --foreground`.
 *
 * Implements TDD_DG_DAEMON.md Section 3.1.
 * Enforces ADR-003 (server.json), ADR-004 (port collision),
 * ADR-006 (detached spawn + log rotation), ADR-007 (advisory lock).
 *
 * Usage:
 *   dg start <query> [--http] [--port <n>] [--foreground] [--json]
 */

import { spawn } from "node:child_process";
import { openSync, closeSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../../config/config.js";
import { updateInstanceEntry } from "../../instance/index.js";
import type { DreamGraphInstance } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";
import {
  type ServerMeta,
  resolveInstanceForCommand,
  resolveBinPath,
  readServerMeta,
  writeServerMeta,
  cleanRuntimeFiles,
  acquireStartLock,
  isProcessAlive,
  validateOwnership,
  findAvailablePort,
  healthCheck,
  rotateLogIfNeeded,
  readLogTail,
  checkVersionMismatch,
  serverLogPath,
} from "../utils/daemon.js";

export async function cmdStart(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg start — Start a DreamGraph server process

Usage:
  dg start <instance-name-or-uuid> [options]

Modes:
  Background daemon (default)  — HTTP transport only.  The server
    detaches and listens on a network port.
  Foreground (--foreground)    — Runs in the current terminal with
    inherited stdio.  Use this when your MCP client manages the
    process itself (e.g. Cursor running a stdio server).

Options:
  --http                Use Streamable HTTP transport (default: from instance.json)
  --port <number>       Port for HTTP mode (default: from instance.json or 8100)
  --foreground          Run in foreground (don't detach); required for stdio
  --json                Machine-readable JSON output
  --master-dir <path>   Override master directory
`);
    return;
  }

  const jsonOutput = flags.json === true;
  const log = jsonOutput ? () => {} : console.log;
  const logErr = jsonOutput ? () => {} : console.error;

  const query = positional[0];

  // 1. Resolve instance
  const { entry, instanceRoot, masterDir } = await resolveInstanceForCommand(
    query,
    flags,
  );

  // 2. Version mismatch check
  const versionCheck = checkVersionMismatch(config.server.version);
  if (versionCheck.mismatch) {
    logErr(
      `⚠ CLI version (${config.server.version}) differs from installed runtime (${versionCheck.runtimeVersion})`,
    );
    logErr("  Run install script to update, or use --foreground for local dev.");
  }

  // 3. Acquire advisory lock (ADR-007)
  const releaseLock = await acquireStartLock(instanceRoot);

  try {
    // 4. Check if already running
    const existingMeta = await readServerMeta(instanceRoot);
    if (existingMeta) {
      if (isProcessAlive(existingMeta.pid)) {
        if (validateOwnership(existingMeta, entry.uuid)) {
          throw new Error(
            `Instance '${entry.name}' is already running (PID ${existingMeta.pid}).`,
          );
        }
        // PID alive but not ours — stale metadata from PID reuse
        logErr(
          `⚠ Stale server.json: PID ${existingMeta.pid} belongs to another process. Cleaning up.`,
        );
      }
      // PID dead or ownership mismatch — clean up stale files
      await cleanRuntimeFiles(instanceRoot);
    }

    // 5. Determine transport (CLI flags override instance.json config)
    const instanceConfig = await readInstanceConfig(instanceRoot);
    const transport: "http" | "stdio" =
      flags.http === true
        ? "http"
        : instanceConfig?.transport?.type ?? "stdio";
    const requestedPort =
      typeof flags.port === "string"
        ? parseInt(flags.port, 10)
        : instanceConfig?.transport?.port ?? 8100;

    // 6. Stdio + background daemon is a paradox — the detached process
    //    has no stdin/stdout connection to any MCP client.  Require
    //    --foreground for stdio, or switch to HTTP for daemon mode.
    if (transport === "stdio" && flags.foreground !== true) {
      throw new Error(
        "Cannot start a background daemon with stdio transport.\n" +
        "  • For daemon mode use HTTP: dg start " + entry.name + " --http\n" +
        "  • For stdio use foreground:  dg start " + entry.name + " --foreground\n" +
        "  • MCP clients should configure: dg start " + entry.name + " --foreground",
      );
    }

    // 7. Port collision detection (ADR-004, HTTP only)
    let actualPort: number | null = null;
    if (transport === "http") {
      actualPort = await findAvailablePort(requestedPort);
      if (actualPort !== requestedPort) {
        log(`Port ${requestedPort} in use, using ${actualPort} instead.`);
      }
    }

    // 8. Resolve binary path (ADR-005)
    const binPath = resolveBinPath();

    // 9. --foreground mode: print diagnostics and exec in-process
    if (flags.foreground === true) {
      log(`[debug] Instance:   ${entry.uuid} (${entry.name})`);
      log(`[debug] Bin path:   ${binPath}`);
      log(`[debug] Transport:  ${transport}`);
      log(`[debug] Port:       ${actualPort ?? "(N/A)"}`);
      log(`[debug] Data dir:   ${resolve(instanceRoot, "data")}`);
      log(`[debug] Env:`);
      log(`         DREAMGRAPH_INSTANCE_UUID=${entry.uuid}`);
      log(`         DREAMGRAPH_MASTER_DIR=${masterDir}`);

      // Release lock and run in foreground — exec replaces process
      await releaseLock();

      const args = buildServerArgs(transport, actualPort);
      const child = spawn(process.execPath, [binPath, ...args], {
        stdio: "inherit",
        env: {
          ...process.env,
          DREAMGRAPH_INSTANCE_UUID: entry.uuid,
          DREAMGRAPH_MASTER_DIR: masterDir,
        },
      });

      child.on("exit", (code) => process.exit(code ?? 0));
      return;
    }

    // 10. Log rotation (ADR-006 guard rail #4: rotate BEFORE opening FD)
    const logPath = serverLogPath(instanceRoot);
    await rotateLogIfNeeded(logPath);

    // 11. Open log file descriptor
    const logFd = openSync(logPath, "a");

    // 12. Spawn detached HTTP daemon (ADR-006)
    const args = buildServerArgs(transport, actualPort);
    const child = spawn(process.execPath, [binPath, ...args], {
      detached: true,
      // ADR-006 guard rail #2: use FDs, not pipes
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        DREAMGRAPH_INSTANCE_UUID: entry.uuid,
        DREAMGRAPH_MASTER_DIR: masterDir,
      },
    });

    // ADR-006 guard rail #1: no shell: true
    // ADR-006 guard rail #3: unref so CLI can exit
    child.unref();

    const pid = child.pid;
    if (!pid) {
      closeSync(logFd);
      throw new Error("Failed to spawn server process (no PID returned).");
    }

    // Close the FD in the parent — child has its own copy
    closeSync(logFd);

    // 13. Write server.json (ADR-003 guard rail #3: only after successful spawn)
    const meta: ServerMeta = {
      pid,
      uuid: entry.uuid,
      command: "dreamgraph",
      bin_path: binPath,
      transport,
      port: actualPort,
      started_at: new Date().toISOString(),
      version: config.server.version,
    };
    await writeServerMeta(instanceRoot, meta);

    // 14. Health check — daemon is always HTTP at this point
    const healthy = await healthCheck(actualPort!, 15000);
    if (!healthy) {
      const tail = await readLogTail(logPath, 20);
      logErr("⚠ Health check failed. Server may have crashed.");
      if (tail) {
        logErr("Recent log output:");
        logErr(tail);
      }
      // Don't clean up — leave server.json so dg status can diagnose
    }

    // 15. Update registry timestamps
    await updateInstanceEntry(entry.uuid, {
      last_active_at: new Date().toISOString(),
    }, masterDir);

    // 16. Output
    if (jsonOutput) {
      const result = {
        status: "started",
        pid,
        uuid: entry.uuid,
        name: entry.name,
        transport: "http",
        port: actualPort,
        bin_path: binPath,
        version: config.server.version,
      };
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      log(
        `✓ DreamGraph daemon started — ${entry.name} (PID ${pid}, HTTP :${actualPort})`,
      );
    }
  } finally {
    // ADR-007 guard rail #2: always release lock
    await releaseLock();
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function buildServerArgs(
  transport: "http" | "stdio",
  port: number | null,
): string[] {
  const args: string[] = [];
  if (transport === "http") {
    args.push("--transport", "http");
    if (port !== null) {
      args.push("--port", String(port));
    }
  }
  return args;
}

/**
 * Read the instance.json to get configured transport/port defaults.
 * Returns null if the file can't be read (non-fatal).
 */
async function readInstanceConfig(
  instanceRoot: string,
): Promise<DreamGraphInstance | null> {
  const instanceJsonPath = resolve(instanceRoot, "instance.json");
  if (!existsSync(instanceJsonPath)) return null;
  try {
    const raw = await readFile(instanceJsonPath, "utf-8");
    const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(stripped) as DreamGraphInstance;
  } catch {
    return null;
  }
}
