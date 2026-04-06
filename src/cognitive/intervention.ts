/**
 * DreamGraph Intervention Engine — From Insight to Action
 *
 * Bridges the gap from "awareness" to "remedy" by generating
 * concrete remediation plans from high-urgency validated tensions.
 *
 * Each plan contains:
 *   - Ordered steps (what to change, where)
 *   - File-level change descriptions
 *   - Test suggestions
 *   - Effort estimates
 *   - ADR conflict checks
 *   - Predicted new tensions the change may create
 *
 * Philosophy: DreamGraph should not only SEE problems — it should
 * propose the first credible fix, so the developer can say "yes" or "refine".
 *
 * READ-ONLY: generates plans from data, writes nothing.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dataPath } from "../utils/paths.js";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import type {
  TensionSignal,
  RemediationStep,
  RemediationPlan,
  RemediationPlanOutput,
  FileChange,
} from "./types.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Load ADR log to check for conflicts.
 */
async function loadAdrLog(): Promise<Array<{ id: string; title: string; status: string; decision: string }>> {
  try {
    const p = dataPath("adr_log.json");
    if (!existsSync(p)) return [];
    const raw = await readFile(p, "utf-8");
    const data = JSON.parse(raw);
    return data?.decisions ?? data?.adrs ?? data?.entries ?? [];
  } catch {
    return [];
  }
}

/**
 * Build remediation strategy based on tension type and domain.
 * Strategy selection uses the *actual* TensionSignal type union.
 */
function strategyForTension(tension: TensionSignal): {
  approach: string;
  steps: RemediationStep[];
} {
  const entities = tension.entities;

  switch (tension.type) {
    case "missing_link":
      return missingLinkRemediation(tension, entities);
    case "weak_connection":
      return weakConnectionRemediation(tension, entities);
    case "hard_query":
      return hardQueryRemediation(tension, entities);
    case "ungrounded_dream":
      return ungroundedDreamRemediation(tension, entities);
    case "code_insight":
      return codeInsightRemediation(tension, entities);
    default:
      return genericRemediation(tension, entities);
  }
}

function missingLinkRemediation(
  t: TensionSignal,
  entities: string[]
): { approach: string; steps: RemediationStep[] } {
  const steps: RemediationStep[] = [];

  steps.push({
    order: 1,
    description: `Analyze why "${entities.join('" and "')}" lack a connection — is this intentional isolation or an oversight?`,
    files: entities.map((e: string) => ({
      file_path: inferFilePath(e),
      description: `Review interface of ${e} for missing integration points`,
      change_type: "modify" as const,
      rationale: "Determine if a connection should exist and where the integration point belongs",
    })),
    tests_to_add: [`test_${sanitize(entities.join("_"))}_integration`],
    estimated_effort: "small",
  });

  if (entities.length >= 2) {
    steps.push({
      order: 2,
      description: "Implement connection layer if analysis confirms it is needed",
      files: [{
        file_path: inferFilePath(entities[0]),
        description: `Add integration with ${entities[1] ?? "target"} via shared interface`,
        change_type: "modify" as const,
        rationale: t.description,
      }],
      tests_to_add: [`test_${sanitize(entities.join("_"))}_data_flow`],
      estimated_effort: "medium",
    });
  }

  return { approach: `Add missing link between ${entities.join(" ↔ ")}`, steps };
}

function weakConnectionRemediation(
  t: TensionSignal,
  entities: string[]
): { approach: string; steps: RemediationStep[] } {
  return {
    approach: `Strengthen weak connection in ${t.domain} domain`,
    steps: [{
      order: 1,
      description: `Investigate weak connection: ${t.description}`,
      files: entities.map((e: string) => ({
        file_path: inferFilePath(e),
        description: `Review ${e} for potential strengthening — add explicit references, shared types, or integration tests`,
        change_type: "modify" as const,
        rationale: t.description,
      })),
      tests_to_add: [`test_${sanitize(entities[0] ?? "unknown")}_connection_strength`],
      estimated_effort: "small",
    }],
  };
}

function hardQueryRemediation(
  t: TensionSignal,
  entities: string[]
): { approach: string; steps: RemediationStep[] } {
  return {
    approach: `Resolve hard-to-answer query in ${t.domain} domain`,
    steps: [
      {
        order: 1,
        description: `Add explicit documentation or API surface for: ${t.description}`,
        files: entities.map((e: string) => ({
          file_path: inferFilePath(e),
          description: `Add clearer documentation or public API to ${e}`,
          change_type: "modify" as const,
          rationale: "Hard queries indicate missing or implicit knowledge that should be explicit",
        })),
        tests_to_add: [],
        estimated_effort: "trivial",
      },
      {
        order: 2,
        description: "Consider creating an index or lookup table if the query is common",
        files: [{
          file_path: `data/${sanitize(t.domain)}_index.json`,
          description: "Create a structured index to make this query trivial in the future",
          change_type: "create" as const,
          rationale: t.description,
        }],
        tests_to_add: [`test_${sanitize(t.domain)}_query_resolved`],
        estimated_effort: "small",
      },
    ],
  };
}

function ungroundedDreamRemediation(
  t: TensionSignal,
  entities: string[]
): { approach: string; steps: RemediationStep[] } {
  return {
    approach: `Ground unverified speculation about ${entities.join(", ")}`,
    steps: [{
      order: 1,
      description: `Verify through code reading or DB query: ${t.description}`,
      files: entities.map((e: string) => ({
        file_path: inferFilePath(e),
        description: `Read source code for ${e} to confirm or deny the speculation`,
        change_type: "modify" as const,
        rationale: "Ungrounded dreams need evidence — either confirm and strengthen, or reject",
      })),
      tests_to_add: [`test_${sanitize(entities[0] ?? "unknown")}_behavior_matches_expectation`],
      estimated_effort: "small",
    }],
  };
}

function codeInsightRemediation(
  t: TensionSignal,
  entities: string[]
): { approach: string; steps: RemediationStep[] } {
  return {
    approach: `Act on code insight: ${t.description.slice(0, 80)}`,
    steps: [{
      order: 1,
      description: `Apply code-level improvement: ${t.description}`,
      files: entities.map((e: string) => ({
        file_path: inferFilePath(e),
        description: `Apply targeted fix to ${e} based on code analysis`,
        change_type: "modify" as const,
        rationale: t.description,
      })),
      tests_to_add: [`test_${sanitize(entities[0] ?? "unknown")}_improved`],
      estimated_effort: "medium",
    }],
  };
}

function genericRemediation(
  t: TensionSignal,
  entities: string[]
): { approach: string; steps: RemediationStep[] } {
  return {
    approach: `Address "${t.type}" tension in ${t.domain} domain`,
    steps: [{
      order: 1,
      description: `Investigate and resolve: ${t.description}`,
      files: entities.map((e: string) => ({
        file_path: inferFilePath(e),
        description: `Review and update ${e}`,
        change_type: "modify" as const,
        rationale: t.description,
      })),
      tests_to_add: [`test_${sanitize(t.type)}_resolved`],
      estimated_effort: "medium",
    }],
  };
}

/** Sanitize a string for use in identifiers */
function sanitize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/**
 * Infer a likely file path from an entity name.
 * Best-effort heuristic.
 */
function inferFilePath(entity: string): string {
  const name = sanitize(entity);
  return `src/${name}.ts`;
}

/**
 * Check if a remediation plan conflicts with any existing ADRs.
 */
function findAdrConflicts(
  steps: RemediationStep[],
  adrs: Array<{ id: string; title: string; status: string; decision: string }>
): string[] {
  const conflicts: string[] = [];

  for (const adr of adrs) {
    if (adr.status !== "accepted" && adr.status !== "active") continue;

    for (const step of steps) {
      for (const file of step.files) {
        const fileLower = file.file_path.toLowerCase();
        const titleLower = adr.title.toLowerCase();
        const decisionLower = (adr.decision ?? "").toLowerCase();

        const keywords = fileLower.split("/").pop()?.split("_") ?? [];
        const matches = keywords.some(
          (kw: string) =>
            kw.length > 3 &&
            (titleLower.includes(kw) || decisionLower.includes(kw))
        );

        if (matches) {
          conflicts.push(
            `ADR ${adr.id}: "${adr.title}" may be affected by changes to ${file.file_path}`
          );
        }
      }
    }
  }

  return [...new Set(conflicts)];
}

/**
 * Predict new tensions that a remediation might introduce.
 */
function predictNewTensions(
  tension: TensionSignal,
  steps: RemediationStep[]
): string[] {
  const predictions: string[] = [];

  const fileCount = steps.reduce((sum, s) => sum + s.files.length, 0);
  if (fileCount > 5) {
    predictions.push(
      "Large change footprint may introduce new structural coupling tensions"
    );
  }

  const hasNewFiles = steps.some((s) => s.files.some((f) => f.change_type === "create"));
  if (hasNewFiles) {
    predictions.push(
      "New files may need to be integrated into existing build/test pipelines"
    );
  }

  if (tension.type === "missing_link" && tension.entities.length > 2) {
    predictions.push(
      "Connecting multiple entities may create new dependency chains"
    );
  }

  return predictions;
}

/**
 * Compute a confidence score for the remediation plan.
 */
function computeConfidence(tension: TensionSignal, steps: RemediationStep[]): number {
  let confidence = 0.5;

  confidence += tension.urgency * 0.2;

  if (tension.entities.length >= 2) confidence += 0.1;
  if (tension.occurrences > 1) confidence += 0.05;

  const hasTests = steps.some((s) => s.tests_to_add.length > 0);
  if (hasTests) confidence += 0.1;

  if (steps.length > 5) confidence -= 0.1;

  return Math.max(0.1, Math.min(1.0, confidence));
}

function severityFromUrgency(urgency: number): "critical" | "high" | "medium" | "low" {
  if (urgency >= 0.8) return "critical";
  if (urgency >= 0.6) return "high";
  if (urgency >= 0.3) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate remediation plans for the top N highest-urgency unresolved tensions.
 *
 * @param maxPlans Maximum number of plans to generate (default: 5)
 * @param minUrgency Minimum urgency threshold (default: 0.3)
 */
export async function generateRemediationPlans(
  maxPlans: number = 5,
  minUrgency: number = 0.3
): Promise<RemediationPlanOutput> {
  logger.info(`Generating remediation plans (max=${maxPlans}, minUrgency=${minUrgency})`);

  const [tensionFile, adrs] = await Promise.all([
    engine.loadTensions(),
    loadAdrLog(),
  ]);

  const allUnresolved = tensionFile.signals.filter((t) => !t.resolved);
  const candidates = allUnresolved
    .filter((t) => t.urgency >= minUrgency)
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, maxPlans);

  const skippedCount = allUnresolved.length - candidates.length;

  if (candidates.length === 0) {
    logger.info("No tensions above urgency threshold — nothing to remediate");
    return {
      plans: [],
      total_tensions_analyzed: allUnresolved.length,
      plans_generated: 0,
      skipped_low_urgency: skippedCount,
      timestamp: new Date().toISOString(),
    };
  }

  const plans: RemediationPlan[] = [];

  for (const tension of candidates) {
    const { approach, steps } = strategyForTension(tension);
    const adrConflicts = findAdrConflicts(steps, adrs);
    const predictedTensions = predictNewTensions(tension, steps);
    const confidence = computeConfidence(tension, steps);

    plans.push({
      id: `rem_${tension.id}_${Date.now().toString(36)}`,
      tension_id: tension.id,
      title: approach,
      severity: severityFromUrgency(tension.urgency),
      steps,
      adr_conflicts: adrConflicts,
      new_tensions_predicted: predictedTensions,
      confidence,
      generated_at: new Date().toISOString(),
    });
  }

  const severityCounts = {
    critical: plans.filter((p) => p.severity === "critical").length,
    high: plans.filter((p) => p.severity === "high").length,
    medium: plans.filter((p) => p.severity === "medium").length,
    low: plans.filter((p) => p.severity === "low").length,
  };

  logger.info(
    `Generated ${plans.length} remediation plans ` +
    `(${severityCounts.critical} critical, ${severityCounts.high} high, ` +
    `${severityCounts.medium} medium, ${severityCounts.low} low)`
  );

  return {
    plans,
    total_tensions_analyzed: allUnresolved.length,
    plans_generated: plans.length,
    skipped_low_urgency: skippedCount,
    timestamp: new Date().toISOString(),
  };
}
