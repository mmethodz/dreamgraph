/**
 * DreamGraph — Validated JSON store loader.
 *
 * F-01 follow-up. Provides:
 *   - `ValidationError` / `MissingFileError` — distinct error classes so
 *     callers can decide whether to swallow (file absent) or propagate
 *     (file present but corrupt).
 *   - `loadJsonValidated()` — wraps `loadJsonData()` with a zod schema and
 *     a trust-tier policy.
 *   - `STORE_TRUST_TIERS` — classifies every store in `data/` so the
 *     daemon can apply the right policy on load.
 *   - `hasSchemaField()` — small type guard for the existing `_schema`
 *     marker used by seed files.
 */

import type { z, ZodTypeAny } from "zod";

import { loadJsonData } from "./cache.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class MissingFileError extends Error {
  constructor(public readonly filename: string, cause?: unknown) {
    super(`JSON store '${filename}' not found`);
    this.name = "MissingFileError";
    if (cause !== undefined) {
      (this as unknown as { cause?: unknown }).cause = cause;
    }
  }
}

export class ValidationError extends Error {
  constructor(
    public readonly filename: string,
    public readonly issues: string[],
  ) {
    super(`JSON store '${filename}' failed validation: ${issues.join("; ")}`);
    this.name = "ValidationError";
  }
}

/** True iff `err` is a Node fs ENOENT-style "not found" error. */
export function isMissingFileError(err: unknown): boolean {
  if (err instanceof MissingFileError) return true;
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOENT|no such file/i.test(msg);
}

// ---------------------------------------------------------------------------
// Trust tiers — see plans/SYSTEM_FINDINGS.md F-01 follow-up
// ---------------------------------------------------------------------------

/**
 * `external` — file may be hand-edited or written by an external party
 *              (seed data, schedules, federation imports). Validate on
 *              every load AND on every write boundary.
 * `internal` — daemon-owned persistent state. Validate on load (catches
 *              disk corruption / version drift) and on every write.
 * `ephemeral` — rebuildable cache. No load validation; regenerate if
 *              missing or corrupt.
 */
export type TrustTier = "external" | "internal" | "ephemeral";

export const STORE_TRUST_TIERS: Record<string, TrustTier> = {
  // External / user- or import-writable
  "features.json": "external",
  "workflows.json": "external",
  "data_model.json": "external",
  "capabilities.json": "external",
  "schedules.json": "external",
  "dream_archetypes.json": "external",
  "system_overview.json": "external",
  "ui_registry.json": "external",
  "adr_log.json": "external",

  // Internal persistent state
  "dream_graph.json": "internal",
  "validated_edges.json": "internal",
  "candidate_edges.json": "internal",
  "tension_log.json": "internal",
  "dream_history.json": "internal",
  "meta_log.json": "internal",
  "event_log.json": "internal",
  "lucid_log.json": "internal",
  "threat_log.json": "internal",
  "system_story.json": "internal",

  // Ephemeral / rebuildable
  "index.json": "ephemeral",
};

export function getTrustTier(filename: string): TrustTier {
  // Default to external (most conservative) for unknown files.
  return STORE_TRUST_TIERS[filename] ?? "external";
}

// ---------------------------------------------------------------------------
// Validated loader
// ---------------------------------------------------------------------------

export interface LoadJsonValidatedOptions {
  /** Override the trust-tier-derived policy. */
  validate?: boolean;
}

/**
 * Load a JSON file and validate against a zod schema.
 *
 * Failure modes:
 *  - File missing → throws `MissingFileError`. Callers that want a default
 *    should `catch (err) { if (isMissingFileError(err)) return DEFAULT; throw err; }`.
 *  - File present but invalid → throws `ValidationError`. This is intentional:
 *    silently substituting a default would mask corruption.
 *  - Trust tier `ephemeral` skips validation entirely (caller is expected
 *    to regenerate on demand).
 */
export async function loadJsonValidated<S extends ZodTypeAny>(
  filename: string,
  schema: S,
  options: LoadJsonValidatedOptions = {},
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await loadJsonData<unknown>(filename);
  } catch (err) {
    if (isMissingFileError(err)) {
      throw new MissingFileError(filename, err);
    }
    throw err;
  }

  const tier = getTrustTier(filename);
  const shouldValidate = options.validate ?? tier !== "ephemeral";

  if (!shouldValidate) {
    return raw as z.infer<S>;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    logger.warn(`[json-store] Validation failed for ${filename}: ${issues.join("; ")}`);
    throw new ValidationError(filename, issues);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Seed-file helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the value is an object carrying a `_schema` field.
 *
 * Seed JSON files (features.json, workflows.json, …) include a leading
 * `{"_schema": {...}}` element that documents the file format. Filtering
 * it out used to require ugly `(x as unknown as Record<string, unknown>)`
 * casts at the call site — this guard removes that need.
 */
export function hasSchemaField(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "_schema" in (value as Record<string, unknown>)
  );
}
