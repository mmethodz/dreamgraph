/**
 * `dg init` — Create a new DreamGraph instance.
 *
 * Usage:
 *   dg init [--name <name>] [--policy <strict|balanced|creative>] [--project <path>]
 *           [--mode <development|production|audit|readonly>]
 *           [--transport <stdio|http>] [--port <number>] [--host <address>]
 */

import { resolve } from "node:path";
import { createInstance } from "../../instance/index.js";
import type { PolicyProfile, InstanceMode, InstanceTransport } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";

const VALID_POLICIES: PolicyProfile[] = ["strict", "balanced", "creative"];
const VALID_MODES: InstanceMode[] = ["development", "production", "audit", "readonly"];
const VALID_TRANSPORTS = ["stdio", "http"] as const;

export async function cmdInit(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg init — Create a new DreamGraph instance

Usage:
  dg init [options]

Options:
  --name <name>           Human-readable instance name (default: auto-generated)
  --policy <profile>      Discipline policy: strict, balanced, creative (default: strict)
  --project <path>        Attach to a project directory at creation time
  --mode <mode>           Operating mode: development, production, audit, readonly (default: development)
  --transport <type>      Transport: stdio, http (default: stdio)
  --port <number>         HTTP port (only with --transport http, default: 8100)
  --host <address>        HTTP host/bind address (only with --transport http, default: 127.0.0.1)
  --master-dir <path>     Override master directory (default: ~/.dreamgraph)
`);
    return;
  }

  const name =
    typeof flags.name === "string"
      ? flags.name
      : `instance-${Date.now().toString(36)}`;

  const policy = typeof flags.policy === "string" ? flags.policy : "strict";
  if (!VALID_POLICIES.includes(policy as PolicyProfile)) {
    console.error(
      `Invalid policy "${policy}". Must be one of: ${VALID_POLICIES.join(", ")}`,
    );
    process.exit(1);
  }

  const mode = typeof flags.mode === "string" ? flags.mode : "development";
  if (!VALID_MODES.includes(mode as InstanceMode)) {
    console.error(
      `Invalid mode "${mode}". Must be one of: ${VALID_MODES.join(", ")}`,
    );
    process.exit(1);
  }

  const transportType = typeof flags.transport === "string" ? flags.transport : "stdio";
  if (!VALID_TRANSPORTS.includes(transportType as typeof VALID_TRANSPORTS[number])) {
    console.error(
      `Invalid transport "${transportType}". Must be one of: ${VALID_TRANSPORTS.join(", ")}`,
    );
    process.exit(1);
  }

  const port = typeof flags.port === "string" ? Number(flags.port) : undefined;
  if (port !== undefined && (isNaN(port) || port < 1 || port > 65535)) {
    console.error(`Invalid port "${flags.port}". Must be 1–65535.`);
    process.exit(1);
  }

  const host = typeof flags.host === "string" ? flags.host : undefined;

  const transport: InstanceTransport = {
    type: transportType as "stdio" | "http",
    ...(transportType === "http" && { port: port ?? 8100 }),
    ...(transportType === "http" && host && { host }),
  };

  const projectRoot =
    typeof flags.project === "string" ? resolve(flags.project) : undefined;

  const masterDir =
    typeof flags["master-dir"] === "string"
      ? resolve(flags["master-dir"])
      : undefined;

  const { instance, scope } = await createInstance({
    name,
    policyProfile: policy as PolicyProfile,
    mode: mode as InstanceMode,
    transport,
    projectRoot,
    masterDir,
  });

  console.log(`
✓ Instance created successfully

  UUID:        ${instance.uuid}
  Name:        ${instance.name}
  Policy:      ${instance.policy_profile}
  Mode:        ${instance.mode}
  Transport:   ${instance.transport.type}${instance.transport.type === "http" ? ` (${instance.transport.host ?? "127.0.0.1"}:${instance.transport.port ?? 8100})` : ""}
  Project:     ${instance.project_root ?? "(none)"}
  Root:        ${scope.instanceRoot}

To activate this instance in your shell:
  export DREAMGRAPH_INSTANCE_UUID=${instance.uuid}

Or switch with:
  dg instances switch ${instance.name}
`);
}
