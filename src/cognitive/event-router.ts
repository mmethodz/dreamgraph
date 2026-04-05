/**
 * DreamGraph v5.1 — Event-Driven Dreaming
 *
 * Dream cycles are currently triggered on-demand.  The most valuable time
 * to think is *when something changes*.  This module creates a reactive
 * event layer that classifies events, resolves affected entities, and
 * delegates to the appropriate cognitive action.
 *
 * Two intake mechanisms:
 * 1. Internal triggers (always active): after dream_cycle, runtime metrics, imports
 * 2. dispatch_cognitive_event MCP tool (manual / external triggers)
 *
 * HTTP sidecar is intentionally deferred (opt-in, future).
 *
 * Safety guarantees:
 * - Cooldown timer + max cycles per hour (prevent runaway)
 * - Events are advisory — all actions follow existing state-machine rules
 * - Full audit trail in data/event_log.json
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as appConfig } from "../config/config.js";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import { DEFAULT_EVENT_ROUTER_CONFIG } from "./types.js";
import type {
  EventSource,
  EventSeverity,
  CognitiveEvent,
  EntityScope,
  EventLogEntry,
  EventLogFile,
  EventRouterConfig,
  ValidatedEdge,
} from "./types.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EVENT_LOG_PATH = resolve(appConfig.dataDir, "event_log.json");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: EventRouterConfig = { ...DEFAULT_EVENT_ROUTER_CONFIG };
let lastAutoTrigger = 0;
let autoCyclesThisHour = 0;
let hourWindowStart = Date.now();

// ---------------------------------------------------------------------------
// Event Log I/O
// ---------------------------------------------------------------------------

function emptyEventLog(): EventLogFile {
  return {
    metadata: {
      description: "Event-Driven Dreaming — cognitive event audit trail.",
      schema_version: "1.0.0",
      total_events: 0,
      last_event: null,
    },
    events: [],
  };
}

async function loadEventLog(): Promise<EventLogFile> {
  try {
    if (!existsSync(EVENT_LOG_PATH)) return emptyEventLog();
    const raw = await readFile(EVENT_LOG_PATH, "utf-8");
    const p = JSON.parse(raw);
    const e = emptyEventLog();
    return {
      metadata: { ...e.metadata, ...(p.metadata && typeof p.metadata === "object" ? p.metadata : {}) },
      events: Array.isArray(p.events) ? p.events : [],
    };
  } catch {
    return emptyEventLog();
  }
}

async function saveEventLog(log: EventLogFile): Promise<void> {
  log.metadata.total_events = log.events.length;
  log.metadata.last_event =
    log.events.length > 0
      ? log.events[log.events.length - 1].timestamp
      : null;
  await writeFile(EVENT_LOG_PATH, JSON.stringify(log, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Entity Scoping
// ---------------------------------------------------------------------------

/**
 * Resolve the scope of affected entities from an event.
 * Primary = directly mentioned; Secondary = 1-hop via validated edges.
 */
async function resolveEntityScope(
  primaryIds: string[]
): Promise<EntityScope> {
  const primary = [...new Set(primaryIds)];

  // Load validated edges for 1-hop expansion
  const validatedFile = await engine.loadValidatedEdges();
  const edges: ValidatedEdge[] = validatedFile.edges;

  const secondary = new Set<string>();
  for (const id of primary) {
    for (const edge of edges) {
      if (edge.from === id && !primary.includes(edge.to)) {
        secondary.add(edge.to);
      }
      if (edge.to === id && !primary.includes(edge.from)) {
        secondary.add(edge.from);
      }
    }
  }

  const secondaryArr = [...secondary];
  return {
    primary,
    secondary: secondaryArr,
    all: [...primary, ...secondaryArr],
  };
}

// ---------------------------------------------------------------------------
// Event Classification
// ---------------------------------------------------------------------------

interface EventClassification {
  response_type: string;
  strategy: string;
  entity_scope: EntityScope;
}

/**
 * Classify an event and determine the appropriate cognitive response.
 */
async function classifyEvent(
  event: CognitiveEvent
): Promise<EventClassification> {
  const scope = await resolveEntityScope(event.affected_entities);

  switch (event.source) {
    case "git_webhook":
      return {
        response_type: "scoped_dream_cycle",
        strategy: "tension_directed",
        entity_scope: scope,
      };

    case "ci_cd": {
      const isFailure =
        event.severity === "critical" || event.severity === "high";
      return {
        response_type: isFailure
          ? "scoped_nightmare_cycle"
          : "scoped_dream_cycle",
        strategy: isFailure ? "all" : "gap_detection",
        entity_scope: scope,
      };
    }

    case "runtime_anomaly":
      return {
        response_type: "scoped_dream_cycle",
        strategy: "causal_replay",
        entity_scope: scope,
      };

    case "tension_threshold":
      return {
        response_type: "remediation_plan",
        strategy: "tension_directed",
        entity_scope: scope,
      };

    case "federation_import":
      return {
        response_type: "scoped_dream_cycle",
        strategy: "cross_domain",
        entity_scope: scope,
      };

    case "manual":
    default:
      return {
        response_type: (event.payload?.["response_type"] as string) ?? "scoped_dream_cycle",
        strategy: (event.payload?.["strategy"] as string) ?? "gap_detection",
        entity_scope: scope,
      };
  }
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

/**
 * Check whether an auto-triggered cycle is allowed under cooldown rules.
 */
function canAutoTrigger(): boolean {
  const now = Date.now();

  // Reset hourly window
  if (now - hourWindowStart > 3_600_000) {
    hourWindowStart = now;
    autoCyclesThisHour = 0;
  }

  // Check cooldown
  if (now - lastAutoTrigger < config.cooldown_ms) {
    logger.debug(
      `Event router: cooldown active (${config.cooldown_ms - (now - lastAutoTrigger)}ms remaining)`
    );
    return false;
  }

  // Check hourly cap
  if (autoCyclesThisHour >= config.max_auto_cycles_per_hour) {
    logger.debug(
      `Event router: hourly cap reached (${autoCyclesThisHour}/${config.max_auto_cycles_per_hour})`
    );
    return false;
  }

  return true;
}

function recordAutoTrigger(): void {
  lastAutoTrigger = Date.now();
  autoCyclesThisHour++;
}

// ---------------------------------------------------------------------------
// Action Execution
// ---------------------------------------------------------------------------

/**
 * Execute the cognitive action determined by classification.
 * Returns a human-readable outcome summary.
 *
 * Note: This module does NOT import dream_cycle / nightmare_cycle directly
 * (those are registered as MCP tools). Instead, it returns a structured
 * recommendation. The register.ts tool handler orchestrates execution.
 */
function describeAction(classification: EventClassification): string {
  const scope = classification.entity_scope;
  const entities = scope.primary.length > 0
    ? scope.primary.slice(0, 5).join(", ")
    : "all entities";

  switch (classification.response_type) {
    case "scoped_dream_cycle":
      return `Recommending dream_cycle (strategy: ${classification.strategy}) scoped to [${entities}]`;
    case "scoped_nightmare_cycle":
      return `Recommending nightmare_cycle scoped to [${entities}] — critical event detected`;
    case "remediation_plan":
      return `Recommending get_remediation_plan for tensions involving [${entities}]`;
    default:
      return `Recommending ${classification.response_type} (strategy: ${classification.strategy})`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch a cognitive event — classify, scope, log, and return recommendation.
 */
export async function dispatchEvent(
  event: CognitiveEvent
): Promise<EventLogEntry> {
  logger.info(
    `Event dispatch: source=${event.source}, severity=${event.severity}, ` +
    `entities=${event.affected_entities.length}`
  );

  const startMs = Date.now();
  const classification = await classifyEvent(event);
  const actionDescription = describeAction(classification);
  const durationMs = Date.now() - startMs;

  const entry: EventLogEntry = {
    event,
    classification: {
      response_type: classification.response_type,
      entity_scope: classification.entity_scope,
      strategy: classification.strategy,
    },
    result: {
      action_taken: actionDescription,
      duration_ms: durationMs,
      outcome_summary: actionDescription,
    },
    timestamp: new Date().toISOString(),
  };

  // Persist
  const log = await loadEventLog();
  log.events.push(entry);

  // Trim to last 500 events
  if (log.events.length > 500) {
    log.events = log.events.slice(-500);
  }
  await saveEventLog(log);

  logger.info(`Event dispatched: ${actionDescription}`);
  return entry;
}

/**
 * Check for internal tension threshold triggers.
 * Called after each dream_cycle completion.
 */
export async function checkTensionThresholds(): Promise<EventLogEntry | null> {
  if (!canAutoTrigger()) return null;

  const tensionFile = await engine.loadTensions();
  const criticalTensions = tensionFile.signals.filter(
    (t) => !t.resolved && t.urgency > config.tension_threshold
  );

  if (criticalTensions.length === 0) return null;

  // Auto-trigger for the most urgent tension
  const mostUrgent = criticalTensions.sort(
    (a, b) => b.urgency - a.urgency
  )[0];

  recordAutoTrigger();

  const event: CognitiveEvent = {
    id: `auto_tension_${Date.now()}`,
    source: "tension_threshold",
    severity: mostUrgent.urgency > 0.9 ? "critical" : "high",
    timestamp: new Date().toISOString(),
    payload: {
      tension_id: mostUrgent.id,
      urgency: mostUrgent.urgency,
      domain: mostUrgent.domain,
    },
    affected_entities: mostUrgent.entities,
    description: `Auto-triggered: tension "${mostUrgent.id}" exceeded urgency threshold (${mostUrgent.urgency.toFixed(2)} > ${config.tension_threshold})`,
  };

  logger.info(
    `Internal trigger: tension "${mostUrgent.id}" urgency ${mostUrgent.urgency.toFixed(2)} > ${config.tension_threshold}`
  );

  return dispatchEvent(event);
}

/**
 * Update the event router configuration at runtime.
 */
export function updateConfig(newConfig: Partial<EventRouterConfig>): void {
  config = { ...config, ...newConfig };
  logger.info(`Event router config updated: ${JSON.stringify(config)}`);
}

/**
 * Get current router config (for diagnostics).
 */
export function getConfig(): EventRouterConfig {
  return { ...config };
}

/**
 * Load the full event log for resource serving.
 */
export async function getEventLog(): Promise<EventLogFile> {
  return loadEventLog();
}
