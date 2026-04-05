/**
 * `dg instances list` / `dg instances switch` — Browse and activate instances.
 *
 * Usage:
 *   dg instances [list] [--status <active|archived|corrupted>]
 *   dg instances switch <uuid|name>
 */

import { resolve } from "node:path";
import {
  loadRegistry,
  findInstance,
  listInstances,
} from "../../instance/index.js";
import type { InstanceStatus } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

const VALID_STATUSES: InstanceStatus[] = ["active", "archived", "corrupted"];

export async function cmdInstancesList(
  _positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg instances [list] — List all known DreamGraph instances

Usage:
  dg instances [list] [options]

Options:
  --status <status>     Filter by status: active, archived, corrupted
  --master-dir <path>   Override master directory
`);
    return;
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const status = typeof flags.status === "string" ? flags.status : undefined;
  if (status && !VALID_STATUSES.includes(status as InstanceStatus)) {
    console.error(
      `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`,
    );
    process.exit(1);
  }

  const { registry } = await loadRegistry(masterDir);
  const entries = listInstances(
    registry,
    status as InstanceStatus | undefined,
  );

  if (entries.length === 0) {
    console.log("No instances found.");
    if (status) {
      console.log(`(filtered by status: ${status})`);
    }
    return;
  }

  const activeUuid = process.env.DREAMGRAPH_INSTANCE_UUID;

  // Table header
  const header = ["", "UUID", "NAME", "STATUS", "MODE", "PROJECT", "LAST ACTIVE"];
  const rows = entries.map((e) => [
    e.uuid === activeUuid ? "→" : " ",
    e.uuid.slice(0, 8) + "…",
    e.name.slice(0, 24),
    e.status,
    e.mode,
    e.project_root ? truncatePath(e.project_root, 30) : "(none)",
    formatRelative(e.last_active_at),
  ]);

  // Calculate column widths
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );

  const sep = widths.map((w) => "─".repeat(w)).join("──");
  const line = (cols: string[]) =>
    cols.map((c, i) => c.padEnd(widths[i])).join("  ");

  console.log(line(header));
  console.log(sep);
  for (const row of rows) {
    console.log(line(row));
  }
  console.log(`\n${entries.length} instance(s)`);
}

export async function cmdInstancesSwitch(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg instances switch — Activate an instance in the current shell

Usage:
  dg instances switch <uuid|name>

Options:
  --master-dir <path>   Override master directory

Output:
  Prints an export command you can eval in your shell:
    eval $(dg instances switch my-instance)
`);
    return;
  }

  const query = positional[0];
  if (!query) {
    console.error("Missing required argument: <uuid|name>");
    console.error("Usage: dg instances switch <uuid|name>");
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
    console.error("Run 'dg instances list' to see all known instances.");
    process.exit(1);
  }

  if (entry.status !== "active") {
    console.error(
      `Instance ${entry.name} is ${entry.status}. Only active instances can be switched to.`,
    );
    process.exit(1);
  }

  // Print export command for eval
  // Supports both PowerShell ($env:) and POSIX (export)
  const isWindows = process.platform === "win32";
  if (isWindows) {
    console.log(`$env:DREAMGRAPH_INSTANCE_UUID="${entry.uuid}"`);
  } else {
    console.log(`export DREAMGRAPH_INSTANCE_UUID=${entry.uuid}`);
  }

  // Also print friendly message to stderr so eval doesn't capture it
  console.error(`Switched to instance: ${entry.name} (${entry.uuid})`);
}

/* ------------------------------------------------------------------ */
/*  Formatters                                                        */
/* ------------------------------------------------------------------ */

function truncatePath(p: string, max: number): string {
  if (p.length <= max) return p;
  return "…" + p.slice(-(max - 1));
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
