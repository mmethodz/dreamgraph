/**
 * DreamGraph — Lightweight Runtime Instrumentation.
 *
 * In-memory metrics tracker for tool usage, failures, symbol lookups,
 * and file-read hotspots. Provides self-observability without external
 * dependencies. Metrics are ephemeral (reset on server restart) but
 * can be persisted via the flush-to-disk function.
 *
 * Consumers:
 *   - query_runtime_metrics tool reads the snapshot
 *   - ops://metrics resource exposes the full state
 *   - metacognitive_analysis can weight by real usage
 */

import fs from "node:fs/promises";
import { dataPath } from "./paths.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallRecord {
  /** Total invocations */
  calls: number;
  /** Total failures (returned error or threw) */
  failures: number;
  /** Total duration in milliseconds */
  total_ms: number;
  /** Last invocation timestamp */
  last_called: string | null;
  /** Last failure message (most recent only) */
  last_error: string | null;
}

export interface SymbolLookupMetrics {
  /** Total lookup attempts */
  attempts: number;
  /** Lookups that returned no results */
  misses: number;
  /** Most frequently missed symbols */
  top_misses: Record<string, number>;
}

export interface FileReadMetrics {
  /** File path → read count */
  hotspots: Record<string, number>;
  /** Total file reads across all tools */
  total_reads: number;
}

export interface MetricsSnapshot {
  /** When this snapshot was created */
  snapshot_at: string;
  /** Server start time */
  started_at: string;
  /** Uptime in seconds */
  uptime_s: number;
  /** Per-tool call metrics */
  tools: Record<string, ToolCallRecord>;
  /** Symbol/API lookup metrics */
  symbol_lookups: SymbolLookupMetrics;
  /** File read hotspot tracking */
  file_reads: FileReadMetrics;
  /** Dream cycle outcome tracking */
  dream_outcomes: {
    promoted: number;
    validated: number;
    rejected: number;
    by_strategy: Record<string, { promoted: number; validated: number; rejected: number }>;
  };
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const startedAt = new Date();

const toolMetrics: Record<string, ToolCallRecord> = {};

const symbolLookups: SymbolLookupMetrics = {
  attempts: 0,
  misses: 0,
  top_misses: {},
};

const fileReads: FileReadMetrics = {
  hotspots: {},
  total_reads: 0,
};

const dreamOutcomes = {
  promoted: 0,
  validated: 0,
  rejected: 0,
  by_strategy: {} as Record<string, { promoted: number; validated: number; rejected: number }>,
};

// ---------------------------------------------------------------------------
// Recording functions — called from tool implementations
// ---------------------------------------------------------------------------

/**
 * Record a tool call (success or failure).
 */
export function recordToolCall(
  toolName: string,
  durationMs: number,
  failed: boolean,
  errorMsg?: string,
): void {
  if (!toolMetrics[toolName]) {
    toolMetrics[toolName] = {
      calls: 0,
      failures: 0,
      total_ms: 0,
      last_called: null,
      last_error: null,
    };
  }
  const m = toolMetrics[toolName];
  m.calls++;
  m.total_ms += durationMs;
  m.last_called = new Date().toISOString();
  if (failed) {
    m.failures++;
    m.last_error = errorMsg ?? "unknown";
  }
}

/**
 * Record a symbol/API-surface lookup. Call with `found=false` on miss.
 */
export function recordSymbolLookup(symbolName: string, found: boolean): void {
  symbolLookups.attempts++;
  if (!found) {
    symbolLookups.misses++;
    symbolLookups.top_misses[symbolName] =
      (symbolLookups.top_misses[symbolName] ?? 0) + 1;
    // Keep only top 50 misses
    const entries = Object.entries(symbolLookups.top_misses)
      .sort((a, b) => b[1] - a[1]);
    if (entries.length > 50) {
      symbolLookups.top_misses = Object.fromEntries(entries.slice(0, 50));
    }
  }
}

/**
 * Record a file read (for hotspot tracking).
 */
export function recordFileRead(filePath: string): void {
  fileReads.total_reads++;
  fileReads.hotspots[filePath] = (fileReads.hotspots[filePath] ?? 0) + 1;
}

/**
 * Record a dream cycle outcome.
 */
export function recordDreamOutcome(
  strategy: string,
  outcome: "promoted" | "validated" | "rejected",
): void {
  dreamOutcomes[outcome]++;
  if (!dreamOutcomes.by_strategy[strategy]) {
    dreamOutcomes.by_strategy[strategy] = { promoted: 0, validated: 0, rejected: 0 };
  }
  dreamOutcomes.by_strategy[strategy][outcome]++;
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Build a complete metrics snapshot.
 */
export function getMetricsSnapshot(): MetricsSnapshot {
  const now = new Date();
  return {
    snapshot_at: now.toISOString(),
    started_at: startedAt.toISOString(),
    uptime_s: Math.round((now.getTime() - startedAt.getTime()) / 1000),
    tools: { ...toolMetrics },
    symbol_lookups: { ...symbolLookups },
    file_reads: {
      total_reads: fileReads.total_reads,
      // Return top 30 hotspots sorted by count
      hotspots: Object.fromEntries(
        Object.entries(fileReads.hotspots)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
      ),
    },
    dream_outcomes: { ...dreamOutcomes },
  };
}

/**
 * Persist the current metrics snapshot to disk for post-mortem analysis.
 */
export async function flushMetricsToDisk(): Promise<void> {
  try {
    const snapshot = getMetricsSnapshot();
    await fs.writeFile(
      dataPath("metrics_snapshot.json"),
      JSON.stringify(snapshot, null, 2),
      "utf-8",
    );
    logger.debug("Metrics snapshot flushed to disk");
  } catch (err) {
    logger.warn("Failed to flush metrics: " + (err instanceof Error ? err.message : String(err)));
  }
}
