/**
 * `dg schedule` — Manage dream schedules on a running instance.
 *
 * Usage:
 *   dg schedule <uuid|name>                         List all schedules
 *   dg schedule <uuid|name> --add --name "nightly" --action dream_cycle --type interval --interval 6h
 *   dg schedule <uuid|name> --delete <schedule-id>
 *   dg schedule <uuid|name> --run <schedule-id>     Force immediate execution
 *   dg schedule <uuid|name> --pause <schedule-id>
 *   dg schedule <uuid|name> --resume <schedule-id>
 */

import type { ParsedArgs } from "../dg.js";
import {
  resolveInstanceForCommand,
  readServerMeta,
  isProcessAlive,
} from "../utils/daemon.js";
import { mcpCallTool } from "../utils/mcp-call.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Parse a human-friendly duration like "6h", "30m", "1d", "45s" to ms. */
function parseDuration(s: string): number | null {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case "ms": return n;
    case "s":  return n * 1_000;
    case "m":  return n * 60_000;
    case "h":  return n * 3_600_000;
    case "d":  return n * 86_400_000;
    default:   return null;
  }
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

const VALID_ACTIONS = [
  "dream_cycle", "nightmare_cycle", "metacognitive_analysis",
  "dispatch_cognitive_event", "narrative_chapter",
  "federation_export", "graph_maintenance",
];

const VALID_TYPES = ["interval", "cron_like", "after_cycles", "on_idle"];

/* ------------------------------------------------------------------ */
/*  Main                                                              */
/* ------------------------------------------------------------------ */

export async function cmdSchedule(
  positional: string[],
  flags: ParsedArgs["flags"],
): Promise<void> {
  if (flags.help) {
    console.log(`
dg schedule — Manage dream schedules on a running instance

Usage:
  dg schedule <uuid|name>                  List all schedules
  dg schedule <uuid|name> --add [opts]     Create a new schedule
  dg schedule <uuid|name> --delete <id>    Delete a schedule
  dg schedule <uuid|name> --run <id>       Force immediate execution
  dg schedule <uuid|name> --pause <id>     Pause a schedule
  dg schedule <uuid|name> --resume <id>    Resume a schedule
  dg schedule <uuid|name> --history [id]   Show execution history

Create options (--add):
  --name <name>             Schedule name (required)
  --action <action>         Action to schedule (default: dream_cycle)
      Actions: ${VALID_ACTIONS.join(", ")}
  --type <trigger>          Trigger type (default: interval)
      Types: ${VALID_TYPES.join(", ")}
  --interval <duration>     Interval duration, e.g. 6h, 30m, 1d (for type=interval)
  --cron <expression>       Cron-like expression (for type=cron_like)
  --cycles <n>              Cycle interval (for type=after_cycles)
  --idle <duration>         Idle timeout, e.g. 30m (for type=on_idle)
  --max-runs <n>            Maximum executions (omit for unlimited)
  --disabled                Create in disabled state

General:
  --json                    Output raw JSON
  --master-dir <path>       Override master directory
`);
    return;
  }

  const query = positional[0];
  const jsonOutput = flags.json === true;

  // 1. Resolve instance
  const { entry, instanceRoot } = await resolveInstanceForCommand(query, flags);

  // 2. Verify daemon is running
  const meta = await readServerMeta(instanceRoot);
  if (!meta || !isProcessAlive(meta.pid) || meta.port == null) {
    console.error(
      `Instance '${entry.name}' is not running. Start it first: dg start ${entry.name}`,
    );
    process.exit(1);
  }

  const port = meta.port;

  // 3. Dispatch to sub-operation
  if (flags.add === true) {
    await handleAdd(port, flags, jsonOutput);
  } else if (typeof flags.delete === "string") {
    await handleDelete(port, flags.delete, jsonOutput);
  } else if (typeof flags.run === "string") {
    await handleRun(port, flags.run, jsonOutput);
  } else if (typeof flags.pause === "string") {
    await handlePause(port, flags.pause, jsonOutput);
  } else if (typeof flags.resume === "string") {
    await handleResume(port, flags.resume, jsonOutput);
  } else if (flags.history !== undefined) {
    await handleHistory(port, typeof flags.history === "string" ? flags.history : undefined, jsonOutput);
  } else {
    // Default: list schedules
    await handleList(port, jsonOutput);
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-operations                                                    */
/* ------------------------------------------------------------------ */

async function handleList(port: number, json: boolean): Promise<void> {
  const result = await mcpCallTool(port, "list_schedules", {});
  const text = result.content?.[0]?.text ?? "{}";

  if (json) {
    console.log(text);
    return;
  }

  try {
    const parsed = JSON.parse(text);
    const data = parsed.data ?? parsed;
    const schedules: unknown[] = data.schedules ?? [];

    if (schedules.length === 0) {
      console.log("No schedules configured.");
      console.log("Create one with: dg schedule <instance> --add --name 'nightly' --action dream_cycle --type interval --interval 6h");
      return;
    }

    console.log(`\n  Schedules (${schedules.length}):\n`);
    console.log(
      "  " +
      "ID".padEnd(32) +
      "Name".padEnd(22) +
      "Action".padEnd(24) +
      "Trigger".padEnd(14) +
      "Status".padEnd(10) +
      "Runs"
    );
    console.log("  " + "─".repeat(108));

    for (const s of schedules as Array<Record<string, unknown>>) {
      const id = String(s.id ?? "").slice(0, 30);
      const name = String(s.name ?? "").slice(0, 20);
      const action = String(s.action ?? "");
      const trigger = String(s.trigger_type ?? "");
      const status = String(s.status ?? s.enabled === false ? "paused" : "active");
      const runs = String(s.run_count ?? 0);

      console.log(
        "  " +
        id.padEnd(32) +
        name.padEnd(22) +
        action.padEnd(24) +
        trigger.padEnd(14) +
        status.padEnd(10) +
        runs
      );
    }
    console.log();
  } catch {
    console.log(text);
  }
}

async function handleAdd(
  port: number,
  flags: Record<string, string | true>,
  json: boolean,
): Promise<void> {
  const name = typeof flags.name === "string" ? flags.name : undefined;
  if (!name) {
    console.error("--name is required when creating a schedule.");
    process.exit(1);
  }

  const action = typeof flags.action === "string" ? flags.action : "dream_cycle";
  if (!VALID_ACTIONS.includes(action)) {
    console.error(`Invalid action '${action}'. Valid: ${VALID_ACTIONS.join(", ")}`);
    process.exit(1);
  }

  const triggerType = typeof flags.type === "string" ? flags.type : "interval";
  // Normalize trigger type names for convenience
  const triggerMap: Record<string, string> = {
    interval: "interval",
    cron: "cron_like",
    "cron-like": "cron_like",
    cron_like: "cron_like",
    cycles: "after_cycles",
    after_cycles: "after_cycles",
    idle: "on_idle",
    "on-idle": "on_idle",
    on_idle: "on_idle",
  };
  const normalizedTrigger = triggerMap[triggerType];
  if (!normalizedTrigger) {
    console.error(`Invalid trigger type '${triggerType}'. Valid: interval, cron, cycles, idle`);
    process.exit(1);
  }

  const args: Record<string, unknown> = {
    name,
    action,
    trigger_type: normalizedTrigger,
  };

  if (typeof flags.interval === "string") {
    const ms = parseDuration(flags.interval);
    if (ms == null) {
      console.error(`Invalid interval '${flags.interval}'. Use e.g. 6h, 30m, 1d, 45s`);
      process.exit(1);
    }
    args.interval_ms = ms;
  } else if (normalizedTrigger === "interval") {
    // Default 6h for interval triggers
    args.interval_ms = 6 * 3_600_000;
  }

  if (typeof flags.cron === "string") args.cron = flags.cron;
  if (typeof flags.cycles === "string") args.cycle_interval = parseInt(flags.cycles, 10);
  if (typeof flags.idle === "string") {
    const ms = parseDuration(flags.idle);
    if (ms == null) {
      console.error(`Invalid idle duration '${flags.idle}'. Use e.g. 30m, 1h`);
      process.exit(1);
    }
    args.idle_ms = ms;
  }

  if (typeof flags["max-runs"] === "string") {
    args.max_runs = parseInt(flags["max-runs"], 10);
  }

  if (flags.disabled === true) {
    args.enabled = false;
  }

  try {
    const result = await mcpCallTool(port, "schedule_dream", args);
    const text = result.content?.[0]?.text ?? "{}";

    if (json) {
      console.log(text);
      return;
    }

    const parsed = JSON.parse(text);
    const data = parsed.data ?? parsed;
    console.log(`Schedule created: ${data.name ?? name}`);
    console.log(`  ID:       ${data.id ?? "?"}`);
    console.log(`  Action:   ${action}`);
    console.log(`  Trigger:  ${normalizedTrigger}`);
    if (args.interval_ms) console.log(`  Interval: ${fmtMs(args.interval_ms as number)}`);
    if (args.cron) console.log(`  Cron:     ${args.cron}`);
    if (args.cycle_interval) console.log(`  Cycles:   every ${args.cycle_interval}`);
    if (args.idle_ms) console.log(`  Idle:     ${fmtMs(args.idle_ms as number)}`);
    console.log(`  Enabled:  ${data.enabled ?? true}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create schedule: ${msg}`);
    process.exit(1);
  }
}

async function handleDelete(port: number, scheduleId: string, json: boolean): Promise<void> {
  try {
    const result = await mcpCallTool(port, "delete_schedule", { schedule_id: scheduleId });
    const text = result.content?.[0]?.text ?? "{}";

    if (json) {
      console.log(text);
      return;
    }

    console.log(`Schedule '${scheduleId}' deleted.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to delete schedule: ${msg}`);
    process.exit(1);
  }
}

async function handleRun(port: number, scheduleId: string, json: boolean): Promise<void> {
  console.log(`Triggering schedule '${scheduleId}'...`);
  try {
    const result = await mcpCallTool(port, "run_schedule_now", { schedule_id: scheduleId }, 600_000);
    const text = result.content?.[0]?.text ?? "{}";

    if (json) {
      console.log(text);
      return;
    }

    const parsed = JSON.parse(text);
    const data = parsed.data ?? parsed;
    console.log(`Schedule executed.`);
    if (data.status) console.log(`  Status:   ${data.status}`);
    if (data.duration_ms != null) console.log(`  Duration: ${fmtMs(data.duration_ms)}`);
    if (data.error) console.log(`  Error:    ${data.error}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to run schedule: ${msg}`);
    process.exit(1);
  }
}

async function handlePause(port: number, scheduleId: string, json: boolean): Promise<void> {
  try {
    const result = await mcpCallTool(port, "update_schedule", {
      schedule_id: scheduleId,
      enabled: false,
    });
    const text = result.content?.[0]?.text ?? "{}";

    if (json) {
      console.log(text);
      return;
    }

    console.log(`Schedule '${scheduleId}' paused.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to pause schedule: ${msg}`);
    process.exit(1);
  }
}

async function handleResume(port: number, scheduleId: string, json: boolean): Promise<void> {
  try {
    const result = await mcpCallTool(port, "update_schedule", {
      schedule_id: scheduleId,
      enabled: true,
    });
    const text = result.content?.[0]?.text ?? "{}";

    if (json) {
      console.log(text);
      return;
    }

    console.log(`Schedule '${scheduleId}' resumed.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to resume schedule: ${msg}`);
    process.exit(1);
  }
}

async function handleHistory(
  port: number,
  scheduleId: string | undefined,
  json: boolean,
): Promise<void> {
  const args: Record<string, unknown> = { limit: 20 };
  if (scheduleId) args.schedule_id = scheduleId;

  try {
    const result = await mcpCallTool(port, "get_schedule_history", args);
    const text = result.content?.[0]?.text ?? "{}";

    if (json) {
      console.log(text);
      return;
    }

    const parsed = JSON.parse(text);
    const data = parsed.data ?? parsed;
    const execs: unknown[] = data.executions ?? data.history ?? [];

    if (execs.length === 0) {
      console.log("No execution history.");
      return;
    }

    console.log(`\n  Execution History (last ${execs.length}):\n`);
    console.log(
      "  " +
      "Time".padEnd(22) +
      "Schedule".padEnd(32) +
      "Action".padEnd(22) +
      "Status".padEnd(10) +
      "Duration"
    );
    console.log("  " + "─".repeat(92));

    for (const e of execs as Array<Record<string, unknown>>) {
      const time = String(e.started_at ?? e.timestamp ?? "").slice(0, 19).replace("T", " ");
      const sid = String(e.schedule_id ?? "").slice(0, 30);
      const action = String(e.action ?? "");
      const status = String(e.status ?? "");
      const dur = e.duration_ms != null ? fmtMs(Number(e.duration_ms)) : "—";

      console.log(
        "  " +
        time.padEnd(22) +
        sid.padEnd(32) +
        action.padEnd(22) +
        status.padEnd(10) +
        dur
      );
    }
    console.log();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to get history: ${msg}`);
    process.exit(1);
  }
}
