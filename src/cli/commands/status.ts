/**
 * `dg status` — Show instance cognitive state overview.
 *
 * Usage:
 *   dg status <uuid|name>
 *   dg status [--instance <uuid|name>]   (backward-compatible)
 */

import { resolve } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadRegistry,
  findInstance,
  resolveMasterDir,
} from "../../instance/index.js";
import type { DreamGraphInstance } from "../../instance/index.js";
import type { ParsedArgs } from "../dg.js";
import {
  readServerMeta,
  cleanRuntimeFiles,
  isProcessAlive,
  validateOwnership,
  readLogTail,
  serverLogPath,
  formatUptime,
  formatBytes,
} from "../utils/daemon.js";

export async function cmdStatus(
  _positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg status — Show instance cognitive state

Usage:
  dg status <uuid|name>
  dg status --instance <uuid|name>    (backward-compatible)

Options:
  --instance <uuid|name>    Target instance (also accepted as positional arg)
  --master-dir <path>       Override master directory
  --json                    Output structured JSON (for scripting)
`);
    return;
  }

  // Positional arg takes precedence, then --instance flag, then env var
  const query =
    _positional[0] ??
    (typeof flags.instance === "string" ? flags.instance : undefined) ??
    process.env.DREAMGRAPH_INSTANCE_UUID;

  if (!query) {
    console.error(
      "No instance specified. Usage: dg status <uuid|name>  (or --instance <uuid|name>)",
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
  const instanceRoot = resolve(dir, entry.uuid);
  const instanceJsonPath = resolve(instanceRoot, "instance.json");

  // Load instance.json
  let instance: DreamGraphInstance;
  try {
    const raw = await readFile(instanceJsonPath, "utf-8");
    instance = JSON.parse(raw) as DreamGraphInstance;
  } catch {
    console.error(`Failed to read instance.json for ${entry.uuid}`);
    process.exit(1);
  }

  // Gather cognitive data stats
  const dataDir = resolve(instanceRoot, "data");
  const stats = await gatherDataStats(dataDir);

  // Gather daemon state (with crash detection per TDD Section 3.3)
  const daemon = await gatherDaemonState(instanceRoot, entry.uuid);

  // --json: structured output for scripting
  if (flags.json === true) {
    const json = {
      identity: {
        uuid: instance.uuid,
        name: instance.name,
        version: instance.version,
        status: entry.status,
        mode: instance.mode,
        policy: instance.policy_profile,
        created_at: instance.created_at,
        last_active_at: instance.last_active_at,
      },
      project: {
        root: instance.project_root ?? null,
        forked_from: instance.forked_from ?? null,
      },
      daemon: {
        running: daemon.running,
        pid: daemon.pid,
        transport: daemon.transportRaw,
        port: daemon.portNum,
        uptime_ms: daemon.uptimeMs,
        version: daemon.version === "(N/A)" ? null : daemon.version,
        bin_path: daemon.binPath === "(N/A)" ? null : daemon.binPath,
        log_file: daemon.logFile === "(N/A)" ? null : daemon.logFile,
        log_bytes: daemon.logBytes,
        crashed: daemon.crashed,
        crashed_pid: daemon.crashedPid ?? null,
      },
      cognitive: {
        dream_cycles: instance.total_dream_cycles,
        tool_calls: instance.total_tool_calls,
        graph_nodes: stats.graphNodes,
        graph_edges: stats.graphEdges,
        candidate_edges: stats.candidateEdges,
        validated_edges: stats.validatedEdges,
        tensions: stats.tensions,
        adr_decisions: stats.adrDecisions,
        ui_elements: stats.uiElements,
      },
      paths: {
        instance_root: instanceRoot,
        data_dir: dataDir,
      },
    };
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  DreamGraph Instance Status                             ║
╚══════════════════════════════════════════════════════════╝

  Identity
  ────────────────────────────────────────
  UUID:            ${instance.uuid}
  Name:            ${instance.name}
  Version:         ${instance.version}
  Status:          ${entry.status}
  Mode:            ${instance.mode}
  Policy:          ${instance.policy_profile}
  Created:         ${instance.created_at}
  Last Active:     ${instance.last_active_at}

  Project
  ────────────────────────────────────────
  Root:            ${instance.project_root ?? "(not attached)"}
  Forked From:     ${instance.forked_from ?? "(original)"}

  Daemon
  ────────────────────────────────────────
  Running:         ${daemon.statusLine}
  Transport:       ${daemon.transport}
  Port:            ${daemon.port}
  Uptime:          ${daemon.uptime}
  Version:         ${daemon.version}
  Bin Path:        ${daemon.binPath}
  Log File:        ${daemon.logFile}
  Log Size:        ${daemon.logSize}

  Cognitive State
  ────────────────────────────────────────
  Dream Cycles:    ${instance.total_dream_cycles}
  Tool Calls:      ${instance.total_tool_calls}
  Graph Nodes:     ${stats.graphNodes}
  Graph Edges:     ${stats.graphEdges}
  Candidate Edges: ${stats.candidateEdges}
  Validated Edges: ${stats.validatedEdges}
  Tensions:        ${stats.tensions}
  ADR Decisions:   ${stats.adrDecisions}
  UI Elements:     ${stats.uiElements}

  Paths
  ────────────────────────────────────────
  Instance Root:   ${instanceRoot}
  Data Dir:        ${dataDir}
`);

  // Show crash diagnostic if detected
  if (daemon.crashed) {
    console.log(`  ⚠ Server process (PID ${daemon.crashedPid}) is no longer running (crashed or killed)`);
    if (daemon.crashLogTail) {
      console.log("  Recent log output:");
      console.log(daemon.crashLogTail.split("\n").map((l: string) => `    ${l}`).join("\n"));
    }
    console.log();
  }
}

/* ------------------------------------------------------------------ */
/*  Data gathering                                                    */
/* ------------------------------------------------------------------ */

interface DataStats {
  graphNodes: number;
  graphEdges: number;
  candidateEdges: number;
  validatedEdges: number;
  tensions: number;
  adrDecisions: number;
  uiElements: number;
}

async function gatherDataStats(dataDir: string): Promise<DataStats> {
  const stats: DataStats = {
    graphNodes: 0,
    graphEdges: 0,
    candidateEdges: 0,
    validatedEdges: 0,
    tensions: 0,
    adrDecisions: 0,
    uiElements: 0,
  };

  const read = async (file: string): Promise<unknown> => {
    const p = resolve(dataDir, file);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(await readFile(p, "utf-8"));
    } catch {
      return null;
    }
  };

  const graph = (await read("dream_graph.json")) as {
    nodes?: unknown[];
    edges?: unknown[];
  } | null;
  if (graph) {
    stats.graphNodes = graph.nodes?.length ?? 0;
    stats.graphEdges = graph.edges?.length ?? 0;
  }

  const candidates = (await read("candidate_edges.json")) as
    | { results?: unknown[] }
    | unknown[]
    | null;
  if (candidates) {
    if (Array.isArray(candidates)) {
      stats.candidateEdges = candidates.length;
    } else if (Array.isArray((candidates as { results?: unknown[] }).results)) {
      stats.candidateEdges = (candidates as { results: unknown[] }).results.length;
    }
  }

  const validated = (await read("validated_edges.json")) as
    | { edges?: unknown[] }
    | unknown[]
    | null;
  if (validated) {
    if (Array.isArray(validated)) {
      stats.validatedEdges = validated.length;
    } else if (Array.isArray((validated as { edges?: unknown[] }).edges)) {
      stats.validatedEdges = (validated as { edges: unknown[] }).edges.length;
    }
  }

  const tensions = (await read("tension_log.json")) as {
    signals?: unknown[];
    tensions?: unknown[];
  } | null;
  if (tensions?.signals) {
    stats.tensions = tensions.signals.length;
  } else if (tensions?.tensions) {
    stats.tensions = tensions.tensions.length;
  }

  const adr = (await read("adr_log.json")) as {
    decisions?: unknown[];
  } | null;
  if (adr?.decisions) stats.adrDecisions = adr.decisions.length;

  const ui = (await read("ui_registry.json")) as {
    elements?: unknown[];
  } | null;
  if (ui?.elements) stats.uiElements = ui.elements.length;

  return stats;
}

/* ------------------------------------------------------------------ */
/*  Daemon state (TDD Section 3.3 with crash detection)               */
/* ------------------------------------------------------------------ */

interface DaemonState {
  statusLine: string;
  running: boolean;
  pid: number | null;
  transport: string;
  transportRaw: string | null;
  port: string;
  portNum: number | null;
  uptime: string;
  uptimeMs: number | null;
  version: string;
  binPath: string;
  logFile: string;
  logSize: string;
  logBytes: number | null;
  crashed: boolean;
  crashedPid?: number;
  crashLogTail?: string;
}

async function gatherDaemonState(
  instanceRoot: string,
  instanceUuid: string,
): Promise<DaemonState> {
  const defaults: DaemonState = {
    statusLine: "○ No",
    running: false,
    pid: null,
    transport: "(N/A)",
    transportRaw: null,
    port: "(N/A)",
    portNum: null,
    uptime: "(N/A)",
    uptimeMs: null,
    version: "(N/A)",
    binPath: "(N/A)",
    logFile: "(N/A)",
    logSize: "(N/A)",
    logBytes: null,
    crashed: false,
  };

  // Log file info (always show if exists)
  const logPath = serverLogPath(instanceRoot);
  if (existsSync(logPath)) {
    defaults.logFile = logPath;
    try {
      const logStat = await stat(logPath);
      defaults.logSize = formatBytes(logStat.size);
      defaults.logBytes = logStat.size;
    } catch {
      defaults.logSize = "unknown";
    }
  }

  const meta = await readServerMeta(instanceRoot);
  if (!meta) return defaults;

  // PID alive check + crash detection
  if (!isProcessAlive(meta.pid)) {
    // Crash detected — clean up stale files
    const tail = await readLogTail(logPath, 10);
    await cleanRuntimeFiles(instanceRoot);
    return {
      ...defaults,
      statusLine: `⚠ Crashed (was PID ${meta.pid})`,
      running: false,
      pid: meta.pid,
      transport: meta.transport === "http" ? "Streamable HTTP" : "stdio",
      transportRaw: meta.transport,
      port: meta.port !== null ? String(meta.port) : "(N/A)",
      portNum: meta.port,
      version: meta.version,
      binPath: meta.bin_path,
      crashed: true,
      crashedPid: meta.pid,
      crashLogTail: tail ?? undefined,
    };
  }

  // Ownership validation
  if (!validateOwnership(meta, instanceUuid)) {
    await cleanRuntimeFiles(instanceRoot);
    return {
      ...defaults,
      statusLine: `⚠ PID ${meta.pid} is not owned by this instance`,
      crashed: true,
      crashedPid: meta.pid,
    };
  }

  // Running normally
  const uptimeMs = Date.now() - new Date(meta.started_at).getTime();
  return {
    ...defaults,
    statusLine: `● Yes (PID ${meta.pid})`,
    running: true,
    pid: meta.pid,
    transport: meta.transport === "http" ? "Streamable HTTP" : "stdio",
    transportRaw: meta.transport,
    port: meta.port !== null ? String(meta.port) : "(N/A)",
    portNum: meta.port,
    uptime: formatUptime(uptimeMs),
    uptimeMs,
    version: meta.version,
    binPath: meta.bin_path,
    crashed: false,
  };
}
