/**
 * `dg migrate` — Migrate a legacy flat data/ directory into a UUID instance.
 *
 * Usage:
 *   dg migrate [--source <dataDir>] [--name <name>] [--project <path>]
 *              [--policy <strict|balanced|creative>]
 */

import { resolve } from "node:path";
import { migrateFromLegacy } from "../../instance/index.js";
import type { PolicyProfile } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

const VALID_POLICIES: PolicyProfile[] = ["strict", "balanced", "creative"];

export async function cmdMigrate(
  _positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg migrate — Migrate legacy flat data/ directory to a UUID instance

Usage:
  dg migrate [options]

Options:
  --source <path>         Source data directory (default: ./data)
  --name <name>           Name for the new instance (default: "migrated-<timestamp>")
  --project <path>        Attach to a project directory
  --policy <profile>      Policy profile: strict, balanced, creative (default: strict)
  --repo <name=path>      Add a named repository mapping
  --master-dir <path>     Override master directory

This copies all JSON files from the source directory into a new UUID-scoped
instance.  The original data/ directory is NOT modified.
`);
    return;
  }

  const sourceDataDir =
    typeof flags.source === "string" ? resolve(flags.source) : resolve("data");

  const name =
    typeof flags.name === "string"
      ? flags.name
      : `migrated-${Date.now().toString(36)}`;

  const projectRoot =
    typeof flags.project === "string" ? resolve(flags.project) : undefined;

  const policy = typeof flags.policy === "string" ? flags.policy : "strict";
  if (!VALID_POLICIES.includes(policy as PolicyProfile)) {
    console.error(
      `Invalid policy "${policy}". Must be one of: ${VALID_POLICIES.join(", ")}`,
    );
    process.exit(1);
  }

  // Parse --repo flag (simple name=path format)
  const repos: Record<string, string> = {};
  if (typeof flags.repo === "string") {
    const [repoName, repoPath] = flags.repo.split("=");
    if (repoName && repoPath) {
      repos[repoName] = resolve(repoPath);
    }
  }

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { instance, scope } = await migrateFromLegacy({
    name,
    sourceDataDir,
    projectRoot,
    repos,
    policyProfile: policy as PolicyProfile,
    masterDir,
  });

  console.log(`
✓ Migration complete

  UUID:        ${instance.uuid}
  Name:        ${instance.name}
  Source:      ${sourceDataDir}
  Policy:      ${instance.policy_profile}
  Project:     ${instance.project_root ?? "(none)"}
  Instance:    ${scope.instanceRoot}

Original data directory was NOT modified.

To activate this instance:
  export DREAMGRAPH_INSTANCE_UUID=${instance.uuid}
`);
}
