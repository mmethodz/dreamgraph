/**
 * DreamGraph — Entity sanitization helpers (extracted from scan-project.ts).
 *
 * Pure functions used by `scan_project` and the LLM enrichment pipeline:
 *  - `stripTemplateStubs` — drop `{_schema, _fields, _note}` template entries
 *  - `mergeById` — upsert entities by `id` field
 *  - `extractJsonArray` — recover an array from raw LLM output (with code fences)
 *  - `ensureStringArray` — defensive coercion for LLM-supplied arrays
 *  - `sanitizeEntry` — normalize an LLM-supplied entity record
 *
 * No I/O, no external state — safe to import from anywhere.
 */

export function stripTemplateStubs<T>(arr: T[]): T[] {
  return arr.filter((e) => {
    const obj = e as Record<string, unknown>;
    return !("_schema" in obj) && !("_fields" in obj) && !("_note" in obj);
  });
}

export function mergeById<T>(
  existing: T[],
  incoming: T[],
): { merged: T[]; inserted: number; updated: number } {
  const map = new Map<string, T>();
  for (const e of existing) {
    map.set((e as Record<string, unknown>).id as string, e);
  }
  let inserted = 0;
  let updated = 0;
  for (const entry of incoming) {
    const id = (entry as Record<string, unknown>).id as string;
    if (map.has(id)) updated++;
    else inserted++;
    map.set(id, entry);
  }
  return { merged: [...map.values()], inserted, updated };
}

/**
 * Recover a JSON array from raw LLM text. Handles markdown code fences,
 * OpenAI `json_object` mode wrappers, and best-effort balanced-bracket
 * extraction from prose.
 */
export function extractJsonArray(text: string): unknown[] {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const val of Object.values(parsed as Record<string, unknown>)) {
        if (Array.isArray(val) && val.length > 0) return val;
      }
    }
    return [];
  } catch {
    /* try extraction */
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      try {
        const start = cleaned.indexOf("[");
        if (start !== -1) {
          let depth = 0;
          for (let i = start; i < cleaned.length; i++) {
            if (cleaned[i] === "[") depth++;
            else if (cleaned[i] === "]") depth--;
            if (depth === 0) {
              const candidate = cleaned.slice(start, i + 1);
              const arr = JSON.parse(candidate);
              if (Array.isArray(arr)) return arr;
              break;
            }
          }
        }
      } catch {
        /* give up */
      }
    }
  }

  return [];
}

export function ensureStringArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((v) => typeof v === "string");
  return [];
}

/**
 * Normalize an LLM-supplied entity record so downstream merge/persist
 * doesn't trip over missing fields. Mutates and returns `raw`.
 */
export function sanitizeEntry(
  raw: Record<string, unknown>,
  repoName: string,
): Record<string, unknown> {
  if (!raw.id || typeof raw.id !== "string") return raw;
  if (!raw.name || typeof raw.name !== "string")
    raw.name = String(raw.id).replace(/_/g, " ");
  if (!raw.description) raw.description = "";
  if (!raw.source_repo) raw.source_repo = repoName;
  if (!raw.status) raw.status = "active";
  if (!raw.domain) raw.domain = "core";
  raw.tags = ensureStringArray(raw.tags);
  raw.keywords = ensureStringArray(raw.keywords);
  raw.source_files = ensureStringArray(raw.source_files);
  if (!raw.links) raw.links = [];
  return raw;
}
