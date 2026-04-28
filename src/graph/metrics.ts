/**
 * Explorer metrics — small in-memory rolling window.
 *
 * Per plans/DREAMGRAPH_EXPLORER.md §4.3: track build_ms, bytes,
 * counts, and per-route latencies from day one. No on-disk store.
 */

import type { SnapshotStats } from "./snapshot.js";

const WINDOW = 200;

interface Sample {
  ts: number;
  value: number;
}

interface Series {
  samples: Sample[];
}

const series = new Map<string, Series>();

function record(metric: string, value: number): void {
  let s = series.get(metric);
  if (!s) {
    s = { samples: [] };
    series.set(metric, s);
  }
  s.samples.push({ ts: Date.now(), value });
  if (s.samples.length > WINDOW) {
    s.samples.splice(0, s.samples.length - WINDOW);
  }
}

function summarize(metric: string): {
  count: number;
  last: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
} {
  const s = series.get(metric);
  if (!s || s.samples.length === 0) {
    return { count: 0, last: null, min: null, max: null, p50: null, p95: null };
  }
  const values = s.samples.map((x) => x.value).sort((a, b) => a - b);
  const last = s.samples[s.samples.length - 1].value;
  const pick = (p: number): number => {
    const idx = Math.min(values.length - 1, Math.floor(p * values.length));
    return values[idx];
  };
  return {
    count: values.length,
    last,
    min: values[0],
    max: values[values.length - 1],
    p50: pick(0.5),
    p95: pick(0.95),
  };
}

/* ------------------------------------------------------------------ */
/*  Producers                                                         */
/* ------------------------------------------------------------------ */

export function recordSnapshotMetrics(stats: SnapshotStats): void {
  record("snapshot.build_ms", stats.build_ms);
  record("snapshot.bytes", stats.bytes_uncompressed);
  record("snapshot.node_count", stats.node_count);
  record("snapshot.edge_count", stats.edge_count);
}

/** Time a route handler; records `<name>.latency_ms`. */
export async function timeRoute<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    record(`${name}.latency_ms`, Math.round(performance.now() - t0));
  }
}

/** Accept a client metrics batch from the SPA. Permissive shape. */
export function recordClientMetrics(
  batch: Record<string, unknown>,
): { accepted: number } {
  let accepted = 0;
  if (!batch || typeof batch !== "object") return { accepted };
  for (const [k, v] of Object.entries(batch)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      record(`client.${k}`, v);
      accepted++;
    }
  }
  return { accepted };
}

/* ------------------------------------------------------------------ */
/*  Read API                                                          */
/* ------------------------------------------------------------------ */

export interface MetricsView {
  generated_at: string;
  window: number;
  metrics: Record<string, ReturnType<typeof summarize>>;
}

export function getMetricsView(): MetricsView {
  const out: Record<string, ReturnType<typeof summarize>> = {};
  for (const name of series.keys()) {
    out[name] = summarize(name);
  }
  return {
    generated_at: new Date().toISOString(),
    window: WINDOW,
    metrics: out,
  };
}

/** Test-only: drop all samples. */
export function resetMetricsForTest(): void {
  series.clear();
}
