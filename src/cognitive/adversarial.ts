/**
 * DreamGraph Adversarial Dreaming — NIGHTMARE State
 *
 * A fundamentally new cognitive state where the dreamer actively tries
 * to BREAK the system. Instead of finding connections, it finds attack surfaces.
 *
 * NIGHTMARE state:
 *   - AWAKE → NIGHTMARE → AWAKE
 *   - Produces ThreatEdge artifacts (not DreamEdges)
 *   - Normalizer validates against known vulnerability patterns
 *   - Output: threat tensions scored by severity and blast radius
 *
 * Strategies:
 *   privilege_escalation   — find paths where low-privilege entities
 *                            can reach high-privilege operations
 *   data_leak_path         — trace data flow to find unprotected exits
 *   injection_surface      — identify entities accepting external input
 *                            without validation
 *   missing_validation     — find write paths without guards
 *   broken_access_control  — detect entities missing RLS/auth checks
 *
 * Safety: NIGHTMARE is a thinking state. It cannot modify any files.
 * It only generates threat reports.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJsonData } from "../utils/cache.js";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import type { Feature, Workflow, DataModelEntity } from "../types/index.js";
import type {
  ThreatEdge,
  ThreatSeverity,
  NightmareResult,
  ThreatLogFile,
  AdversarialStrategy,
} from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const projectRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const THREAT_LOG_PATH = resolve(projectRoot, "data", "threat_log.json");

// ---------------------------------------------------------------------------
// Fact Graph Snapshot for Security Analysis
// ---------------------------------------------------------------------------

interface SecurityEntity {
  id: string;
  type: "feature" | "workflow" | "data_model";
  name: string;
  domain: string;
  keywords: string[];
  source_repo: string;
  tags: string[];
  has_auth_refs: boolean;
  has_rls_refs: boolean;
  has_validation_refs: boolean;
  accepts_input: boolean;
  stores_data: boolean;
  links: Array<{
    target: string;
    type: string;
    relationship: string;
    strength: string;
  }>;
}

async function buildSecuritySnapshot(): Promise<Map<string, SecurityEntity>> {
  const [features, workflows, dataModel] = await Promise.all([
    loadJsonData<Feature[]>("features.json"),
    loadJsonData<Workflow[]>("workflows.json"),
    loadJsonData<DataModelEntity[]>("data_model.json"),
  ]);

  const entities = new Map<string, SecurityEntity>();

  for (const f of features) {
    const text = `${f.name} ${f.description} ${(f.tags ?? []).join(" ")} ${(f.keywords ?? []).join(" ")}`.toLowerCase();
    entities.set(f.id, {
      id: f.id,
      type: "feature",
      name: f.name,
      domain: f.domain ?? "",
      keywords: f.keywords ?? [],
      source_repo: f.source_repo,
      tags: f.tags ?? [],
      has_auth_refs: text.match(/auth|jwt|rbac|session|login|password/) !== null,
      has_rls_refs: text.match(/rls|row.level|policy|permission/) !== null,
      has_validation_refs: text.match(/validat|sanitiz|check|constrain/) !== null,
      accepts_input: text.match(/input|form|submit|upload|create|write|post/) !== null,
      stores_data: text.match(/store|save|persist|database|table/) !== null,
      links: (f.links ?? []).map((l) => ({
        target: l.target,
        type: l.type,
        relationship: l.relationship,
        strength: l.strength,
      })),
    });
  }

  for (const w of workflows) {
    const text = `${w.name} ${w.description} ${(w.keywords ?? []).join(" ")}`.toLowerCase();
    entities.set(w.id, {
      id: w.id,
      type: "workflow",
      name: w.name,
      domain: w.domain ?? "",
      keywords: w.keywords ?? [],
      source_repo: w.source_repo,
      tags: [],
      has_auth_refs: text.match(/auth|jwt|rbac|session|login|password/) !== null,
      has_rls_refs: text.match(/rls|row.level|policy|permission/) !== null,
      has_validation_refs: text.match(/validat|sanitiz|check|constrain/) !== null,
      accepts_input: text.match(/trigger|webhook|api|request|receive/) !== null,
      stores_data: text.match(/store|save|persist|update|write/) !== null,
      links: (w.links ?? []).map((l) => ({
        target: l.target,
        type: l.type,
        relationship: l.relationship,
        strength: l.strength,
      })),
    });
  }

  for (const e of dataModel) {
    const text = `${e.name} ${e.description} ${(e.keywords ?? []).join(" ")} ${e.rls ?? ""} ${(e.constraints ?? []).join(" ")}`.toLowerCase();
    entities.set(e.id, {
      id: e.id,
      type: "data_model",
      name: e.name,
      domain: e.domain ?? "",
      keywords: e.keywords ?? [],
      source_repo: e.source_repo,
      tags: [],
      has_auth_refs: text.match(/auth|jwt|rbac|session|login|password/) !== null,
      has_rls_refs: text.match(/rls|row.level|policy|enabled/) !== null,
      has_validation_refs: text.match(/validat|constraint|check|not.null/) !== null,
      accepts_input: text.match(/insert|upsert|create|write/) !== null,
      stores_data: true, // All data model entities store data
      links: (e.links ?? []).map((l) => ({
        target: l.target,
        type: l.type,
        relationship: l.relationship,
        strength: l.strength,
      })),
    });
  }

  return entities;
}

// ---------------------------------------------------------------------------
// Threat Detection Strategies
// ---------------------------------------------------------------------------

let threatIdSeq = 0;
function threatId(): string {
  threatIdSeq++;
  return `threat_${Date.now()}_${threatIdSeq}`;
}

/**
 * Privilege Escalation: find paths where non-auth entities connect
 * to auth-protected entities without going through auth middleware.
 */
function scanPrivilegeEscalation(
  entities: Map<string, SecurityEntity>,
  cycle: number
): ThreatEdge[] {
  const threats: ThreatEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of entities.values()) {
    if (entity.has_auth_refs) continue; // Has auth, not a concern as entry point

    for (const link of entity.links) {
      const target = entities.get(link.target);
      if (!target) continue;

      // Non-auth entity directly accesses a data entity with stored data
      if (target.stores_data && !entity.has_auth_refs && !entity.has_validation_refs) {
        const blastRadius = [entity.id, target.id];
        // Check for transitive exposure
        for (const tLink of target.links) {
          const transitive = entities.get(tLink.target);
          if (transitive?.stores_data) blastRadius.push(transitive.id);
        }

        threats.push({
          id: threatId(),
          from: entity.id,
          to: target.id,
          threat_category: "privilege_escalation",
          severity: target.has_rls_refs ? "medium" : "high",
          cwe_id: "CWE-269",
          attack_vector: `"${entity.name}" accesses "${target.name}" (stores data) without visible auth/validation gates`,
          blast_radius: [...new Set(blastRadius)],
          confidence: entity.has_auth_refs ? 0.3 : 0.6,
          description: `Potential privilege escalation: "${entity.name}" → "${target.name}" path lacks authentication guards`,
          mitigation: `Add authentication middleware between "${entity.name}" and "${target.name}". Consider RLS policies on "${target.name}".`,
          discovered_at: now,
          dream_cycle: cycle,
        });
      }
    }
  }

  return threats;
}

/**
 * Data Leak Path: trace data flow from storage to user-facing outputs.
 * Look for paths where sensitive data exits without filtering.
 */
function scanDataLeakPaths(
  entities: Map<string, SecurityEntity>,
  cycle: number
): ThreatEdge[] {
  const threats: ThreatEdge[] = [];
  const now = new Date().toISOString();

  const sensitiveKeywords = ["password", "secret", "token", "key", "credit", "ssn", "email", "phone", "payment"];

  for (const entity of entities.values()) {
    if (!entity.stores_data) continue;

    const isSensitive = entity.keywords.some((k) =>
      sensitiveKeywords.some((sk) => k.toLowerCase().includes(sk))
    );

    if (!isSensitive) continue;

    // Find outbound connections that could leak data
    for (const link of entity.links) {
      const target = entities.get(link.target);
      if (!target) continue;

      if (target.type === "feature" && target.accepts_input) {
        threats.push({
          id: threatId(),
          from: entity.id,
          to: target.id,
          threat_category: "data_leak_path",
          severity: "high",
          cwe_id: "CWE-200",
          attack_vector: `Sensitive data entity "${entity.name}" flows to user-facing feature "${target.name}" via "${link.relationship}"`,
          blast_radius: [entity.id, target.id],
          confidence: 0.5,
          description: `Potential data exposure: "${entity.name}" (contains sensitive keywords: ${entity.keywords.filter((k) => sensitiveKeywords.some((sk) => k.includes(sk))).join(", ")}) → "${target.name}"`,
          mitigation: `Ensure data filtering/masking between "${entity.name}" and "${target.name}". Validate that sensitive fields are excluded from API responses.`,
          discovered_at: now,
          dream_cycle: cycle,
        });
      }
    }
  }

  return threats;
}

/**
 * Injection Surface: identify entities accepting external input
 * without visible validation references.
 */
function scanInjectionSurfaces(
  entities: Map<string, SecurityEntity>,
  cycle: number
): ThreatEdge[] {
  const threats: ThreatEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of entities.values()) {
    if (!entity.accepts_input) continue;
    if (entity.has_validation_refs) continue; // Has validation

    // Find what this unvalidated input feeds into
    for (const link of entity.links) {
      const target = entities.get(link.target);
      if (!target) continue;

      if (target.stores_data || target.type === "data_model") {
        threats.push({
          id: threatId(),
          from: entity.id,
          to: target.id,
          threat_category: "injection_surface",
          severity: target.type === "data_model" ? "high" : "medium",
          cwe_id: "CWE-20",
          attack_vector: `"${entity.name}" accepts input and writes to "${target.name}" without visible validation`,
          blast_radius: [entity.id, target.id],
          confidence: 0.55,
          description: `Potential injection: unvalidated input from "${entity.name}" reaches data store "${target.name}" via "${link.relationship}"`,
          mitigation: `Add input validation/sanitization to "${entity.name}" before writing to "${target.name}".`,
          discovered_at: now,
          dream_cycle: cycle,
        });
      }
    }
  }

  return threats;
}

/**
 * Missing Validation: find write paths in workflows without guards.
 */
function scanMissingValidation(
  entities: Map<string, SecurityEntity>,
  cycle: number
): ThreatEdge[] {
  const threats: ThreatEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of entities.values()) {
    if (entity.type !== "workflow") continue;

    // Check if any step writes to data without validation
    const writesData = entity.links.some((l) => {
      const target = entities.get(l.target);
      return target?.stores_data && l.relationship.match(/write|create|update|insert/);
    });

    if (!writesData) continue;
    if (entity.has_validation_refs) continue;

    const affectedTargets = entity.links
      .filter((l) => {
        const t = entities.get(l.target);
        return t?.stores_data;
      })
      .map((l) => l.target);

    threats.push({
      id: threatId(),
      from: entity.id,
      to: affectedTargets[0] ?? entity.id,
      threat_category: "missing_validation",
      severity: "medium",
      cwe_id: "CWE-20",
      attack_vector: `Workflow "${entity.name}" writes to data stores without visible validation steps`,
      blast_radius: [entity.id, ...affectedTargets],
      confidence: 0.45,
      description: `Workflow "${entity.name}" modifies data entities [${affectedTargets.join(", ")}] but lacks validation step references`,
      mitigation: `Add a validation step to workflow "${entity.name}" before data modification.`,
      discovered_at: now,
      dream_cycle: cycle,
    });
  }

  return threats;
}

/**
 * Broken Access Control: detect data entities missing RLS or auth references.
 */
function scanBrokenAccessControl(
  entities: Map<string, SecurityEntity>,
  cycle: number
): ThreatEdge[] {
  const threats: ThreatEdge[] = [];
  const now = new Date().toISOString();

  for (const entity of entities.values()) {
    if (entity.type !== "data_model") continue;
    if (entity.has_rls_refs || entity.has_auth_refs) continue;

    // Find all features that read from this unprotected entity
    const readers: string[] = [];
    for (const other of entities.values()) {
      for (const link of other.links) {
        if (link.target === entity.id) {
          readers.push(other.id);
        }
      }
    }

    if (readers.length === 0) continue;

    threats.push({
      id: threatId(),
      from: readers[0],
      to: entity.id,
      threat_category: "broken_access_control",
      severity: entity.keywords.some((k) => k.match(/user|account|profile|payment/))
        ? "critical"
        : "medium",
      cwe_id: "CWE-862",
      attack_vector: `Data entity "${entity.name}" has no RLS policies or auth references but is accessed by ${readers.length} entities`,
      blast_radius: [entity.id, ...readers],
      confidence: 0.6,
      description: `Missing access control: "${entity.name}" is accessible by [${readers.slice(0, 5).join(", ")}${readers.length > 5 ? "..." : ""}] without RLS/auth hints`,
      mitigation: `Enable RLS on "${entity.name}" table. Add authentication checks to all reading features.`,
      discovered_at: now,
      dream_cycle: cycle,
    });
  }

  return threats;
}

// ---------------------------------------------------------------------------
// Threat Log I/O
// ---------------------------------------------------------------------------

async function loadThreatLog(): Promise<ThreatLogFile> {
  try {
    if (!existsSync(THREAT_LOG_PATH)) return emptyThreatLog();
    const raw = await readFile(THREAT_LOG_PATH, "utf-8");
    return JSON.parse(raw) as ThreatLogFile;
  } catch {
    return emptyThreatLog();
  }
}

async function saveThreatLog(data: ThreatLogFile): Promise<void> {
  data.metadata.total_threats = data.threats.length;
  await writeFile(THREAT_LOG_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function emptyThreatLog(): ThreatLogFile {
  return {
    metadata: {
      description: "Threat Log — adversarial findings from NIGHTMARE dream cycles.",
      schema_version: "1.0.0",
      total_threats: 0,
      last_nightmare_cycle: null,
      total_nightmare_cycles: 0,
    },
    threats: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run a NIGHTMARE cycle: adversarial analysis of the system.
 * Scans for security vulnerabilities and creates threat tensions.
 *
 * The caller must handle AWAKE → NIGHTMARE → AWAKE transitions.
 */
export async function nightmare(
  strategy: AdversarialStrategy = "all_threats"
): Promise<NightmareResult> {
  engine.assertState("nightmare", "nightmare");

  const startTime = Date.now();
  const cycle = engine.getCurrentDreamCycle();
  const entities = await buildSecuritySnapshot();

  logger.info(
    `NIGHTMARE cycle starting: strategy=${strategy}, entities=${entities.size}`
  );

  let allThreats: ThreatEdge[] = [];

  const strategies: AdversarialStrategy[] =
    strategy === "all_threats"
      ? ["privilege_escalation", "data_leak_path", "injection_surface", "missing_validation", "broken_access_control"]
      : [strategy];

  for (const s of strategies) {
    let threats: ThreatEdge[] = [];
    switch (s) {
      case "privilege_escalation":
        threats = scanPrivilegeEscalation(entities, cycle);
        break;
      case "data_leak_path":
        threats = scanDataLeakPaths(entities, cycle);
        break;
      case "injection_surface":
        threats = scanInjectionSurfaces(entities, cycle);
        break;
      case "missing_validation":
        threats = scanMissingValidation(entities, cycle);
        break;
      case "broken_access_control":
        threats = scanBrokenAccessControl(entities, cycle);
        break;
    }
    logger.debug(`  ${s}: ${threats.length} threats`);
    allThreats.push(...threats);
  }

  // Deduplicate by from+to+category
  const seen = new Set<string>();
  allThreats = allThreats.filter((t) => {
    const key = `${t.from}|${t.to}|${t.threat_category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Persist to threat log
  const log = await loadThreatLog();
  log.threats.push(...allThreats);
  log.metadata.last_nightmare_cycle = new Date().toISOString();
  log.metadata.total_nightmare_cycles++;
  await saveThreatLog(log);

  // Build attack surface summary
  const surfaceMap = new Map<string, { type: string; severity: ThreatSeverity }>();
  for (const threat of allThreats) {
    for (const entity of [threat.from, threat.to]) {
      const existing = surfaceMap.get(entity);
      if (!existing || severityRank(threat.severity) > severityRank(existing.severity)) {
        surfaceMap.set(entity, {
          type: threat.threat_category,
          severity: threat.severity,
        });
      }
    }
  }

  const attack_surfaces = [...surfaceMap.entries()].map(([entity, info]) => ({
    entity,
    exposure_type: info.type,
    severity: info.severity,
  }));

  const summary = {
    critical: allThreats.filter((t) => t.severity === "critical").length,
    high: allThreats.filter((t) => t.severity === "high").length,
    medium: allThreats.filter((t) => t.severity === "medium").length,
    low: allThreats.filter((t) => t.severity === "low").length,
    info: allThreats.filter((t) => t.severity === "info").length,
  };

  const duration_ms = Date.now() - startTime;

  logger.info(
    `NIGHTMARE cycle complete: ${allThreats.length} threats ` +
    `(${summary.critical}C/${summary.high}H/${summary.medium}M/${summary.low}L) in ${duration_ms}ms`
  );

  return {
    cycle_number: cycle,
    threats_found: allThreats,
    attack_surfaces,
    summary,
    duration_ms,
  };
}

function severityRank(s: ThreatSeverity): number {
  const ranks: Record<ThreatSeverity, number> = {
    critical: 5, high: 4, medium: 3, low: 2, info: 1,
  };
  return ranks[s] ?? 0;
}

/**
 * Get the current threat log.
 */
export async function getThreatLog(): Promise<ThreatLogFile> {
  return loadThreatLog();
}

/**
 * Clear threat log.
 */
export async function clearThreatLog(): Promise<void> {
  await saveThreatLog(emptyThreatLog());
  logger.info("Threat log cleared");
}
