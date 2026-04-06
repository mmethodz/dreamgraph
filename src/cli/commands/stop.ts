/**
 * `dg stop` — Send shutdown signal to a running DreamGraph daemon.
 *
 * Implements TDD_DG_DAEMON.md Section 3.1 (dg stop).
 * Enforces ADR-003 (server.json), ADR-007 (cleanup).
 *
 * Usage:
 *   dg stop <query> [--force] [--timeout <ms>] [--json]
 */

import type { ParsedArgs } from "../dg.js";
import {
  readServerMeta,
  cleanRuntimeFiles,
  isProcessAlive,
  validateOwnership,
  waitForExit,
  verifyGracefulShutdown,
  readLogTail,
  resolveInstanceForCommand,
  serverLogPath,
} from "../utils/daemon.js";

export async function cmdStop(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg stop — Stop a running DreamGraph server process

Usage:
  dg stop <instance-name-or-uuid> [options]

Options:
  --force               Send SIGKILL immediately (skip graceful shutdown)
  --timeout <ms>        Graceful shutdown timeout (default: 5000)
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
  const { entry, instanceRoot } = await resolveInstanceForCommand(
    query,
    flags,
  );

  // 2. Read runtime/server.json
  const meta = await readServerMeta(instanceRoot);
  if (!meta) {
    if (jsonOutput) {
      process.stdout.write(
        JSON.stringify({
          status: "not_running",
          uuid: entry.uuid,
          name: entry.name,
        }) + "\n",
      );
    } else {
      log(`Instance '${entry.name}' is not running.`);
    }
    return;
  }

  const { pid } = meta;

  // 3. Check if PID is alive
  if (!isProcessAlive(pid)) {
    await cleanRuntimeFiles(instanceRoot);
    if (jsonOutput) {
      process.stdout.write(
        JSON.stringify({
          status: "not_running",
          uuid: entry.uuid,
          name: entry.name,
          note: "stale PID cleaned",
        }) + "\n",
      );
    } else {
      log(
        `Instance '${entry.name}' is not running (stale PID ${pid} cleaned).`,
      );
    }
    return;
  }

  // 4. Validate process ownership (ADR-003)
  const forceFlag = flags.force === true;
  if (!forceFlag && !validateOwnership(meta, entry.uuid)) {
    throw new Error(
      `PID ${pid} does not belong to this instance (possible PID reuse). ` +
        "Use --force to override.",
    );
  }

  // 5. Parse timeout
  const timeout =
    typeof flags.timeout === "string" ? parseInt(flags.timeout, 10) : 5000;

  // 6. Send signal
  const signal = forceFlag ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(pid, signal);
    logErr(
      `Sent ${signal} to PID ${pid}${forceFlag ? " (forced)" : ""}...`,
    );
  } catch (err: unknown) {
    // ESRCH means process already gone
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      await cleanRuntimeFiles(instanceRoot);
      log(`Instance '${entry.name}' already exited.`);
      return;
    }

    // EPERM on Windows — try taskkill as fallback
    if (
      process.platform === "win32" &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      logErr(`process.kill failed on Windows, trying taskkill...`);
      const { execSync } = await import("node:child_process");
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        throw new Error(
          `Failed to kill PID ${pid}. You may need to terminate it manually.`,
        );
      }
    } else {
      throw err;
    }
  }

  // 7. Wait for process to exit
  const exited = await waitForExit(pid, timeout);

  if (!exited) {
    if (forceFlag) {
      // Already sent SIGKILL, process is stuck — unusual
      throw new Error(
        `PID ${pid} did not exit after ${timeout}ms even with SIGKILL.`,
      );
    }

    // Escalate to SIGKILL
    logErr(
      `Process didn't exit within ${timeout}ms. Sending SIGKILL...`,
    );
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone
    }
    const killedOk = await waitForExit(pid, 3000);
    if (!killedOk) {
      throw new Error(
        `PID ${pid} did not exit after SIGKILL. You may need to terminate it manually.`,
      );
    }
  }

  // 8. Graceful shutdown confirmation
  const logPath = serverLogPath(instanceRoot);
  let schedulerClean = false;
  if (!forceFlag) {
    schedulerClean = await verifyGracefulShutdown(logPath);
    if (schedulerClean) {
      log("Scheduler stopped cleanly.");
    } else {
      logErr("⚠ Clean shutdown not confirmed in logs.");
      const tail = await readLogTail(logPath, 5);
      if (tail) {
        logErr("Recent log output:");
        logErr(tail);
      }
    }
  }

  // 9. Clean up runtime files
  await cleanRuntimeFiles(instanceRoot);

  // 10. Output
  if (jsonOutput) {
    process.stdout.write(
      JSON.stringify({
        status: "stopped",
        pid,
        uuid: entry.uuid,
        name: entry.name,
        graceful: !forceFlag,
        scheduler_clean: schedulerClean,
      }) + "\n",
    );
  } else {
    log(`✓ Instance '${entry.name}' stopped (PID ${pid}).`);
  }
}
