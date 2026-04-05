/**
 * `dg fork` — Fork an existing instance (copy all data into a new instance).
 *
 * Usage:
 *   dg fork <source-uuid|name> [--name <name>] [--policy <profile>]
 */

import { resolve } from "node:path";
import { readFile, writeFile, readdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadRegistry,
  findInstance,
  resolveMasterDir,
  createInstance,
} from "../../instance/index.js";
import type { DreamGraphInstance, PolicyProfile } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

export async function cmdFork(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg fork — Fork an instance (create a copy with new UUID)

Usage:
  dg fork <source-uuid|name> [options]

Options:
  --name <name>           Name for the new instance (default: "fork-of-<source-name>")
  --policy <profile>      Override policy for fork: strict, balanced, creative
  --master-dir <path>     Override master directory

The fork copies all data files from the source instance.
The new instance records its parent in the forked_from field.
`);
    return;
  }

  const sourceQuery = positional[0];
  if (!sourceQuery) {
    console.error("Missing required argument: <source-uuid|name>");
    console.error("Usage: dg fork <source-uuid|name> [--name <name>]");
    process.exit(1);
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { registry } = await loadRegistry(masterDir);
  const sourceEntry = findInstance(registry, sourceQuery);
  if (!sourceEntry) {
    console.error(`Source instance not found: ${sourceQuery}`);
    process.exit(1);
  }

  // Load source instance.json for details
  const dir = masterDir ?? resolveMasterDir();
  const sourceRoot = resolve(dir, sourceEntry.uuid);
  const sourceInstancePath = resolve(sourceRoot, "instance.json");

  let sourceInstance: DreamGraphInstance;
  try {
    const raw = await readFile(sourceInstancePath, "utf-8");
    sourceInstance = JSON.parse(raw) as DreamGraphInstance;
  } catch {
    console.error(`Failed to read source instance at ${sourceInstancePath}`);
    process.exit(1);
  }

  const forkName =
    typeof flags.name === "string"
      ? flags.name
      : `fork-of-${sourceInstance.name}`;

  const forkPolicy =
    typeof flags.policy === "string"
      ? (flags.policy as PolicyProfile)
      : sourceInstance.policy_profile;

  // 1. Create new instance
  const { instance: forkInstance, scope: forkScope } = await createInstance({
    name: forkName,
    projectRoot: sourceInstance.project_root ?? undefined,
    mode: sourceInstance.mode,
    policyProfile: forkPolicy,
    masterDir,
  });

  // 2. Copy data files from source
  const sourceDataDir = resolve(sourceRoot, "data");
  const forkDataDir = forkScope.dataDir;

  if (existsSync(sourceDataDir)) {
    const files = await readdir(sourceDataDir);
    let copied = 0;
    for (const file of files) {
      if (file.endsWith(".json")) {
        await copyFile(
          resolve(sourceDataDir, file),
          resolve(forkDataDir, file),
        );
        copied++;
      }
    }
    console.error(`Copied ${copied} data files from source.`);
  }

  // 3. Update forked_from in the new instance.json
  const forkInstancePath = resolve(dir, forkInstance.uuid, "instance.json");
  const updatedInstance = { ...forkInstance, forked_from: sourceInstance.uuid };
  await writeFile(
    forkInstancePath,
    JSON.stringify(updatedInstance, null, 2),
    "utf-8",
  );

  console.log(`
✓ Instance forked successfully

  Source:      ${sourceInstance.name} (${sourceInstance.uuid})
  Fork:        ${forkInstance.name} (${forkInstance.uuid})
  Policy:      ${forkInstance.policy_profile}
  Data Dir:    ${forkDataDir}

To activate the fork:
  export DREAMGRAPH_INSTANCE_UUID=${forkInstance.uuid}
`);
}
