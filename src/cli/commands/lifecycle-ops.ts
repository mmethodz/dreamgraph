/**
 * `dg archive` / `dg destroy` — Instance lifecycle operations.
 *
 * Usage:
 *   dg archive <uuid|name>
 *   dg destroy <uuid|name> [--confirm]
 */

import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import {
  loadRegistry,
  findInstance,
  updateInstanceEntry,
  deregisterInstance,
  resolveMasterDir,
} from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

export async function cmdArchive(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg archive — Mark an instance as archived (data preserved)

Usage:
  dg archive <uuid|name>

Options:
  --master-dir <path>   Override master directory
`);
    return;
  }

  const query = positional[0];
  if (!query) {
    console.error("Missing required argument: <uuid|name>");
    console.error("Usage: dg archive <uuid|name>");
    process.exit(1);
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry } = await loadRegistry(masterDir);
  const entry = findInstance(registry, query);
  if (!entry) {
    console.error(`Instance not found: ${query}`);
    process.exit(1);
  }

  if (entry.status === "archived") {
    console.log(`Instance ${entry.name} is already archived.`);
    return;
  }

  await updateInstanceEntry(
    entry.uuid,
    { status: "archived", last_active_at: new Date().toISOString() },
    masterDir,
  );

  console.log(
    `✓ Instance ${entry.name} (${entry.uuid}) archived.
  Data is preserved at: ${resolve(masterDir ?? resolveMasterDir(), entry.uuid)}
  To restore: dg archive --restore (not yet implemented)`,
  );
}

export async function cmdDestroy(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg destroy — Permanently delete an instance and all its data

Usage:
  dg destroy <uuid|name> [--confirm]

Options:
  --confirm             Skip interactive confirmation
  --master-dir <path>   Override master directory

WARNING: This operation is IRREVERSIBLE. All data will be lost.
`);
    return;
  }

  const query = positional[0];
  if (!query) {
    console.error("Missing required argument: <uuid|name>");
    console.error("Usage: dg destroy <uuid|name> [--confirm]");
    process.exit(1);
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry } = await loadRegistry(masterDir);
  const entry = findInstance(registry, query);
  if (!entry) {
    console.error(`Instance not found: ${query}`);
    process.exit(1);
  }

  // Confirm unless --confirm flag is set
  if (!flags.confirm) {
    const confirmed = await promptConfirm(
      `DESTROY instance "${entry.name}" (${entry.uuid})? ALL DATA WILL BE LOST. [y/N] `,
    );
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  const dir = masterDir ?? resolveMasterDir();
  const instanceRoot = resolve(dir, entry.uuid);

  // 1. Remove from registry
  await deregisterInstance(entry.uuid, masterDir);

  // 2. Remove instance directory
  await rm(instanceRoot, { recursive: true, force: true });

  console.log(
    `✓ Instance ${entry.name} (${entry.uuid}) destroyed.
  Directory removed: ${instanceRoot}`,
  );
}

/* ------------------------------------------------------------------ */
/*  Interactive confirmation                                          */
/* ------------------------------------------------------------------ */

function promptConfirm(message: string): Promise<boolean> {
  return new Promise((res) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(message, (answer) => {
      rl.close();
      res(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}
