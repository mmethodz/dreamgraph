/**
 * DreamGraph MCP Server — Data Protection Rules.
 *
 * Implements the three-tier data protection model:
 *
 *   Tier 1: FORBIDDEN  — Cognitive state files, never writable externally
 *   Tier 2: TOOL-MEDIATED — Writable only via MCP tools during Execute
 *   Tier 3: SEED DATA  — Project descriptions, always read-only
 *
 * See ADR-005: Three-Tier Data Protection Model.
 */

import { basename, resolve } from "node:path";
import { logger } from "../utils/logger.js";
import type { DataProtectionRule, DataProtectionTier, DisciplinePhase } from "./types.js";

// ---------------------------------------------------------------------------
// Protection Rules
// ---------------------------------------------------------------------------

/**
 * Complete protection rule set for all 19 DreamGraph data files.
 */
export const DATA_PROTECTION_RULES: DataProtectionRule[] = [
  // ---- Tier 1: FORBIDDEN (cognitive state — 11 files) --------------------
  {
    filename: "dream_graph.json",
    tier: "forbidden",
    description: "Speculative hypotheses (nodes + edges) — cognitive memory",
  },
  {
    filename: "candidate_edges.json",
    tier: "forbidden",
    description: "Normalization judgments pipeline",
  },
  {
    filename: "validated_edges.json",
    tier: "forbidden",
    description: "Promoted near-fact hypotheses",
  },
  {
    filename: "tension_log.json",
    tier: "forbidden",
    description: "Detected contradictions and quality signals",
  },
  {
    filename: "dream_history.json",
    tier: "forbidden",
    description: "Audit trail of all dream cycles",
  },
  {
    filename: "system_story.json",
    tier: "forbidden",
    description: "Auto-generated system narrative (maintained by narrator)",
  },
  {
    filename: "event_log.json",
    tier: "forbidden",
    description: "Cognitive event audit trail (maintained by event router)",
  },
  {
    filename: "meta_log.json",
    tier: "forbidden",
    description: "Metacognitive analysis history",
  },
  {
    filename: "schedules.json",
    tier: "forbidden",
    description: "Dream scheduler state (maintained by scheduler)",
  },
  {
    filename: "threat_log.json",
    tier: "forbidden",
    description: "Adversarial nightmare scan results",
  },
  {
    filename: "dream_archetypes.json",
    tier: "forbidden",
    description: "Federation shared pattern store",
  },

  // ---- Tier 2: TOOL-MEDIATED (3 files) ----------------------------------
  {
    filename: "adr_log.json",
    tier: "tool_mediated",
    description: "Architecture Decision Records",
    allowed_tools: [
      "record_architecture_decision",
      "deprecate_architecture_decision",
    ],
  },
  {
    filename: "ui_registry.json",
    tier: "tool_mediated",
    description: "Semantic UI element registry",
    allowed_tools: ["register_ui_element"],
  },
  {
    filename: "capabilities.json",
    tier: "seed_data",
    description: "Capability declarations (enrichable via enrich_seed_data)",
    allowed_tools: ["init_graph", "enrich_seed_data"],
  },

  // ---- Tier 3: SEED DATA (5 files) — writable ONLY by init_graph --------
  {
    filename: "system_overview.json",
    tier: "seed_data",
    description: "Project overview (read-only except during bootstrap)",
    allowed_tools: ["init_graph"],
  },
  {
    filename: "features.json",
    tier: "seed_data",
    description: "Project feature descriptions (read-only except during bootstrap/enrichment)",
    allowed_tools: ["init_graph", "enrich_seed_data"],
  },
  {
    filename: "workflows.json",
    tier: "seed_data",
    description: "Project workflow definitions (read-only except during bootstrap/enrichment)",
    allowed_tools: ["init_graph", "enrich_seed_data"],
  },
  {
    filename: "data_model.json",
    tier: "seed_data",
    description: "Project data model entities (read-only except during bootstrap/enrichment)",
    allowed_tools: ["init_graph", "enrich_seed_data"],
  },
  {
    filename: "index.json",
    tier: "seed_data",
    description: "Resource index (rebuilt by init_graph and enrich_seed_data)",
    allowed_tools: ["init_graph", "enrich_seed_data"],
  },
];

// ---------------------------------------------------------------------------
// Fast-Lookup Sets
// ---------------------------------------------------------------------------

const FORBIDDEN_FILES = new Set(
  DATA_PROTECTION_RULES.filter((r) => r.tier === "forbidden").map(
    (r) => r.filename
  )
);

const TOOL_MEDIATED_MAP = new Map<string, string[]>(
  DATA_PROTECTION_RULES.filter((r) => r.tier === "tool_mediated").map((r) => [
    r.filename,
    r.allowed_tools ?? [],
  ])
);

const SEED_DATA_FILES = new Set(
  DATA_PROTECTION_RULES.filter((r) => r.tier === "seed_data").map(
    (r) => r.filename
  )
);

/** Seed data files that have bootstrap tool exceptions */
const SEED_DATA_TOOLS_MAP = new Map<string, string[]>(
  DATA_PROTECTION_RULES
    .filter((r) => r.tier === "seed_data" && r.allowed_tools?.length)
    .map((r) => [r.filename, r.allowed_tools ?? []])
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WriteCheck {
  allowed: boolean;
  tier: DataProtectionTier | "unprotected";
  reason: string;
}

/**
 * Check whether a file path may be written to during a given phase,
 * optionally by a specific tool.
 *
 * @param filePath - Absolute or relative path (basename is extracted)
 * @param phase    - Current discipline phase
 * @param tool     - MCP tool name performing the write (if tool-mediated)
 * @returns WriteCheck with allowed flag, tier, and reason
 */
export function canWriteFile(
  filePath: string,
  phase: DisciplinePhase,
  tool?: string
): WriteCheck {
  const filename = basename(resolve(filePath));

  // Tier 1: absolute prohibition
  if (FORBIDDEN_FILES.has(filename)) {
    return {
      allowed: false,
      tier: "forbidden",
      reason: `FORBIDDEN: '${filename}' is a cognitive state file and cannot be written by external tasks`,
    };
  }

  // Tier 2: tool-mediated
  const allowedTools = TOOL_MEDIATED_MAP.get(filename);
  if (allowedTools) {
    if (phase !== "execute") {
      return {
        allowed: false,
        tier: "tool_mediated",
        reason: `TOOL-MEDIATED: '${filename}' can only be written during 'execute' phase (current: '${phase}')`,
      };
    }
    if (!tool || !allowedTools.includes(tool)) {
      return {
        allowed: false,
        tier: "tool_mediated",
        reason: `TOOL-MEDIATED: '${filename}' can only be written by [${allowedTools.join(", ")}]${tool ? ` (attempted by: '${tool}')` : ""}`,
      };
    }
    return {
      allowed: true,
      tier: "tool_mediated",
      reason: `Tool-mediated write allowed: '${tool}' → '${filename}' in execute phase`,
    };
  }

  // Tier 3: seed data — read-only unless bootstrap tool
  if (SEED_DATA_FILES.has(filename)) {
    const seedTools = SEED_DATA_TOOLS_MAP.get(filename);
    if (seedTools && tool && seedTools.includes(tool)) {
      return {
        allowed: true,
        tier: "seed_data",
        reason: `SEED DATA bootstrap write allowed: '${tool}' → '${filename}'`,
      };
    }
    return {
      allowed: false,
      tier: "seed_data",
      reason: `SEED DATA: '${filename}' is a read-only project reference${seedTools ? ` (writable only by [${seedTools.join(", ")}])` : ""}`,
    };
  }

  // Not a protected file — allow during execute only
  if (phase !== "execute") {
    return {
      allowed: false,
      tier: "unprotected",
      reason: `Writes are only allowed during 'execute' phase (current: '${phase}')`,
    };
  }

  return {
    allowed: true,
    tier: "unprotected",
    reason: "File is not a protected DreamGraph data file — write allowed during execute",
  };
}

/**
 * Get the protection tier for a given filename.
 */
export function getProtectionTier(
  filePath: string
): DataProtectionTier | "unprotected" {
  const filename = basename(resolve(filePath));
  if (FORBIDDEN_FILES.has(filename)) return "forbidden";
  if (TOOL_MEDIATED_MAP.has(filename)) return "tool_mediated";
  if (SEED_DATA_FILES.has(filename)) return "seed_data";
  return "unprotected";
}

/**
 * Get all filenames in a given protection tier.
 */
export function getFilesByTier(tier: DataProtectionTier): string[] {
  return DATA_PROTECTION_RULES.filter((r) => r.tier === tier).map(
    (r) => r.filename
  );
}

/**
 * Log a write check result.
 */
export function logWriteCheck(
  filePath: string,
  result: WriteCheck
): void {
  if (result.allowed) {
    logger.debug(`Protection check PASSED: ${result.reason}`);
  } else {
    logger.warn(
      `Protection check BLOCKED write to '${filePath}': ${result.reason}`
    );
  }
}
