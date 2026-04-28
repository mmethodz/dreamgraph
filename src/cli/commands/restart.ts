/**
 * `dg restart` — Stop then start a DreamGraph daemon.
 *
 * Implements TDD_DG_DAEMON.md Section 3.1 (dg restart).
 *
 * Usage:
 *   dg restart <query> [--http] [--port <n>] [--json]
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { DreamGraphInstance } from "../../instance/index.js";
import { resolveInstanceForCommand } from "../utils/daemon.js";
import type { ParsedArgs } from "../dg.js";
import { cmdStop } from "./stop.js";
import { cmdStart } from "./start.js";

export async function cmdRestart(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`

dg restart — Restart a DreamGraph server process

Usage:
  dg restart <instance-name-or-uuid> [options]

Options:
  --http                Use Streamable HTTP transport (default: stdio)
  --port <number>       Port for HTTP mode (default: 8100)
  --json                Machine-readable JSON output
  --master-dir <path>   Override master directory
`);
    return;
  }

  const jsonOutput = flags.json === true;
  const log = jsonOutput ? () => {} : console.log;

  const query = positional[0];
  const { instanceRoot } = await resolveInstanceForCommand(query, flags);
  const instanceConfig = await readInstanceConfig(instanceRoot);

  const restartFlags: ParsedArgs["flags"] = { ...flags };
  if (restartFlags.http !== true && instanceConfig?.transport?.type === "http") {
    restartFlags.http = true;
  }
  if (
    typeof restartFlags.port !== "string" &&
    instanceConfig?.transport?.type === "http" &&
    typeof instanceConfig.transport.port === "number"
  ) {
    restartFlags.port = String(instanceConfig.transport.port);
  }

  // 1. Stop (graceful, 5s timeout)
  //    Silently pass --timeout 5000; don't pass --force (graceful stop)
  const stopFlags: ParsedArgs["flags"] = {
    ...flags,
    timeout: "5000",
  };
  // Remove start-specific flags from stop
  delete stopFlags.http;
  delete stopFlags.port;
  delete stopFlags.foreground;

  await cmdStop(positional, stopFlags);

  // 2. Brief pause to let port/resources release
  log("Restarting...");
  await new Promise((r) => setTimeout(r, 500));

  // 3. Start with original flags, merged with persisted transport defaults
  await cmdStart(positional, restartFlags);
}

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
