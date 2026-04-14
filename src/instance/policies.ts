/**
 * DreamGraph v7.0 "El Alarife" — Policies Parser & Validator.
 *
 * Loads, validates, and provides runtime access to the per-instance
 * discipline policy configuration stored at `<instance>/config/policies.json`.
 *
 * In legacy mode (no active InstanceScope) the built-in DEFAULT_POLICIES
 * are used — equivalent to the "balanced" profile.
 */

import { readFile, mkdir } from "node:fs/promises";
import { atomicWriteFile } from "../utils/atomic-write.js";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CognitiveTuning,
  PoliciesFile,
  PolicyProfile,
  PolicyProfileDef,
} from "./types.js";
import { getActiveScope, isInstanceMode } from "./lifecycle.js";
import { logger } from "../utils/logger.js";

/* ------------------------------------------------------------------ */
/*  Built-in Policy Profiles                                          */
/* ------------------------------------------------------------------ */

const STRICT_PROFILE: PolicyProfileDef = {
  description:
    "Full disciplinary enforcement. No structural claims without tool evidence. All phases mandatory.",
  require_tool_evidence: true,
  require_plan_approval: true,
  block_unbacked_claims: true,
  allow_phase_skip: false,
  max_verify_loops: 3,
  allow_creative_mode: false,
  mandatory_ingest_tools: [
    "read_source_code",
    "query_ui_elements|search_data_model|get_workflow",
  ],
  mandatory_verify_tools: ["read_source_code"],
  protected_file_tiers: ["forbidden", "tool_mediated", "seed_data"],
  cognitive_tuning: {
    promotion_confidence: 0.62,
    promotion_plausibility: 0.45,
    promotion_evidence: 0.4,
    promotion_evidence_count: 2,
    retention_plausibility: 0.35,
    max_contradiction: 0.3,
    decay_ttl: 8,
    decay_rate: 0.05,
  },
};

const BALANCED_PROFILE: PolicyProfileDef = {
  description:
    "Moderate enforcement. Tool evidence required for structural claims. Plan recommended but not blocked.",
  require_tool_evidence: true,
  require_plan_approval: false,
  block_unbacked_claims: false,
  allow_phase_skip: false,
  max_verify_loops: 5,
  allow_creative_mode: true,
  mandatory_ingest_tools: ["read_source_code"],
  mandatory_verify_tools: [],
  protected_file_tiers: ["forbidden", "tool_mediated"],
  cognitive_tuning: {
    promotion_confidence: 0.55,
    promotion_plausibility: 0.40,
    promotion_evidence: 0.35,
    promotion_evidence_count: 1,
    retention_plausibility: 0.30,
    max_contradiction: 0.35,
    decay_ttl: 10,
    decay_rate: 0.04,
  },
};

const CREATIVE_PROFILE: PolicyProfileDef = {
  description:
    "Minimal enforcement. Used for brainstorming, exploration, and dream cycles. Tools available but not mandatory.",
  require_tool_evidence: false,
  require_plan_approval: false,
  block_unbacked_claims: false,
  allow_phase_skip: true,
  max_verify_loops: 10,
  allow_creative_mode: true,
  mandatory_ingest_tools: [],
  mandatory_verify_tools: [],
  protected_file_tiers: ["forbidden"],
  cognitive_tuning: {
    promotion_confidence: 0.45,
    promotion_plausibility: 0.35,
    promotion_evidence: 0.25,
    promotion_evidence_count: 1,
    retention_plausibility: 0.25,
    max_contradiction: 0.4,
    decay_ttl: 12,
    decay_rate: 0.03,
  },
};

/** Built-in default policies file (used in legacy mode or as seed). */
export const DEFAULT_POLICIES: PoliciesFile = {
  schema_version: "1.0.0",
  profile: "balanced",
  profiles: {
    strict: STRICT_PROFILE,
    balanced: BALANCED_PROFILE,
    creative: CREATIVE_PROFILE,
  },
};

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

/** Errors discovered during policy validation. */
export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_PROFILES: readonly PolicyProfile[] = [
  "strict",
  "balanced",
  "creative",
];

const REQUIRED_DEF_FIELDS: readonly (keyof PolicyProfileDef)[] = [
  "description",
  "require_tool_evidence",
  "require_plan_approval",
  "block_unbacked_claims",
  "allow_phase_skip",
  "max_verify_loops",
  "allow_creative_mode",
  "mandatory_ingest_tools",
  "mandatory_verify_tools",
  "protected_file_tiers",
];

/**
 * Validate a parsed PoliciesFile object.
 *
 * Returns a result with `valid: true` if the file conforms to the
 * expected schema.  Validation is lenient where possible — unknown
 * extra keys produce warnings, not errors.
 */
export function validatePolicies(file: unknown): PolicyValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return { valid: false, errors: ["policies.json must be a JSON object"], warnings };
  }

  const f = file as Record<string, unknown>;

  // schema_version
  if (f.schema_version !== "1.0.0") {
    errors.push(
      `Unsupported schema_version "${String(f.schema_version)}" (expected "1.0.0")`,
    );
  }

  // profile
  if (typeof f.profile !== "string") {
    errors.push(`"profile" must be a string`);
  } else if (!VALID_PROFILES.includes(f.profile as PolicyProfile)) {
    errors.push(
      `Unknown active profile "${f.profile}" (expected one of: ${VALID_PROFILES.join(", ")})`,
    );
  }

  // profiles map
  if (!f.profiles || typeof f.profiles !== "object" || Array.isArray(f.profiles)) {
    errors.push(`"profiles" must be a map of profile name → definition`);
    return { valid: false, errors, warnings };
  }

  const profiles = f.profiles as Record<string, unknown>;

  // Every canonical profile must exist
  for (const name of VALID_PROFILES) {
    if (!profiles[name]) {
      errors.push(`Missing required profile definition: "${name}"`);
      continue;
    }
    const def = profiles[name] as Record<string, unknown>;
    validateProfileDef(name, def, errors, warnings);
  }

  // Warn about unknown profiles (custom extensions)
  for (const key of Object.keys(profiles)) {
    if (!VALID_PROFILES.includes(key as PolicyProfile)) {
      warnings.push(`Unknown profile "${key}" — will be ignored`);
    }
  }

  // Active profile must exist in profiles map
  if (
    typeof f.profile === "string" &&
    VALID_PROFILES.includes(f.profile as PolicyProfile) &&
    !profiles[f.profile as string]
  ) {
    errors.push(
      `Active profile "${f.profile}" is not defined in the profiles map`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateProfileDef(
  name: string,
  def: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): void {
  for (const field of REQUIRED_DEF_FIELDS) {
    if (!(field in def)) {
      errors.push(`Profile "${name}" is missing required field "${field}"`);
    }
  }

  // Type checks for present fields
  const boolFields: (keyof PolicyProfileDef)[] = [
    "require_tool_evidence",
    "require_plan_approval",
    "block_unbacked_claims",
    "allow_phase_skip",
    "allow_creative_mode",
  ];
  for (const bf of boolFields) {
    if (bf in def && typeof def[bf] !== "boolean") {
      errors.push(`Profile "${name}".${bf} must be a boolean`);
    }
  }

  if ("max_verify_loops" in def && typeof def.max_verify_loops !== "number") {
    errors.push(`Profile "${name}".max_verify_loops must be a number`);
  }

  if ("description" in def && typeof def.description !== "string") {
    errors.push(`Profile "${name}".description must be a string`);
  }

  const arrayFields: (keyof PolicyProfileDef)[] = [
    "mandatory_ingest_tools",
    "mandatory_verify_tools",
    "protected_file_tiers",
  ];
  for (const af of arrayFields) {
    if (af in def && !Array.isArray(def[af])) {
      errors.push(`Profile "${name}".${af} must be an array`);
    }
  }

  // Validate cognitive_tuning if present
  if ("cognitive_tuning" in def && def.cognitive_tuning != null) {
    const ct = def.cognitive_tuning as Record<string, unknown>;
    if (typeof ct !== "object" || Array.isArray(ct)) {
      errors.push(`Profile "${name}".cognitive_tuning must be an object`);
    } else {
      const numFields = [
        "promotion_confidence", "promotion_plausibility", "promotion_evidence",
        "promotion_evidence_count", "retention_plausibility", "max_contradiction",
        "decay_ttl", "decay_rate",
      ] as const;
      for (const nf of numFields) {
        if (nf in ct && typeof ct[nf] !== "number") {
          errors.push(`Profile "${name}".cognitive_tuning.${nf} must be a number`);
        }
      }
    }
  }

  // Warn about unexpected keys
  const knownKeys = new Set<string>([
    ...(REQUIRED_DEF_FIELDS as unknown as string[]),
    "cognitive_tuning",
  ]);
  for (const key of Object.keys(def)) {
    if (!knownKeys.has(key)) {
      warnings.push(`Profile "${name}" has unknown field "${key}"`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Loading & Saving                                                  */
/* ------------------------------------------------------------------ */

/**
 * Load and validate the policies file for the active instance.
 *
 * - In instance mode: reads `<instance>/config/policies.json`.
 * - In legacy mode: returns DEFAULT_POLICIES.
 *
 * If the file is missing or invalid, falls back to DEFAULT_POLICIES
 * and logs a warning.
 */
export async function loadPolicies(): Promise<PoliciesFile> {
  if (!isInstanceMode()) {
    logger.debug("Policies: legacy mode — using built-in defaults");
    return structuredClone(DEFAULT_POLICIES);
  }

  const scope = getActiveScope()!;
  const policiesPath = scope.configPath("policies.json");

  if (!existsSync(policiesPath)) {
    logger.info(
      `Policies: ${policiesPath} not found — seeding with defaults`,
    );
    await savePolicies(DEFAULT_POLICIES);
    return structuredClone(DEFAULT_POLICIES);
  }

  try {
    const raw = await readFile(policiesPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    const result = validatePolicies(parsed);

    if (!result.valid) {
      logger.warn(
        `Policies: validation failed — ${result.errors.join("; ")}. Falling back to defaults.`,
      );
      return structuredClone(DEFAULT_POLICIES);
    }

    if (result.warnings.length > 0) {
      logger.debug(
        `Policies: warnings — ${result.warnings.join("; ")}`,
      );
    }

    return parsed as PoliciesFile;
  } catch (err) {
    logger.warn(
      `Policies: failed to read ${policiesPath} — ${String(err)}. Falling back to defaults.`,
    );
    return structuredClone(DEFAULT_POLICIES);
  }
}

/**
 * Persist a PoliciesFile to the active instance's config directory.
 *
 * Only works in instance mode.  In legacy mode this is a no-op.
 */
export async function savePolicies(policies: PoliciesFile): Promise<void> {
  if (!isInstanceMode()) {
    logger.debug("Policies: cannot save in legacy mode — skipping");
    return;
  }

  const scope = getActiveScope()!;
  const policiesPath = scope.configPath("policies.json");
  const dir = dirname(policiesPath);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await atomicWriteFile(policiesPath, JSON.stringify(policies, null, 2) + "\n");
  logger.info(`Policies: saved to ${policiesPath}`);
}

/* ------------------------------------------------------------------ */
/*  Runtime Queries                                                   */
/* ------------------------------------------------------------------ */

/** Cached active policies (loaded once at startup, refreshable). */
let cachedPolicies: PoliciesFile | null = null;

/**
 * Get the currently active PolicyProfileDef.
 *
 * Loads from disk on first call, then caches.  Call `reloadPolicies()`
 * to force a refresh.
 */
export async function getActivePolicy(): Promise<PolicyProfileDef> {
  if (!cachedPolicies) {
    cachedPolicies = await loadPolicies();
  }
  return cachedPolicies.profiles[cachedPolicies.profile];
}

/**
 * Get the active profile name (e.g. "strict", "balanced", "creative").
 */
export async function getActiveProfileName(): Promise<PolicyProfile> {
  if (!cachedPolicies) {
    cachedPolicies = await loadPolicies();
  }
  return cachedPolicies.profile;
}

/**
 * Get a specific profile definition by name.
 */
export async function getProfileDef(
  profile: PolicyProfile,
): Promise<PolicyProfileDef> {
  if (!cachedPolicies) {
    cachedPolicies = await loadPolicies();
  }
  return cachedPolicies.profiles[profile];
}

/**
 * Switch the active profile at runtime and persist the change.
 */
export async function switchProfile(profile: PolicyProfile): Promise<void> {
  if (!VALID_PROFILES.includes(profile)) {
    throw new Error(`Invalid policy profile: "${profile}"`);
  }

  if (!cachedPolicies) {
    cachedPolicies = await loadPolicies();
  }

  cachedPolicies.profile = profile;
  await savePolicies(cachedPolicies);
  logger.info(`Policies: switched active profile to "${profile}"`);
}

/**
 * Force reload policies from disk.
 */
export async function reloadPolicies(): Promise<PoliciesFile> {
  cachedPolicies = null;
  cachedPolicies = await loadPolicies();
  return cachedPolicies;
}

/**
 * Check whether a specific capability is required by the active profile.
 *
 * Convenience helper used by the discipline system to gate execution phases.
 */
export async function isPolicyRequired(
  capability: keyof Pick<
    PolicyProfileDef,
    | "require_tool_evidence"
    | "require_plan_approval"
    | "block_unbacked_claims"
    | "allow_phase_skip"
    | "allow_creative_mode"
  >,
): Promise<boolean> {
  const def = await getActivePolicy();
  return def[capability];
}

/**
 * Resolve cognitive tuning for the active policy profile.
 *
 * Returns a fully-resolved `CognitiveTuning` object — any fields missing
 * from the profile fall back to the hardcoded defaults.
 */
export async function getActiveCognitiveTuning(): Promise<Required<CognitiveTuning>> {
  const def = await getActivePolicy();
  const ct = def.cognitive_tuning ?? {};
  return {
    promotion_confidence:    ct.promotion_confidence    ?? 0.62,
    promotion_plausibility:  ct.promotion_plausibility  ?? 0.45,
    promotion_evidence:      ct.promotion_evidence      ?? 0.4,
    promotion_evidence_count: ct.promotion_evidence_count ?? 2,
    retention_plausibility:  ct.retention_plausibility  ?? 0.35,
    max_contradiction:       ct.max_contradiction       ?? 0.3,
    decay_ttl:               ct.decay_ttl               ?? 8,
    decay_rate:              ct.decay_rate              ?? 0.05,
  };
}
