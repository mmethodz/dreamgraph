/**
 * DreamGraph Multi-System Dreaming — Federated Dream Exchange
 *
 * Multiple DreamGraph instances can share anonymized, validated patterns
 * (archetypes) so each system learns from the others' discoveries.
 *
 * Think of it as federated learning for software architecture:
 *   - System A discovers "missing org-scoping on API routes"
 *   - The pattern becomes a transferable archetype
 *   - System B's dreamer proactively checks for the same vulnerability
 *
 * Protocol:
 *   export_dream_archetypes — extract anonymized patterns from validated edges
 *   import_dream_archetypes — ingest archetypes from another instance
 *
 * Privacy: entity names are abstracted to roles (e.g., "api_endpoint").
 * No proprietary code or data leaves the instance.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { engine } from "./engine.js";
import { logger } from "../utils/logger.js";
import type {
  DreamArchetype,
  FederationConfig,
  FederatedExchangeFile,
  ExportArchetypesOutput,
  ImportArchetypesOutput,
  ValidatedEdge,
  TensionSignal,
} from "./types.js";
import { DEFAULT_FEDERATION_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const projectRoot = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const dataDir = resolve(projectRoot, "data");
const ARCHETYPES_PATH = resolve(dataDir, "dream_archetypes.json");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getFederationConfig(): FederationConfig {
  const raw = process.env.DREAMGRAPH_FEDERATION;
  if (raw) {
    try {
      return { ...DEFAULT_FEDERATION_CONFIG, ...JSON.parse(raw) };
    } catch { /* use default */ }
  }
  return { ...DEFAULT_FEDERATION_CONFIG };
}

// ---------------------------------------------------------------------------
// Archetype Extraction
// ---------------------------------------------------------------------------

/**
 * Classify a validated edge into an archetype pattern type.
 * Abstracts specific entity names into generic roles.
 */
function abstractToArchetype(edge: ValidatedEdge): DreamArchetype | null {
  // Determine pattern type from the relation
  let patternType = "generic_connection";
  const rel = edge.relation.toLowerCase();

  if (rel.includes("security") || rel.includes("rls") || rel.includes("auth")) {
    patternType = "security_pattern";
  } else if (rel.includes("missing") || rel.includes("gap")) {
    patternType = "structural_gap";
  } else if (rel.includes("cross_domain") || rel.includes("bridge")) {
    patternType = "cross_domain_bridge";
  } else if (rel.includes("tension") || rel.includes("resolution")) {
    patternType = "tension_resolution";
  } else if (rel.includes("symmetry") || rel.includes("reverse")) {
    patternType = "symmetry_pattern";
  } else if (rel.includes("strengthen") || rel.includes("reinforce")) {
    patternType = "reinforcement_pattern";
  } else if (rel.includes("causal")) {
    patternType = "causal_pattern";
  }

  // Abstract entity names to roles
  const fromRole = abstractEntityName(edge.from);
  const toRole = abstractEntityName(edge.to);

  return {
    id: `archetype_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pattern_type: patternType,
    description: edge.description,
    entity_roles: [fromRole, toRole],
    relation_pattern: edge.relation.replace(/[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)*/g, (match) => {
      // Keep relation verbs, replace specific IDs
      if (match.includes("_")) {
        const parts = match.split("_");
        return parts.length > 3 ? parts.slice(0, 2).join("_") + "_*" : match;
      }
      return match;
    }),
    confidence: edge.confidence,
    source_instance: getFederationConfig().instance_id,
    times_validated: 1,
    created_at: new Date().toISOString(),
  };
}

/**
 * Abstract a specific entity ID into a generic role.
 * E.g., "user_auth" → "auth_feature", "orders_table" → "data_entity"
 */
function abstractEntityName(entityId: string): string {
  const id = entityId.toLowerCase();
  if (id.includes("auth") || id.includes("login") || id.includes("jwt")) return "auth_component";
  if (id.includes("api") || id.includes("route") || id.includes("endpoint")) return "api_endpoint";
  if (id.includes("table") || id.includes("schema") || id.includes("model")) return "data_entity";
  if (id.includes("workflow") || id.includes("process") || id.includes("flow")) return "workflow_entity";
  if (id.includes("payment") || id.includes("billing") || id.includes("invoice")) return "financial_component";
  if (id.includes("email") || id.includes("notification") || id.includes("alert")) return "notification_component";
  if (id.includes("admin") || id.includes("dashboard")) return "admin_component";
  if (id.includes("search") || id.includes("catalog") || id.includes("browse")) return "discovery_component";
  return "system_component";
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function loadArchetypes(): Promise<FederatedExchangeFile> {
  try {
    if (!existsSync(ARCHETYPES_PATH)) return emptyExchangeFile();
    const raw = await readFile(ARCHETYPES_PATH, "utf-8");
    return JSON.parse(raw) as FederatedExchangeFile;
  } catch {
    return emptyExchangeFile();
  }
}

async function saveArchetypes(data: FederatedExchangeFile): Promise<void> {
  await writeFile(ARCHETYPES_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function emptyExchangeFile(): FederatedExchangeFile {
  return {
    metadata: {
      description: "Federated Dream Archetypes — anonymized patterns for cross-instance learning.",
      schema_version: "1.0.0",
      source_instance: getFederationConfig().instance_id,
      exported_at: new Date().toISOString(),
      total_archetypes: 0,
    },
    archetypes: [],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export validated edges as anonymized archetypes.
 * These can be shared with other DreamGraph instances.
 */
export async function exportArchetypes(): Promise<ExportArchetypesOutput> {
  const config = getFederationConfig();
  if (!config.allow_export) {
    throw new Error("Federation export is disabled for this instance.");
  }

  const validated = await engine.loadValidatedEdges();
  const archetypes: DreamArchetype[] = [];

  for (const edge of validated.edges) {
    const archetype = abstractToArchetype(edge);
    if (archetype) {
      archetypes.push(archetype);
    }
  }

  // Deduplicate by pattern_type + relation_pattern
  const seen = new Set<string>();
  const unique = archetypes.filter((a) => {
    const key = `${a.pattern_type}:${a.relation_pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Save to file
  const exchange: FederatedExchangeFile = {
    metadata: {
      description: "Federated Dream Archetypes — anonymized patterns for cross-instance learning.",
      schema_version: "1.0.0",
      source_instance: config.instance_id,
      exported_at: new Date().toISOString(),
      total_archetypes: unique.length,
    },
    archetypes: unique,
  };

  await saveArchetypes(exchange);

  logger.info(`Exported ${unique.length} archetypes from ${validated.edges.length} validated edges`);

  return {
    archetypes_exported: unique.length,
    file_path: ARCHETYPES_PATH,
    instance_id: config.instance_id,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Import archetypes from another DreamGraph instance.
 * Each archetype becomes a tension signal, directing the dreamer
 * to check whether the same pattern exists in this system.
 */
export async function importArchetypes(
  filePath: string
): Promise<ImportArchetypesOutput> {
  const config = getFederationConfig();
  if (!config.allow_import) {
    throw new Error("Federation import is disabled for this instance.");
  }

  const raw = await readFile(filePath, "utf-8");
  const incoming = JSON.parse(raw) as FederatedExchangeFile;

  // Load existing archetypes to deduplicate
  const existing = await loadArchetypes();
  const existingKeys = new Set(
    existing.archetypes.map((a) => `${a.pattern_type}:${a.relation_pattern}`)
  );

  let imported = 0;
  let skipped = 0;
  let tensionsCreated = 0;

  for (const archetype of incoming.archetypes) {
    const key = `${archetype.pattern_type}:${archetype.relation_pattern}`;

    if (existingKeys.has(key)) {
      // Reinforce existing archetype
      const match = existing.archetypes.find(
        (a) => `${a.pattern_type}:${a.relation_pattern}` === key
      );
      if (match) {
        match.times_validated++;
        match.confidence = Math.min(
          Math.round((match.confidence + archetype.confidence * 0.2) * 100) / 100,
          1.0
        );
      }
      skipped++;
      continue;
    }

    // Import new archetype
    existing.archetypes.push({
      ...archetype,
      source_instance: incoming.metadata.source_instance,
    });
    existingKeys.add(key);
    imported++;

    // Create a tension signal so the dreamer checks for this pattern
    await engine.recordTension({
      type: "missing_link",
      domain: "general",
      entities: archetype.entity_roles,
      description: `Federated archetype "${archetype.pattern_type}": ${archetype.description} (from instance ${incoming.metadata.source_instance})`,
      urgency: Math.min(archetype.confidence * 0.7, 0.8),
    });
    tensionsCreated++;
  }

  existing.metadata.total_archetypes = existing.archetypes.length;
  existing.metadata.exported_at = new Date().toISOString();
  await saveArchetypes(existing);

  logger.info(
    `Imported ${imported} archetypes (${skipped} duplicates reinforced, ${tensionsCreated} tensions created)`
  );

  return {
    archetypes_imported: imported,
    archetypes_skipped: skipped,
    tensions_created: tensionsCreated,
    source_instance: incoming.metadata.source_instance,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get the current archetype catalog for this instance.
 */
export async function getArchetypes(): Promise<FederatedExchangeFile> {
  return loadArchetypes();
}
