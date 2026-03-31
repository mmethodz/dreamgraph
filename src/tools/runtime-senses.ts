/**
 * DreamGraph Embodied Senses — Runtime Awareness
 *
 * Bridges the gap between "what the code says" and "what actually happens".
 * Connects to external metrics endpoints (OpenTelemetry, Prometheus, or
 * custom JSON) to ingest real-time runtime observations.
 *
 * Capabilities:
 *   - Fetch and normalize runtime metrics per entity
 *   - Detect behavioral correlations (sequential usage, error cascades)
 *   - Rank features by actual usage (dead feature detection)
 *   - Identify error hotspots
 *   - Weight tensions by real-world impact
 *
 * Configuration:
 *   DREAMGRAPH_RUNTIME_ENDPOINT — URL for metrics endpoint
 *   DREAMGRAPH_RUNTIME_TYPE — "opentelemetry" | "prometheus" | "custom_json"
 *
 * The tool gracefully degrades when no endpoint is configured,
 * returning empty results.
 *
 * READ-ONLY: only reads from the network and knowledge graph.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadJsonData } from "../utils/cache.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { Feature } from "../types/index.js";
import type {
  RuntimeMetricConfig,
  RuntimeObservation,
  BehavioralCorrelation,
  RuntimeInsightsOutput,
  ToolResponse,
} from "../types/index.js";
import { DEFAULT_RUNTIME_CONFIG } from "../cognitive/types.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getRuntimeConfig(): RuntimeMetricConfig {
  return {
    endpoint: process.env.DREAMGRAPH_RUNTIME_ENDPOINT,
    type: (process.env.DREAMGRAPH_RUNTIME_TYPE as RuntimeMetricConfig["type"]) ?? DEFAULT_RUNTIME_CONFIG.type,
    timeout_ms: parseInt(process.env.DREAMGRAPH_RUNTIME_TIMEOUT ?? "5000", 10),
  };
}

// ---------------------------------------------------------------------------
// Metrics Fetching
// ---------------------------------------------------------------------------

interface RawMetrics {
  [entityId: string]: {
    request_count?: number;
    error_rate?: number;
    latency_p99?: number;
    throughput?: number;
    memory_usage?: number;
  };
}

/**
 * Fetch metrics from the configured endpoint.
 * Returns null if no endpoint is configured or fetch fails.
 */
async function fetchMetrics(): Promise<RawMetrics | null> {
  const config = getRuntimeConfig();
  if (!config.endpoint) {
    logger.debug("No runtime metrics endpoint configured");
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeout_ms);

    const response = await fetch(config.endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`Runtime metrics fetch failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const body = await response.json();

    // Handle different formats
    if (config.type === "prometheus") {
      return parsePrometheusMetrics(body);
    } else if (config.type === "opentelemetry") {
      return parseOtelMetrics(body);
    } else {
      // custom_json: expect the format directly
      return body as RawMetrics;
    }
  } catch (err) {
    logger.warn(`Runtime metrics fetch error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Parse Prometheus-style metrics into our standard format.
 * Expects JSON query result format.
 */
function parsePrometheusMetrics(body: unknown): RawMetrics {
  const metrics: RawMetrics = {};
  // Simplified: expect an array of {metric: {entity}, value}
  if (Array.isArray(body)) {
    for (const item of body) {
      const entity = item?.metric?.entity ?? item?.metric?.feature ?? item?.labels?.entity;
      if (entity) {
        metrics[entity] = {
          request_count: parseFloat(item.value?.[1] ?? item.value ?? "0"),
        };
      }
    }
  }
  return metrics;
}

/**
 * Parse OpenTelemetry OTLP JSON metrics.
 */
function parseOtelMetrics(body: unknown): RawMetrics {
  const metrics: RawMetrics = {};
  const data = body as Record<string, unknown>;

  // Traverse resourceMetrics → scopeMetrics → metrics → dataPoints
  const resourceMetrics = (data.resourceMetrics ?? []) as Array<Record<string, unknown>>;
  for (const rm of resourceMetrics) {
    const scopeMetrics = (rm.scopeMetrics ?? []) as Array<Record<string, unknown>>;
    for (const sm of scopeMetrics) {
      const metricList = (sm.metrics ?? []) as Array<Record<string, unknown>>;
      for (const metric of metricList) {
        const name = metric.name as string;
        const dataPoints = (
          (metric.sum as Record<string, unknown>)?.dataPoints ??
          (metric.gauge as Record<string, unknown>)?.dataPoints ??
          []
        ) as Array<Record<string, unknown>>;

        for (const dp of dataPoints) {
          const attrs = (dp.attributes ?? []) as Array<{ key: string; value: { stringValue?: string } }>;
          const entityAttr = attrs.find((a) => a.key === "entity" || a.key === "feature");
          if (!entityAttr) continue;

          const entityId = entityAttr.value?.stringValue ?? "";
          if (!entityId) continue;

          if (!metrics[entityId]) metrics[entityId] = {};
          const val = (dp.asDouble ?? dp.asInt ?? 0) as number;

          if (name.includes("request") || name.includes("count")) {
            metrics[entityId].request_count = val;
          } else if (name.includes("error")) {
            metrics[entityId].error_rate = val;
          } else if (name.includes("latency") || name.includes("duration")) {
            metrics[entityId].latency_p99 = val;
          } else if (name.includes("throughput")) {
            metrics[entityId].throughput = val;
          } else if (name.includes("memory")) {
            metrics[entityId].memory_usage = val;
          }
        }
      }
    }
  }
  return metrics;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Convert raw metrics to observations and derive correlations.
 */
async function analyzeRuntime(raw: RawMetrics): Promise<{
  observations: RuntimeObservation[];
  correlations: BehavioralCorrelation[];
  usage_ranking: Array<{ entity: string; usage_score: number }>;
  dead_features: string[];
  error_hotspots: Array<{ entity: string; error_rate: number }>;
}> {
  const observations: RuntimeObservation[] = [];
  const now = new Date().toISOString();

  // Convert to observations
  for (const [entityId, metrics] of Object.entries(raw)) {
    if (metrics.request_count !== undefined) {
      observations.push({
        entity_id: entityId,
        metric_type: "request_count",
        value: metrics.request_count,
        unit: "requests",
        observed_at: now,
      });
    }
    if (metrics.error_rate !== undefined) {
      observations.push({
        entity_id: entityId,
        metric_type: "error_rate",
        value: metrics.error_rate,
        unit: "percent",
        observed_at: now,
      });
    }
    if (metrics.latency_p99 !== undefined) {
      observations.push({
        entity_id: entityId,
        metric_type: "latency_p99",
        value: metrics.latency_p99,
        unit: "ms",
        observed_at: now,
      });
    }
    if (metrics.throughput !== undefined) {
      observations.push({
        entity_id: entityId,
        metric_type: "throughput",
        value: metrics.throughput,
        unit: "ops/sec",
        observed_at: now,
      });
    }
    if (metrics.memory_usage !== undefined) {
      observations.push({
        entity_id: entityId,
        metric_type: "memory_usage",
        value: metrics.memory_usage,
        unit: "bytes",
        observed_at: now,
      });
    }
  }

  // Usage ranking by request count
  const usage_ranking = Object.entries(raw)
    .filter(([, m]) => m.request_count !== undefined)
    .map(([entity, m]) => ({
      entity,
      usage_score: m.request_count ?? 0,
    }))
    .sort((a, b) => b.usage_score - a.usage_score);

  // Dead features: known features with zero or near-zero usage
  const features = await loadJsonData<Feature[]>("features.json");
  const featureIds = new Set(features.map((f) => f.id));
  const activeEntities = new Set(
    Object.entries(raw)
      .filter(([, m]) => (m.request_count ?? 0) > 0)
      .map(([id]) => id)
  );
  const dead_features = [...featureIds].filter((id) => !activeEntities.has(id));

  // Error hotspots
  const error_hotspots = Object.entries(raw)
    .filter(([, m]) => (m.error_rate ?? 0) > 0.01)
    .map(([entity, m]) => ({
      entity,
      error_rate: m.error_rate ?? 0,
    }))
    .sort((a, b) => b.error_rate - a.error_rate);

  // Behavioral correlations: find entities with correlated error patterns
  const correlations: BehavioralCorrelation[] = [];
  const errorEntities = Object.entries(raw)
    .filter(([, m]) => (m.error_rate ?? 0) > 0)
    .map(([id, m]) => ({ id, rate: m.error_rate ?? 0 }));

  for (let i = 0; i < errorEntities.length; i++) {
    for (let j = i + 1; j < errorEntities.length; j++) {
      const a = errorEntities[i];
      const b = errorEntities[j];
      // Simple correlation: both have errors above threshold
      if (a.rate > 0.01 && b.rate > 0.01) {
        const similarity = 1 - Math.abs(a.rate - b.rate) / Math.max(a.rate, b.rate);
        if (similarity > 0.5) {
          correlations.push({
            entities: [a.id, b.id],
            correlation_type: "error_cascade",
            strength: Math.round(similarity * 100) / 100,
            sample_size: 1,
            description: `"${a.id}" (${(a.rate * 100).toFixed(1)}% errors) and "${b.id}" (${(b.rate * 100).toFixed(1)}% errors) show correlated error patterns`,
          });
        }
      }
    }
  }

  // Co-occurrence: entities with similar request patterns
  const requestEntities = Object.entries(raw)
    .filter(([, m]) => (m.request_count ?? 0) > 0)
    .map(([id, m]) => ({ id, count: m.request_count ?? 0 }))
    .sort((a, b) => b.count - a.count);

  for (let i = 0; i < Math.min(requestEntities.length, 10); i++) {
    for (let j = i + 1; j < Math.min(requestEntities.length, 10); j++) {
      const a = requestEntities[i];
      const b = requestEntities[j];
      const ratio = Math.min(a.count, b.count) / Math.max(a.count, b.count);
      if (ratio > 0.7) {
        correlations.push({
          entities: [a.id, b.id],
          correlation_type: "co_occurrence",
          strength: Math.round(ratio * 100) / 100,
          sample_size: Math.min(a.count, b.count),
          description: `"${a.id}" (${a.count} requests) and "${b.id}" (${b.count} requests) have similar usage volume`,
        });
      }
    }
  }

  return { observations, correlations, usage_ranking, dead_features, error_hotspots };
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

export function registerRuntimeSensesTools(server: McpServer): void {
  server.tool(
    "query_runtime_metrics",
    "Query runtime metrics from the configured observability endpoint. " +
    "Returns per-entity request counts, error rates, latency, throughput, " +
    "behavioral correlations, dead feature detection, and error hotspots. " +
    "Requires DREAMGRAPH_RUNTIME_ENDPOINT env var. Without it, returns " +
    "a descriptive empty result explaining what data would be available.",
    {
      entity_filter: z
        .string()
        .optional()
        .describe("Filter metrics to a specific entity ID. Leave empty for all."),
      include_correlations: z
        .boolean()
        .optional()
        .describe("Whether to include behavioral correlation analysis (default: true)."),
    },
    async ({ entity_filter, include_correlations }) => {
      const includeCorr = include_correlations ?? true;

      logger.debug(
        `query_runtime_metrics called: entity=${entity_filter ?? "all"}, correlations=${includeCorr}`
      );

      const result = await safeExecute<RuntimeInsightsOutput>(async () => {
        const config = getRuntimeConfig();
        const raw = await fetchMetrics();

        if (!raw) {
          // Graceful degradation
          return success<RuntimeInsightsOutput>({
            observations: [],
            correlations: [],
            feature_usage_ranking: [],
            dead_features: [],
            error_hotspots: [],
            source: config.endpoint
              ? `${config.type} endpoint (unreachable: ${config.endpoint})`
              : "No endpoint configured (set DREAMGRAPH_RUNTIME_ENDPOINT)",
            timestamp: new Date().toISOString(),
          });
        }

        // Filter if entity specified
        const filtered = entity_filter
          ? Object.fromEntries(
              Object.entries(raw).filter(([id]) => id === entity_filter)
            )
          : raw;

        const analysis = await analyzeRuntime(filtered);

        return success<RuntimeInsightsOutput>({
          observations: analysis.observations,
          correlations: includeCorr ? analysis.correlations : [],
          feature_usage_ranking: analysis.usage_ranking.slice(0, 20),
          dead_features: analysis.dead_features,
          error_hotspots: analysis.error_hotspots.slice(0, 10),
          source: `${config.type} endpoint (${config.endpoint})`,
          timestamp: new Date().toISOString(),
        });
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 1 runtime-senses tool");
}
