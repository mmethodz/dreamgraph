/**
 * `dg attach` / `dg detach` — Bind or unbind a project to an instance.
 *
 * Usage:
 *   dg attach <project-root> [--instance <uuid|name>] [--repo <name=path>]
 *   dg detach [--instance <uuid|name>]
 */

import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  loadRegistry,
  findInstance,
  updateInstanceEntry,
  resolveMasterDir,
} from "../../instance/index.js";
import type { DreamGraphInstance, InstanceMcpConfig } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

/**
 * Resolve the target instance UUID from flags or env.
 */
function resolveTarget(flags: ParsedArgs["flags"]): string | undefined {
  if (typeof flags.instance === "string") return flags.instance;
  return process.env.DREAMGRAPH_INSTANCE_UUID;
}

export async function cmdAttach(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg attach — Bind an instance to a project directory

Usage:
  dg attach <project-root> [options]

Options:
  --instance <uuid|name>    Target instance (default: DREAMGRAPH_INSTANCE_UUID env)
  --repo <name=path>        Add a named repository mapping (repeatable)
  --master-dir <path>       Override master directory
`);
    return;
  }

  const projectArg = positional[0];
  if (!projectArg) {
    console.error("Missing required argument: <project-root>");
    console.error("Usage: dg attach <project-root> [--instance <uuid|name>]");
    process.exit(1);
  }

  const projectRoot = resolve(projectArg);
  const query = resolveTarget(flags);
  if (!query) {
    console.error(
      "No instance specified. Use --instance <uuid|name> or set DREAMGRAPH_INSTANCE_UUID.",
    );
    process.exit(1);
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry } = await loadRegistry(masterDir);
  const entry = findInstance(registry, query);
  if (!entry) {
    console.error(`Instance not found: ${String(query).replace(/[^\w\-]/g, "?")}`);
    process.exit(1);
  }

  const dir = masterDir ?? resolveMasterDir();
  const instanceJsonPath = resolve(dir, entry.uuid, "instance.json");
  const mcpJsonPath = resolve(dir, entry.uuid, "config", "mcp.json");

  // Update instance.json
  const raw = await readFile(instanceJsonPath, "utf-8");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const instance = JSON.parse(stripped) as DreamGraphInstance;
  instance.project_root = projectRoot;
  await writeFile(instanceJsonPath, JSON.stringify(instance, null, 2), "utf-8");

  // Update mcp.json repos if --repo flag provided
  if (typeof flags.repo === "string") {
    try {
      const mcpRaw = await readFile(mcpJsonPath, "utf-8");
      const mcpStripped = mcpRaw.charCodeAt(0) === 0xfeff ? mcpRaw.slice(1) : mcpRaw;
      const mcpConfig = JSON.parse(mcpStripped) as InstanceMcpConfig;
      const [name, path] = flags.repo.split("=");
      if (name && path) {
        mcpConfig.repos[name] = resolve(path);
        await writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2), "utf-8");
      }
    } catch {
      // mcp.json may not exist
    }
  }

  // Update registry entry
  await updateInstanceEntry(entry.uuid, { project_root: projectRoot }, masterDir);

  console.log(`✓ Instance ${entry.name} (${entry.uuid}) attached to ${projectRoot}`);
}

export async function cmdDetach(
  _positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg detach — Unbind an instance from its project directory

Usage:
  dg detach [options]

Options:
  --instance <uuid|name>    Target instance (default: DREAMGRAPH_INSTANCE_UUID env)
  --master-dir <path>       Override master directory
`);
    return;
  }

  const query = resolveTarget(flags);
  if (!query) {
    console.error(
      "No instance specified. Use --instance <uuid|name> or set DREAMGRAPH_INSTANCE_UUID.",
    );
    process.exit(1);
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry } = await loadRegistry(masterDir);
  const entry = findInstance(registry, query);
  if (!entry) {
    console.error(`Instance not found: ${String(query).replace(/[^\w\-]/g, "?")}`);
    process.exit(1);
  }

  const dir = masterDir ?? resolveMasterDir();
  const instanceJsonPath = resolve(dir, entry.uuid, "instance.json");

  // Update instance.json
  const raw = await readFile(instanceJsonPath, "utf-8");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const instance = JSON.parse(stripped) as DreamGraphInstance;
  const oldProject = instance.project_root;
  instance.project_root = null;
  await writeFile(instanceJsonPath, JSON.stringify(instance, null, 2), "utf-8");

  // Update registry entry
  await updateInstanceEntry(entry.uuid, { project_root: null }, masterDir);

  console.log(
    `✓ Instance ${entry.name} (${entry.uuid}) detached from ${oldProject ?? "(none)"}`,
  );
}
