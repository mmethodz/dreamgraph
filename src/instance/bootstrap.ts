/**
 * DreamGraph v7.0 "El Alarife" — Instance Bootstrap Utilities
 *
 * Provides helpers used by scan_project to perform first-scan bootstrapping:
 *   1. Detect whether the instance has been scanned yet (isFreshInstance)
 *   2. Discover and record Architecture Decision Records via LLM
 *   3. Schedule follow-up dream cycles
 *
 * These are NOT triggered automatically on daemon start — the user must
 * configure their LLM provider first, then run `dg scan <instance>`.
 * The scan_project tool calls discoverAndRecordADRs() and
 * scheduleFollowUpDreams() as Phase 4 and Phase 5 of the scan pipeline.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { config } from "../config/config.js";
import { dataPath } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { loadJsonArray } from "../utils/cache.js";
import { getActiveScope } from "./lifecycle.js";
import { runScanProject } from "../tools/scan-project.js";
import { recordADR, getADRCount } from "../tools/adr-historian.js";
import { createSchedule } from "../cognitive/scheduler.js";
import { getLlmProvider, getDreamerLlmConfig, isLlmAvailable } from "../cognitive/llm.js";
import type { LlmMessage } from "../cognitive/llm.js";
import type { Feature, Workflow, DataModelEntity } from "../types/index.js";

// ---------------------------------------------------------------------------
// Fresh instance detection
// ---------------------------------------------------------------------------

/**
 * Check whether the seed data files still contain only template stubs.
 * Template stubs have `_schema` and `_note` fields — real seed data has
 * `id` and `name` fields.  If features.json is still a template, the
 * instance has never been scanned.
 */
export async function isFreshInstance(): Promise<boolean> {
  try {
    const featuresPath = dataPath("features.json");
    if (!existsSync(featuresPath)) return true; // no data at all

    const raw = await readFile(featuresPath, "utf-8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return true;
    if (arr.length === 0) return true;

    // Template stubs have _schema / _note but no real entity id
    const hasOnlyStubs = arr.every(
      (entry: Record<string, unknown>) =>
        entry._schema !== undefined || entry._note !== undefined,
    );
    return hasOnlyStubs;
  } catch {
    // If we can't read features.json, treat it as fresh
    return true;
  }
}

// ---------------------------------------------------------------------------
// ADR discovery via LLM
// ---------------------------------------------------------------------------

/** Compact summary of an entity for the LLM prompt */
function summarizeFeature(f: Feature): string {
  return `- [feature] ${f.id}: ${f.name} — ${f.description?.slice(0, 120) ?? ""} (domain: ${f.domain ?? "?"}, keywords: ${(f.keywords ?? []).join(", ")})`;
}

function summarizeWorkflow(w: Workflow): string {
  const stepCount = w.steps?.length ?? 0;
  return `- [workflow] ${w.id}: ${w.name} — ${w.description?.slice(0, 120) ?? ""} (trigger: ${w.trigger ?? "?"}, ${stepCount} steps)`;
}

function summarizeDataModel(d: DataModelEntity): string {
  const fields = (d.key_fields ?? []).map((f) => f.name).join(", ");
  const rels = (d.relationships ?? []).map((r) => `${r.type}→${r.target}`).join(", ");
  return `- [data_model] ${d.id}: ${d.name} — storage: ${d.storage ?? "?"}, fields: [${fields}], relations: [${rels}]`;
}

/** Build the LLM prompt that discovers ADRs from seed data */
function buildADRDiscoveryPrompt(
  features: Feature[],
  workflows: Workflow[],
  dataModels: DataModelEntity[],
  repoName: string,
): LlmMessage[] {
  const entitySummary = [
    `## Features (${features.length})`,
    ...features.map(summarizeFeature),
    "",
    `## Workflows (${workflows.length})`,
    ...workflows.map(summarizeWorkflow),
    "",
    `## Data Models (${dataModels.length})`,
    ...dataModels.map(summarizeDataModel),
  ].join("\n");

  return [
    {
      role: "system" as const,
      content: `You are a senior software architect performing an initial architecture review.
Given a project's features, workflows, and data models, identify the IMPLICIT architecture decisions that are embedded in the design.

Look for:
1. **Technology boundaries** — e.g. "X is a data format boundary, not a runtime dependency"
2. **Security decisions** — e.g. "API key auth is mandatory for internal routes"
3. **Data storage choices** — e.g. "All transactional data uses Supabase, config uses JSON files"
4. **Architectural patterns** — e.g. "Server-side rendering via Next.js for all pages"
5. **Integration patterns** — e.g. "Webhook-based async integration with external services"
6. **Domain boundaries** — e.g. "Invoice processing is isolated from user management"
7. **UI patterns** — e.g. "All data tables use a shared DataGrid component"

For each decision, provide the FULL ADR structure. Be specific with affected_entities — use the actual entity IDs from the data provided.

Respond with a JSON array of ADR objects. Each object must have:
{
  "title": "Short descriptive title",
  "problem": "Why this decision exists",
  "constraints": ["constraint1", "constraint2"],
  "affected_entities": ["entity_id_1", "entity_id_2"],
  "chosen": "What was chosen",
  "alternatives": [{"option": "alt", "rejected_because": "reason"}],
  "expected_consequences": ["consequence1"],
  "risks": ["risk1"],
  "guard_rails": ["Do NOT change X without reviewing this ADR"],
  "tags": ["tag1", "tag2"]
}

Aim for 5-15 ADRs depending on project complexity. Focus on the most architecturally significant decisions.
Only output the JSON array. No markdown, no explanation.`,
    },
    {
      role: "user" as const,
      content: `Project: "${repoName}"\n\n${entitySummary}`,
    },
  ];
}

/** Parse the LLM response and extract ADR objects */
function parseADRResponse(text: string): Record<string, unknown>[] {
  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter((e) => e && typeof e === "object");

    // Object wrapper: find first array value
    if (parsed && typeof parsed === "object") {
      for (const val of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(val) && val.length > 0)
          return val.filter((e) => e && typeof e === "object");
      }
    }
  } catch {
    // Try extracting the largest JSON array
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const arr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(arr)) return arr.filter((e) => e && typeof e === "object");
      } catch { /* give up */ }
    }
  }
  return [];
}

/** Ensure value is a non-empty string array */
function ensureStrArr(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v) => typeof v === "string" && v.length > 0);
  return [];
}

/**
 * Discover architecture decisions from seed data using the LLM,
 * then record each one via the ADR historian.
 */
export async function discoverAndRecordADRs(repoName: string): Promise<number> {
  const llmOk = await isLlmAvailable();
  if (!llmOk) {
    logger.info("[bootstrap] LLM unavailable — skipping ADR discovery");
    return 0;
  }

  // Load freshly created seed data
  const features = (await loadJsonArray<Feature>("features.json")).filter(
    (f) => f.id && !("_schema" in (f as unknown as Record<string, unknown>)),
  );
  const workflows = (await loadJsonArray<Workflow>("workflows.json")).filter(
    (w) => w.id && !("_schema" in (w as unknown as Record<string, unknown>)),
  );
  const dataModels = (await loadJsonArray<DataModelEntity>("data_model.json")).filter(
    (d) => d.id && !("_schema" in (d as unknown as Record<string, unknown>)),
  );

  if (features.length === 0 && workflows.length === 0 && dataModels.length === 0) {
    logger.info("[bootstrap] No seed data — skipping ADR discovery");
    return 0;
  }

  // Build valid entity ID set for filtering
  const validEntityIds = new Set([
    ...features.map((f) => f.id),
    ...workflows.map((w) => w.id),
    ...dataModels.map((d) => d.id),
  ]);

  logger.info(
    `[bootstrap] ADR discovery: ${features.length} features, ${workflows.length} workflows, ${dataModels.length} data models`,
  );

  const messages = buildADRDiscoveryPrompt(features, workflows, dataModels, repoName);
  const dreamerCfg = getDreamerLlmConfig();
  const llm = getLlmProvider();

  const response = await llm.complete(messages, {
    model: dreamerCfg.model,
    temperature: 0.3,
    maxTokens: dreamerCfg.maxTokens,
    jsonMode: true,
  });

  const rawADRs = parseADRResponse(response.text);
  if (rawADRs.length === 0) {
    logger.warn("[bootstrap] LLM returned no parseable ADRs");
    return 0;
  }

  logger.info(`[bootstrap] LLM proposed ${rawADRs.length} ADRs — recording…`);

  let recorded = 0;
  for (const raw of rawADRs) {
    try {
      const title = typeof raw.title === "string" ? raw.title : "";
      const problem = typeof raw.problem === "string" ? raw.problem : "";
      const chosen = typeof raw.chosen === "string" ? raw.chosen : "";

      if (!title || !chosen) {
        logger.debug(`[bootstrap] Skipping ADR with missing title or chosen: ${JSON.stringify(raw).slice(0, 200)}`);
        continue;
      }

      // Filter affected_entities to only valid IDs
      const affected = ensureStrArr(raw.affected_entities).filter((id) => validEntityIds.has(id));
      if (affected.length === 0) {
        // If LLM used names instead of IDs, try fuzzy match
        const rawEntities = ensureStrArr(raw.affected_entities);
        for (const rawId of rawEntities) {
          const lower = rawId.toLowerCase().replace(/[^a-z0-9]/g, "_");
          for (const valid of validEntityIds) {
            if (valid.includes(lower) || lower.includes(valid)) {
              affected.push(valid);
              break;
            }
          }
        }
      }

      const adr = await recordADR({
        title,
        decided_by: "system",
        problem,
        constraints: ensureStrArr(raw.constraints),
        affected_entities: affected.length > 0 ? affected : ["(project-wide)"],
        chosen,
        alternatives: Array.isArray(raw.alternatives)
          ? raw.alternatives
              .filter((a: unknown) => a && typeof a === "object")
              .map((a: Record<string, unknown>) => ({
                option: String(a.option ?? ""),
                rejected_because: String(a.rejected_because ?? ""),
              }))
          : [],
        expected_consequences: ensureStrArr(raw.expected_consequences),
        risks: ensureStrArr(raw.risks),
        guard_rails: ensureStrArr(raw.guard_rails),
        tags: [...ensureStrArr(raw.tags), "auto-discovered", "bootstrap"],
      });

      if (adr) recorded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[bootstrap] Failed to record ADR: ${msg}`);
    }
  }

  return recorded;
}

// ---------------------------------------------------------------------------
// Follow-up dream schedule
// ---------------------------------------------------------------------------

/**
 * Schedule 5 dream cycles at 5-minute intervals, strategy "all".
 * Uses the existing scheduler infrastructure.
 */
export async function scheduleFollowUpDreams(): Promise<void> {
  try {
    const schedule = await createSchedule({
      name: "bootstrap_follow_up_dreams",
      action: "dream_cycle",
      parameters: { strategy: "all", max_dreams: 100 },
      trigger_type: "interval",
      interval_ms: 5 * 60 * 1000, // 5 minutes
      max_runs: 5,
      enabled: true,
    });
    logger.info(
      `[bootstrap] Scheduled 5 follow-up dream cycles at 5-min intervals (${schedule.id})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[bootstrap] Failed to schedule follow-up dreams: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Main bootstrap entry point
// ---------------------------------------------------------------------------

/**
 * Legacy bootstrap entry point — retained for programmatic use.
 *
 * In v7.0+, this is NOT called automatically on daemon start.
 * Users must configure LLM settings first, then run `dg scan <instance>`.
 * The scan_project tool handles ADR discovery and follow-up scheduling
 * as Phase 4 and Phase 5.
 */
export async function bootstrapNewInstance(): Promise<void> {
  // Must have repos configured — otherwise there's nothing to scan
  const repoCount = Object.keys(config.repos).length;
  if (repoCount === 0) {
    logger.debug("[bootstrap] No repos configured — skipping auto-scan");
    return;
  }

  const fresh = await isFreshInstance();
  if (!fresh) {
    logger.debug("[bootstrap] Instance already has seed data — skipping auto-scan");
    return;
  }

  const scope = getActiveScope();
  const tag = scope ? ` [${scope.uuid.slice(0, 8)}]` : "";
  const repoName = Object.keys(config.repos)[0] ?? "unknown";
  logger.info(`[bootstrap]${tag} Fresh instance detected — starting auto-scan…`);

  try {
    // Phase 1-3: scan + LLM enrichment + auto-dream
    const result = await runScanProject({
      depth: "deep",
      onProgress: (message, step, total) => {
        logger.info(`[bootstrap] [${step}/${total}] ${message}`);
      },
    });

    logger.info(
      `[bootstrap]${tag} Auto-scan complete: ${result.message}`,
    );

    // Phase 4: ADR discovery from seed data
    logger.info(`[bootstrap]${tag} Phase 4 — discovering architecture decisions…`);
    const adrsRecorded = await discoverAndRecordADRs(repoName);
    if (adrsRecorded > 0) {
      const totalADRs = await getADRCount();
      logger.info(
        `[bootstrap]${tag} ADR discovery complete: ${adrsRecorded} decisions recorded (${totalADRs} total)`,
      );
    } else {
      logger.info(`[bootstrap]${tag} No ADRs discovered (LLM unavailable or no seed data)`);
    }

    // Phase 5: Schedule follow-up dreams to deepen the graph
    await scheduleFollowUpDreams();

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[bootstrap]${tag} Auto-scan failed: ${msg}`);
    // Non-fatal — the daemon continues normally, user can scan manually
  }
}
