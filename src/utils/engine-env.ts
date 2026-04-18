/**
 * DreamGraph — engine.env loader.
 *
 * Parses a simple KEY=VALUE env file (no dependencies — no dotenv needed).
 * Supports:
 *   - `KEY=VALUE` and `KEY="VALUE"` and `KEY='VALUE'`
 *   - Comments: lines starting with `#`
 *   - Empty lines are ignored
 *   - Inline comments are NOT supported (values may contain `#`)
 *
 * Values are injected into `process.env` with "instance wins" semantics:
 * if a key is already set in the environment, the engine.env value takes
 * precedence (per-instance config > global env).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "./logger.js";

/**
 * Write a set of KEY=VALUE pairs to an engine.env file.
 *
 * Overwrites the entire file.  Adds a header comment and groups
 * values by purpose (base LLM, dreamer, normalizer).
 *
 * @param envPath  Absolute path to the engine.env file.
 * @param vars     Record of env-var names → values to write.  Empty/null
 *                 values are written as commented-out lines.
 */
export function writeEngineEnv(
  envPath: string,
  vars: Record<string, string>,
): void {
  try {
    mkdirSync(dirname(envPath), { recursive: true });

    const template: Array<{ key: string; defaultValue: string; description: string; section: string }> = [
      {
        key: "DREAMGRAPH_LLM_PROVIDER",
        defaultValue: "ollama",
        description: "Provider: ollama (local, default) | openai (API) | anthropic (Claude API) | sampling (MCP client) | none",
        section: "LLM Provider",
      },
      {
        key: "DREAMGRAPH_LLM_URL",
        defaultValue: "http://localhost:11434",
        description: "API base URL",
        section: "LLM Provider",
      },
      {
        key: "DREAMGRAPH_LLM_API_KEY",
        defaultValue: "",
        description: "API key (for openai/anthropic providers)",
        section: "LLM Provider",
      },
      {
        key: "DREAMGRAPH_LLM_MODEL",
        defaultValue: "qwen3:8b",
        description: "Base model defaults — used unless Dreamer / Normalizer overrides are set",
        section: "Base LLM Defaults",
      },
      {
        key: "DREAMGRAPH_LLM_TEMPERATURE",
        defaultValue: "0.7",
        description: "Base temperature defaults — used unless Dreamer / Normalizer overrides are set",
        section: "Base LLM Defaults",
      },
      {
        key: "DREAMGRAPH_LLM_MAX_TOKENS",
        defaultValue: "2048",
        description: "Base max token defaults — used unless Dreamer / Normalizer overrides are set",
        section: "Base LLM Defaults",
      },
      {
        key: "DREAMGRAPH_LLM_DREAMER_MODEL",
        defaultValue: "qwen3:8b",
        description: "Dreamer — creative dream cycle generation",
        section: "Dreamer",
      },
      {
        key: "DREAMGRAPH_LLM_DREAMER_TEMPERATURE",
        defaultValue: "0.9",
        description: "Dreamer temperature",
        section: "Dreamer",
      },
      {
        key: "DREAMGRAPH_LLM_DREAMER_MAX_TOKENS",
        defaultValue: "10240",
        description: "Dreamer max tokens",
        section: "Dreamer",
      },
      {
        key: "DREAMGRAPH_LLM_NORMALIZER_MODEL",
        defaultValue: "qwen3:8b",
        description: "Normalizer — validation / truth-filter pass",
        section: "Normalizer",
      },
      {
        key: "DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE",
        defaultValue: "0.1",
        description: "Normalizer temperature",
        section: "Normalizer",
      },
      {
        key: "DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS",
        defaultValue: "4096",
        description: "Normalizer max tokens",
        section: "Normalizer",
      },
      {
        key: "DG_PROMOTION_CONFIDENCE",
        defaultValue: "0.62",
        description: "Minimum combined confidence for edge promotion to validated graph",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_PROMOTION_PLAUSIBILITY",
        defaultValue: "0.45",
        description: "Minimum plausibility score for promotion",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_PROMOTION_EVIDENCE",
        defaultValue: "0.4",
        description: "Minimum evidence score for promotion",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_PROMOTION_EVIDENCE_COUNT",
        defaultValue: "2",
        description: "Minimum distinct evidence signals for promotion",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_RETENTION_PLAUSIBILITY",
        defaultValue: "0.35",
        description: "Minimum plausibility for retention as latent (below = rejected)",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_MAX_CONTRADICTION",
        defaultValue: "0.3",
        description: "Maximum contradiction score before rejection",
        section: "Promotion & Retention Thresholds",
      },
      {
        key: "DG_DECAY_TTL",
        defaultValue: "8",
        description: "Edge time-to-live in dream cycles (removed when TTL reaches 0)",
        section: "Dream Decay",
      },
      {
        key: "DG_DECAY_RATE",
        defaultValue: "0.05",
        description: "Confidence reduction per cycle if not reinforced",
        section: "Dream Decay",
      },
      {
        key: "DG_MEMORY_TTL_CYCLES",
        defaultValue: "30",
        description: "Reinforcement memory TTL (cycles of inactivity before forgetting)",
        section: "Dream Decay",
      },
      {
        key: "DG_MAX_ACTIVE_TENSIONS",
        defaultValue: "200",
        description: "Max active (unresolved) tensions",
        section: "Tension System",
      },
      {
        key: "DG_TENSION_TTL",
        defaultValue: "30",
        description: "Default TTL for new tensions (cycles before auto-expire)",
        section: "Tension System",
      },
      {
        key: "DG_TENSION_URGENCY_DECAY",
        defaultValue: "0.01",
        description: "Urgency decay per cycle for non-recurring tensions",
        section: "Tension System",
      },
      {
        key: "DG_BARREN_THRESHOLD",
        defaultValue: "3",
        description: "Consecutive 0-yield cycles before a strategy gets benched",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_PROBE_INTERVAL",
        defaultValue: "6",
        description: "Cycles between probe runs for benched strategies",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_STRATEGY_HISTORY",
        defaultValue: "12",
        description: "Strategy yield history length",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_LLM_BUDGET",
        defaultValue: "0.35",
        description: "LLM dream budget as fraction of total (0.0-1.0)",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_PGO_BUDGET",
        defaultValue: "0.15",
        description: "PGO wave budget as fraction of total (0.0-1.0)",
        section: "Adaptive Dream Strategy",
      },
      {
        key: "DG_NORMALIZER_BATCH_SIZE",
        defaultValue: "20",
        description: "Max edges per LLM semantic validation batch",
        section: "Normalizer Tuning",
      },
      {
        key: "DG_NORMALIZER_LLM_THRESHOLD",
        defaultValue: "0.35",
        description: "Minimum confidence for LLM semantic evaluation of latent edges",
        section: "Normalizer Tuning",
      },
      {
        key: "DATABASE_URL",
        defaultValue: "postgresql://user:password@host:5432/dbname",
        description: "PostgreSQL connection string used by database schema/query tools",
        section: "Database",
      },
      {
        key: "DG_DB_MAX_CONNECTIONS",
        defaultValue: "3",
        description: "Max concurrent PostgreSQL connections",
        section: "Database",
      },
      {
        key: "DG_DB_STATEMENT_TIMEOUT",
        defaultValue: "5000",
        description: "Statement timeout (ms)",
        section: "Database",
      },
      {
        key: "DG_DB_OPERATION_TIMEOUT",
        defaultValue: "10000",
        description: "Operation timeout (ms) — hard cap on entire query_db_schema",
        section: "Database",
      },
    ];

    const lines: string[] = [
      "# DreamGraph Engine Configuration",
      "# Per-instance environment settings. Uncomment and edit as needed.",
      "# Values here override global environment variables.",
      "",
    ];

    let currentSection = "";
    for (const entry of template) {
      if (entry.section !== currentSection) {
        if (currentSection !== "") lines.push("");
        if ([
          "Promotion & Retention Thresholds",
          "Dream Decay",
          "Tension System",
          "Adaptive Dream Strategy",
          "Normalizer Tuning",
          "Database",
        ].includes(entry.section) && currentSection !== entry.section) {
          if (!lines.includes("# ===================================================================")) {
            lines.push("# ===================================================================");
            lines.push("# ADVANCED TUNING — for experienced users only.");
            lines.push("# These control cognitive engine internals. The defaults work well");
            lines.push("# for most projects. Only change them if you know what you're doing.");
            lines.push("# ===================================================================");
            lines.push("");
          }
        }
        if (!["LLM Provider", "Base LLM Defaults", "Dreamer", "Normalizer"].includes(entry.section)) {
          lines.push(`# --- ${entry.section} ---`);
        }
        currentSection = entry.section;
      }

      lines.push(`# ${entry.description}`);
      const value = vars[entry.key] ?? "";
      if (value === "" || value == null) {
        lines.push(`# ${entry.key}=${entry.defaultValue}`);
      } else {
        const needsQuotes = /[\s#"']/.test(value);
        lines.push(`${entry.key}=${needsQuotes ? `"${value}"` : value}`);
      }
    }

    const remainingKeys = Object.keys(vars).filter(
      key => !template.some(entry => entry.key === key),
    );
    if (remainingKeys.length > 0) {
      lines.push("");
      lines.push("# Additional persisted values");
      for (const key of remainingKeys.sort()) {
        const value = vars[key] ?? "";
        if (value === "" || value == null) {
          lines.push(`# ${key}=`);
        } else {
          const needsQuotes = /[\s#"']/.test(value);
          lines.push(`${key}=${needsQuotes ? `"${value}"` : value}`);
        }
      }
    }

    lines.push("");
    writeFileSync(envPath, lines.join("\n"), "utf-8");
    logger.info(`engine.env: persisted ${Object.keys(vars).length} keys to ${envPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`engine.env: failed to write ${envPath}: ${msg}`);
  }
}

/**
 * Load an engine.env file and inject its values into process.env.
 *
 * @param envPath  Absolute path to the engine.env file.
 * @returns        Number of env vars loaded.
 */
export function loadEngineEnv(envPath: string): number {
  if (!existsSync(envPath)) {
    return 0;
  }

  let loaded = 0;

  try {
    const content = readFileSync(envPath, "utf-8");
    const lines = content.split(/\r?\n/);

    for (const raw of lines) {
      const line = raw.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith("#")) continue;

      // Find the first `=`
      const eqIdx = line.indexOf("=");
      if (eqIdx <= 0) continue;

      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Validate key — must look like an env var name
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
        logger.warn(`engine.env: skipping invalid key "${key}"`);
        continue;
      }

      // Instance config OVERRIDES global env (per-instance wins)
      process.env[key] = value;
      loaded++;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`engine.env: failed to load ${envPath}: ${msg}`);
  }

  return loaded;
}
