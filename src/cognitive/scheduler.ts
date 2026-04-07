/**
 * DreamGraph v5.2 — Dream Scheduler
 *
 * Policy-driven temporal orchestration for cognitive actions.
 *
 * Scheduling modes:
 * A. Time interval  — run dream_cycle every 6 hours, nightmare_cycle daily
 * B. Cycle-based    — every 10 cycles run metacognition, every 50 generate digest
 * C. Idle-time      — if no manual activity in 30 min, run background dreaming
 * D. Cron-like      — hour/day granularity for predictable schedules
 *
 * Design decisions:
 * - In-process scheduler with persistence (no external daemons)
 * - If DreamGraph restarts, schedules reload; missed jobs logged, not replayed
 * - Deterministic: tick → evaluate → execute → persist
 * - Safety: max runs/hour, global cooldown, error streaks pause schedules
 *
 * "Dream freely. Schedule wisely. Execute deterministically."
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { engine } from "./engine.js";
import { dataPath } from "../utils/paths.js";
import { getActiveScope } from "../instance/lifecycle.js";
import { updateInstanceCounters } from "../instance/index.js";
import { dream } from "./dreamer.js";
import { normalize } from "./normalizer.js";
import { nightmare } from "./adversarial.js";
import { runMetacognitiveAnalysis } from "./metacognition.js";
import { dispatchEvent } from "./event-router.js";
import { exportArchetypes } from "./federation.js";
import { maybeAutoNarrate, generateDiffChapter } from "./narrator.js";
import { logger } from "../utils/logger.js";
import { withFileLock } from "../utils/mutex.js";
import { DEFAULT_SCHEDULER_CONFIG } from "./types.js";
import type {
  DreamSchedule,
  ScheduleExecution,
  ScheduleFile,
  SchedulerConfig,
  ScheduleAction,
  ScheduleTriggerType,
  ScheduleStatus,
  DreamHistoryEntry,
} from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const schedulesPath = () => dataPath("schedules.json");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG };
let tickTimer: ReturnType<typeof setInterval> | null = null;
let runsThisHour = 0;
let hourWindowStart = Date.now();
let lastRunTimestamp = 0;
let lastActivityTimestamp = Date.now();

// ---------------------------------------------------------------------------
// Schedule File I/O
// ---------------------------------------------------------------------------

function emptyScheduleFile(): ScheduleFile {
  return {
    metadata: {
      description: "Dream Scheduler — persistent schedule registry and execution log.",
      schema_version: "1.0.0",
      total_schedules: 0,
      total_executions: 0,
      last_tick: null,
    },
    schedules: [],
    executions: [],
  };
}

async function loadScheduleFile(): Promise<ScheduleFile> {
  try {
    if (!existsSync(schedulesPath())) return emptyScheduleFile();
    const raw = await readFile(schedulesPath(), "utf-8");
    const p = JSON.parse(raw);
    const e = emptyScheduleFile();
    return {
      metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
      schedules: Array.isArray(p.schedules) ? p.schedules : [],
      executions: Array.isArray(p.executions) ? p.executions : [],
    };
  } catch {
    return emptyScheduleFile();
  }
}

async function saveScheduleFile(file: ScheduleFile): Promise<void> {
  file.metadata.total_schedules = file.schedules.length;
  file.metadata.total_executions = file.executions.length;
  // Stamp instance UUID when running in instance mode
  const scope = getActiveScope();
  if (scope) file.metadata.instance_uuid = scope.uuid;
  await writeFile(schedulesPath(), JSON.stringify(file, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Safety Guards
// ---------------------------------------------------------------------------

function resetHourWindowIfNeeded(): void {
  const now = Date.now();
  if (now - hourWindowStart > 3_600_000) {
    hourWindowStart = now;
    runsThisHour = 0;
  }
}

function canRunSchedule(schedule: DreamSchedule): boolean {
  resetHourWindowIfNeeded();

  // Global rate limit
  if (runsThisHour >= config.max_runs_per_hour) {
    logger.warn(`Scheduler: rate limit reached (${config.max_runs_per_hour}/hr)`);
    return false;
  }

  // Global cooldown
  if (Date.now() - lastRunTimestamp < config.global_cooldown_ms) {
    return false;
  }

  // Nightmare extra cooldown
  if (schedule.action === "nightmare_cycle") {
    if (Date.now() - lastRunTimestamp < config.nightmare_cooldown_ms) {
      return false;
    }
  }

  // Max runs cap
  if (schedule.max_runs !== null && schedule.run_count >= schedule.max_runs) {
    return false;
  }

  // Error streak check
  if (schedule.error_count >= config.max_error_streak) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Due Evaluation
// ---------------------------------------------------------------------------

function isDue(schedule: DreamSchedule, now: number): boolean {
  if (!schedule.enabled || schedule.status !== "active") return false;

  switch (schedule.trigger_type) {
    case "interval": {
      if (!schedule.interval_ms) return false;
      if (!schedule.last_run_at) return true; // never run — due immediately
      const elapsed = now - new Date(schedule.last_run_at).getTime();
      return elapsed >= schedule.interval_ms;
    }

    case "cron_like": {
      if (!schedule.cron) return false;
      return isCronDue(schedule.cron, schedule.last_run_at, now);
    }

    case "after_cycles": {
      // Evaluated separately via notifyCycleComplete — not in tick loop
      return false;
    }

    case "on_idle": {
      if (!schedule.idle_ms) return false;
      const idleDuration = now - lastActivityTimestamp;
      if (idleDuration < schedule.idle_ms) return false;
      // Don't re-fire if already ran during this idle period
      if (schedule.last_run_at) {
        const lastRun = new Date(schedule.last_run_at).getTime();
        if (lastRun > lastActivityTimestamp) return false;
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Simple cron-like evaluator. Supports: "minute hour day-of-month month day-of-week"
 * Uses "*" for any. Only checks if the CURRENT time matches and not already run this period.
 */
function isCronDue(cron: string, lastRun: string | null, now: number): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const date = new Date(now);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const matches = (field: string, value: number): boolean => {
    if (field === "*") return true;
    // Support comma-separated values
    return field.split(",").some((v) => parseInt(v, 10) === value);
  };

  if (!matches(minute, date.getMinutes())) return false;
  if (!matches(hour, date.getHours())) return false;
  if (!matches(dayOfMonth, date.getDate())) return false;
  if (!matches(month, date.getMonth() + 1)) return false;
  if (!matches(dayOfWeek, date.getDay())) return false;

  // Check we haven't already run in this matching window (same minute)
  if (lastRun) {
    const lastDate = new Date(lastRun);
    if (
      lastDate.getFullYear() === date.getFullYear() &&
      lastDate.getMonth() === date.getMonth() &&
      lastDate.getDate() === date.getDate() &&
      lastDate.getHours() === date.getHours() &&
      lastDate.getMinutes() === date.getMinutes()
    ) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Action Execution
// ---------------------------------------------------------------------------

async function executeAction(schedule: DreamSchedule): Promise<string> {
  switch (schedule.action) {
    case "dream_cycle": {
      const strategy = (schedule.parameters.strategy as string) ?? "all";
      const maxDreams = (schedule.parameters.max_dreams as number) ?? 100;

      // Execute a full dream cycle internally
      if (engine.getState() !== "awake") await engine.interrupt();
      engine.enterRem();
      const decayResult = await engine.applyDecay();
      const tensionDecay = await engine.applyTensionDecay();
      const dreamResult = await dream(strategy as any, maxDreams);

      engine.enterNormalizing();
      const normResult = await normalize();

      // --- Tension creation from normalizer's tension candidates ---
      let tensionsCreated = 0;
      let tensionsResolved = 0;

      if (normResult.tensionCandidates && normResult.tensionCandidates.length > 0) {
        logger.info(`[scheduler] Tension pipeline: ${normResult.tensionCandidates.length} candidates, ${normResult.promotedEdges.length} promoted`);
        for (const tc of normResult.tensionCandidates) {
          const urgency = Math.max(0.3, Math.min(0.7,
            tc.confidence * 2 + 0.2
          ));
          await engine.recordTension({
            type: "weak_connection",
            entities: [tc.from, tc.to],
            description: `Dream "${tc.dreamId}" rejected: ${tc.reason}`,
            urgency,
          });
          tensionsCreated++;
        }
        if (tensionsCreated > 0) {
          logger.info(`[scheduler] Tension pipeline: ${tensionsCreated} tensions recorded`);
        }
      }

      // --- Resolve tensions when promoted edges address them ---
      if (normResult.promotedEdges.length > 0) {
        const unresolvedTensions = await engine.getUnresolvedTensions();
        for (const promoted of normResult.promotedEdges) {
          for (const tension of unresolvedTensions) {
            if (tension.resolved) continue;
            // Require BOTH endpoints of the promoted edge to appear in the tension
            const fromMatch = tension.entities.includes(promoted.from);
            const toMatch = tension.entities.includes(promoted.to);
            if (fromMatch && toMatch) {
              await engine.resolveTension(
                tension.id,
                "system",
                "confirmed_fixed",
                "Addressed by promoted edge " + promoted.from + " -> " + promoted.to
              );
              tension.resolved = true;
              tensionsResolved++;
              logger.info(
                "[scheduler] Tension resolved: '" + tension.id + "' addressed by promoted edge " + promoted.from + " -> " + promoted.to
              );
            }
          }
        }
      }

      engine.wake();

      // Record history
      const entry: DreamHistoryEntry = {
        session_id: `sched_${schedule.id}_${Date.now()}`,
        cycle_number: engine.getCurrentDreamCycle(),
        timestamp: new Date().toISOString(),
        strategy: strategy as any,
        duration_ms: 0,
        generated_edges: dreamResult.edges.length,
        generated_nodes: dreamResult.nodes.length,
        duplicates_merged: dreamResult.duplicates_merged,
        decayed_edges: decayResult.decayedEdges,
        decayed_nodes: decayResult.decayedNodes,
        normalization: {
          validated: normResult.validated,
          latent: normResult.latent,
          rejected: normResult.rejected,
          promoted: normResult.promotedEdges.length,
          promoted_entities: normResult.promotedNodes,
          blocked_by_gate: normResult.blockedByGate,
        },
        tension_signals_created: tensionsCreated,
        tension_signals_resolved: tensionsResolved,
        tensions_expired: tensionDecay.expired,
        tensions_decayed: tensionDecay.decayed,
      };
      await engine.appendHistoryEntry(entry);

      // Persist cycle counter to instance state
      try {
        await updateInstanceCounters({
          total_dream_cycles: engine.getCurrentDreamCycle(),
        });
      } catch { /* non-critical */ }

      // Post-cycle hooks
      try { await maybeAutoNarrate(); } catch { /* swallow */ }

      if (engine.getState() !== "awake") await engine.interrupt();

      return `dream_cycle(${strategy}): ${dreamResult.edges.length} edges, ${normResult.promotedEdges.length} promoted, ${normResult.rejected} rejected`;
    }

    case "nightmare_cycle": {
      const strategy = (schedule.parameters.strategy as string) ?? "all";

      if (engine.getState() !== "awake") await engine.interrupt();
      engine.enterNightmare();
      const result = await nightmare(strategy as any);
      engine.wakeFromNightmare();

      if (engine.getState() !== "awake") await engine.interrupt();

      return `nightmare_cycle(${strategy}): ${result.threats_found} threats found`;
    }

    case "metacognitive_analysis": {
      const windowSize = (schedule.parameters.window_size as number) ?? 50;
      const autoApply = (schedule.parameters.auto_apply as boolean) ?? false;

      const entry = await runMetacognitiveAnalysis(windowSize, autoApply);
      return `metacognition: ${entry.overall_health}, ${entry.threshold_recommendations.length} recommendations`;
    }

    case "dispatch_cognitive_event": {
      const event = {
        id: `sched_evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        source: (schedule.parameters.source as string) ?? "manual",
        severity: (schedule.parameters.severity as string) ?? "info",
        timestamp: new Date().toISOString(),
        payload: (schedule.parameters.payload as Record<string, unknown>) ?? {},
        affected_entities: (schedule.parameters.affected_entities as string[]) ?? [],
        description: (schedule.parameters.description as string) ?? `Scheduled event from ${schedule.name}`,
      };
      const logEntry = await dispatchEvent(event as any);
      return `event dispatched: ${logEntry.result.action_taken}`;
    }

    case "narrative_chapter": {
      const chapter = await generateDiffChapter();
      if (chapter) {
        return `narrative chapter ${chapter.chapter_number} generated: "${chapter.title}"`;
      }
      return "narrative chapter: no significant changes to narrate";
    }

    case "federation_export": {
      const result = await exportArchetypes();
      return `federation export: ${result.archetypes_exported} archetypes exported`;
    }

    case "graph_maintenance": {
      // Decay pass + tension decay without new dreaming
      if (engine.getState() !== "awake") await engine.interrupt();
      engine.enterRem();
      const decayResult = await engine.applyDecay();
      const tensionDecay = await engine.applyTensionDecay();
      await engine.interrupt(); // skip normalization

      return `maintenance: ${decayResult.decayedEdges} edges decayed, ${decayResult.decayedNodes} nodes decayed, ${tensionDecay.expired} tensions expired`;
    }

    default:
      throw new Error(`Unknown schedule action: ${schedule.action}`);
  }
}

// ---------------------------------------------------------------------------
// Tick Loop
// ---------------------------------------------------------------------------

async function tick(): Promise<void> {
  await withFileLock("schedules.json", async () => {
    const now = Date.now();
    const file = await loadScheduleFile();

    const dueSchedules = file.schedules.filter((s) => isDue(s, now));

    for (const schedule of dueSchedules) {
      if (!canRunSchedule(schedule)) continue;

      const startTime = Date.now();
      let resultSummary = "";
      let success = true;
      let errorMsg: string | undefined;

      try {
        logger.info(`Scheduler executing: ${schedule.name} (${schedule.action})`);
        resultSummary = await executeAction(schedule);
        schedule.error_count = 0;
        schedule.last_error = null;
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : String(err);
        resultSummary = `Error: ${errorMsg}`;
        schedule.error_count++;
        schedule.last_error = errorMsg;
        logger.error(`Scheduler error for ${schedule.name}: ${errorMsg}`);

        // Pause on error streak
        if (schedule.error_count >= config.max_error_streak) {
          schedule.status = "error";
          schedule.enabled = false;
          logger.warn(`Schedule "${schedule.name}" paused after ${schedule.error_count} consecutive errors`);
        }
      }

      const duration = Date.now() - startTime;
      const execution: ScheduleExecution = {
        id: `exec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        schedule_id: schedule.id,
        schedule_name: schedule.name,
        action: schedule.action,
        triggered_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        success,
        result_summary: resultSummary,
        error: errorMsg,
        ...(getActiveScope() && { instance_uuid: getActiveScope()!.uuid }),
      };

      // Update schedule metadata
      schedule.last_run_at = new Date().toISOString();
      schedule.run_count++;
      schedule.updated_at = new Date().toISOString();
      computeNextRun(schedule);

      // Check max_runs exhaustion
      if (schedule.max_runs !== null && schedule.run_count >= schedule.max_runs) {
        schedule.status = "exhausted";
        schedule.enabled = false;
      }

      file.executions.push(execution);
      runsThisHour++;
      lastRunTimestamp = Date.now();
    }

    // Trim execution history
    if (file.executions.length > config.max_history) {
      file.executions = file.executions.slice(-config.max_history);
    }

    file.metadata.last_tick = new Date().toISOString();
    await saveScheduleFile(file);
  });
}

function computeNextRun(schedule: DreamSchedule): void {
  if (!schedule.enabled || schedule.status !== "active") {
    schedule.next_run_at = null;
    return;
  }

  const now = Date.now();

  switch (schedule.trigger_type) {
    case "interval":
      schedule.next_run_at = schedule.interval_ms
        ? new Date(now + schedule.interval_ms).toISOString()
        : null;
      break;

    case "after_cycles":
      schedule.next_run_at = null; // cycle-triggered, not time-based
      break;

    case "on_idle":
      schedule.next_run_at = null; // idle-triggered, not predictable
      break;

    case "cron_like":
      // Approximate next run — just mark as "scheduled"
      schedule.next_run_at = null; // cron evaluated at tick time
      break;
  }
}

// ---------------------------------------------------------------------------
// Cycle-Based Trigger Hook
// ---------------------------------------------------------------------------

/**
 * Called after each dream_cycle completion.
 * Evaluates "after_cycles" schedules.
 */
export async function notifyCycleComplete(cycleNumber: number): Promise<void> {
  await withFileLock("schedules.json", async () => {
    const file = await loadScheduleFile();
    let ran = false;

    for (const schedule of file.schedules) {
      if (!schedule.enabled || schedule.status !== "active") continue;
      if (schedule.trigger_type !== "after_cycles") continue;
      if (!schedule.cycle_interval) continue;
      if (!canRunSchedule(schedule)) continue;

      const cyclesSinceLast = cycleNumber - schedule.last_cycle_checked;
      if (cyclesSinceLast < schedule.cycle_interval) continue;

      schedule.last_cycle_checked = cycleNumber;

      const startTime = Date.now();
      let resultSummary = "";
      let success = true;
      let errorMsg: string | undefined;

      try {
        logger.info(`Scheduler (cycle-triggered): ${schedule.name} at cycle ${cycleNumber}`);
        resultSummary = await executeAction(schedule);
        schedule.error_count = 0;
        schedule.last_error = null;
      } catch (err) {
        success = false;
        errorMsg = err instanceof Error ? err.message : String(err);
        resultSummary = `Error: ${errorMsg}`;
        schedule.error_count++;
        schedule.last_error = errorMsg;

        if (schedule.error_count >= config.max_error_streak) {
          schedule.status = "error";
          schedule.enabled = false;
        }
      }

      const execution: ScheduleExecution = {
        id: `exec_cycle_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        schedule_id: schedule.id,
        schedule_name: schedule.name,
        action: schedule.action,
        triggered_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        success,
        result_summary: resultSummary,
        error: errorMsg,
        ...(getActiveScope() && { instance_uuid: getActiveScope()!.uuid }),
      };

      schedule.last_run_at = new Date().toISOString();
      schedule.run_count++;
      schedule.updated_at = new Date().toISOString();

      if (schedule.max_runs !== null && schedule.run_count >= schedule.max_runs) {
        schedule.status = "exhausted";
        schedule.enabled = false;
      }

      file.executions.push(execution);
      runsThisHour++;
      lastRunTimestamp = Date.now();
      ran = true;
    }

    if (ran) {
      if (file.executions.length > config.max_history) {
        file.executions = file.executions.slice(-config.max_history);
      }
      await saveScheduleFile(file);
    }
  });
}

// ---------------------------------------------------------------------------
// Activity Tracking (for idle triggers)
// ---------------------------------------------------------------------------

/** Call this whenever manual MCP tool activity occurs */
export function recordActivity(): void {
  lastActivityTimestamp = Date.now();
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export async function createSchedule(opts: {
  name: string;
  action: ScheduleAction;
  parameters?: Record<string, unknown>;
  trigger_type: ScheduleTriggerType;
  interval_ms?: number;
  cron?: string;
  cycle_interval?: number;
  idle_ms?: number;
  enabled?: boolean;
  max_runs?: number | null;
}): Promise<DreamSchedule> {
  return withFileLock("schedules.json", async () => {
    const file = await loadScheduleFile();
    const now = new Date().toISOString();

    const schedule: DreamSchedule = {
      id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: opts.name,
      action: opts.action,
      parameters: opts.parameters ?? {},
      trigger_type: opts.trigger_type,
      interval_ms: opts.interval_ms,
      cron: opts.cron,
      cycle_interval: opts.cycle_interval,
      idle_ms: opts.idle_ms,
      enabled: opts.enabled ?? true,
      status: "active",
      last_run_at: null,
      next_run_at: null,
      run_count: 0,
      max_runs: opts.max_runs ?? null,
      last_cycle_checked: engine.getCurrentDreamCycle(),
      error_count: 0,
      last_error: null,
      created_at: now,
      updated_at: now,
    };

    computeNextRun(schedule);
    file.schedules.push(schedule);
    await saveScheduleFile(file);

    logger.info(`Schedule created: "${schedule.name}" (${schedule.action}, ${schedule.trigger_type})`);
    return schedule;
  });
}

export async function updateSchedule(
  scheduleId: string,
  updates: Partial<Pick<DreamSchedule,
    "name" | "enabled" | "parameters" | "interval_ms" | "cron" |
    "cycle_interval" | "idle_ms" | "max_runs"
  >>
): Promise<DreamSchedule | null> {
  return withFileLock("schedules.json", async () => {
    const file = await loadScheduleFile();
    const schedule = file.schedules.find((s) => s.id === scheduleId);
    if (!schedule) return null;

    if (updates.name !== undefined) schedule.name = updates.name;
    if (updates.enabled !== undefined) {
      schedule.enabled = updates.enabled;
      // Re-enable resets error state
      if (updates.enabled && schedule.status === "error") {
        schedule.status = "active";
        schedule.error_count = 0;
        schedule.last_error = null;
      }
      if (!updates.enabled && schedule.status === "active") {
        schedule.status = "paused";
      }
      if (updates.enabled && schedule.status === "paused") {
        schedule.status = "active";
      }
    }
    if (updates.parameters !== undefined) schedule.parameters = updates.parameters;
    if (updates.interval_ms !== undefined) schedule.interval_ms = updates.interval_ms;
    if (updates.cron !== undefined) schedule.cron = updates.cron;
    if (updates.cycle_interval !== undefined) schedule.cycle_interval = updates.cycle_interval;
    if (updates.idle_ms !== undefined) schedule.idle_ms = updates.idle_ms;
    if (updates.max_runs !== undefined) schedule.max_runs = updates.max_runs;

    schedule.updated_at = new Date().toISOString();
    computeNextRun(schedule);
    await saveScheduleFile(file);

    logger.info(`Schedule updated: "${schedule.name}" (${schedule.id})`);
    return schedule;
  });
}

export async function deleteSchedule(scheduleId: string): Promise<boolean> {
  return withFileLock("schedules.json", async () => {
    const file = await loadScheduleFile();
    const idx = file.schedules.findIndex((s) => s.id === scheduleId);
    if (idx === -1) return false;

    const removed = file.schedules.splice(idx, 1)[0];
    await saveScheduleFile(file);

    logger.info(`Schedule deleted: "${removed.name}" (${removed.id})`);
    return true;
  });
}

export async function runScheduleNow(scheduleId: string): Promise<ScheduleExecution> {
  return withFileLock("schedules.json", async () => {
    const file = await loadScheduleFile();
    const schedule = file.schedules.find((s) => s.id === scheduleId);
    if (!schedule) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }

    const startTime = Date.now();
    let resultSummary = "";
    let success = true;
    let errorMsg: string | undefined;

    try {
      logger.info(`Scheduler (forced): ${schedule.name} (${schedule.action})`);
      resultSummary = await executeAction(schedule);
      schedule.error_count = 0;
      schedule.last_error = null;
    } catch (err) {
      success = false;
      errorMsg = err instanceof Error ? err.message : String(err);
      resultSummary = `Error: ${errorMsg}`;
      schedule.error_count++;
      schedule.last_error = errorMsg;
    }

    const execution: ScheduleExecution = {
      id: `exec_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      schedule_id: schedule.id,
      schedule_name: schedule.name,
      action: schedule.action,
      triggered_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      success,
      result_summary: resultSummary,
      error: errorMsg,
      ...(getActiveScope() && { instance_uuid: getActiveScope()!.uuid }),
    };

    schedule.last_run_at = new Date().toISOString();
    schedule.run_count++;
    schedule.updated_at = new Date().toISOString();
    computeNextRun(schedule);

    file.executions.push(execution);

    if (file.executions.length > config.max_history) {
      file.executions = file.executions.slice(-config.max_history);
    }
    await saveScheduleFile(file);

    return execution;
  });
}

// ---------------------------------------------------------------------------
// Query Operations
// ---------------------------------------------------------------------------

export async function getSchedules(): Promise<DreamSchedule[]> {
  const file = await loadScheduleFile();
  return file.schedules;
}

export async function getScheduleHistory(
  scheduleId?: string,
  limit?: number
): Promise<ScheduleExecution[]> {
  const file = await loadScheduleFile();
  let executions = file.executions;
  if (scheduleId) {
    executions = executions.filter((e) => e.schedule_id === scheduleId);
  }
  if (limit) {
    executions = executions.slice(-limit);
  }
  return executions;
}

export async function getScheduleFile(): Promise<ScheduleFile> {
  return loadScheduleFile();
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the scheduler tick loop.
 * Called once during server initialization.
 */
export function startScheduler(cfg?: Partial<SchedulerConfig>): void {
  if (cfg) {
    config = { ...config, ...cfg };
  }

  if (!config.enabled) {
    logger.info("Dream Scheduler: disabled by configuration");
    return;
  }

  if (tickTimer) {
    logger.warn("Dream Scheduler: already running, stopping first");
    stopScheduler();
  }

  tickTimer = setInterval(() => {
    tick().catch((err) => {
      logger.error(`Scheduler tick error: ${err}`);
    });
  }, config.tick_interval_ms);

  // Don't block Node exit
  if (tickTimer && typeof tickTimer === "object" && "unref" in tickTimer) {
    tickTimer.unref();
  }

  const instanceTag = getActiveScope() ? ` [${getActiveScope()!.uuid.slice(0, 8)}]` : "";
  logger.info(
    `Dream Scheduler started${instanceTag}: tick=${config.tick_interval_ms}ms, ` +
    `max_runs/hr=${config.max_runs_per_hour}, cooldown=${config.global_cooldown_ms}ms`
  );
}

/**
 * Stop the scheduler tick loop.
 */
export function stopScheduler(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info("Dream Scheduler stopped");
  }
}

/**
 * Update scheduler configuration at runtime.
 */
export function updateSchedulerConfig(newConfig: Partial<SchedulerConfig>): void {
  const wasEnabled = config.enabled;
  config = { ...config, ...newConfig };

  // Restart tick loop if interval changed or enabled/disabled
  if (tickTimer && (newConfig.tick_interval_ms || newConfig.enabled === false)) {
    stopScheduler();
    if (config.enabled) {
      startScheduler();
    }
  } else if (!wasEnabled && config.enabled) {
    startScheduler();
  }

  logger.info(`Scheduler config updated: ${JSON.stringify(config)}`);
}

/**
 * Get current scheduler config (for diagnostics).
 */
export function getSchedulerConfig(): SchedulerConfig {
  return { ...config };
}
