/**
 * DreamGraph v6.0 "La Catedral" — Instance Lifecycle Manager.
 *
 * Creates, loads, and manages DreamGraph instance directories.
 * Provides the bridge between legacy flat data/ mode and UUID-scoped mode.
 *
 * Resolution priority (decided at startup):
 *   1. DREAMGRAPH_INSTANCE_UUID env var → load that specific instance
 *   2. DREAMGRAPH_DATA_DIR env var → legacy flat mode (no UUID isolation)
 *   3. Default → legacy mode with ./data
 *
 * Legacy mode:
 *   When no UUID is set, DreamGraph operates in v5.x-compatible mode:
 *   config.dataDir resolves as before, no InstanceScope is created,
 *   and mutex keys remain unprefixed.  This preserves backward compat
 *   for existing deployments.
 */

import { mkdir, writeFile, readFile, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  DreamGraphInstance,
  PolicyProfile,
  InstanceMode,
  InstanceTransport,
  PoliciesFile,
  InstanceMcpConfig,
} from "./types.js";
import {
  INSTANCE_SCHEMA_VERSION,
  INSTANCE_DIRS,
  DATA_STUBS,
} from "./types.js";
import { InstanceScope } from "./scope.js";
import { resolveMasterDir, registerInstance, loadRegistry } from "./registry.js";
import { config } from "../config/config.js";
import { logger } from "../utils/logger.js";
import { setDataDirResolver } from "../utils/cache.js";
import { setDataDirOverride } from "../utils/paths.js";
import { setMutexKeyResolver } from "../utils/mutex.js";
import { loadEngineEnv } from "../utils/engine-env.js";

/** Project root — three levels up from dist/instance/lifecycle.js */
const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/* ------------------------------------------------------------------ */
/*  Active instance state (singleton per process)                     */
/* ------------------------------------------------------------------ */

/** The currently active InstanceScope, or null if running in legacy mode. */
let activeScope: InstanceScope | null = null;

/** In-memory tool-call counter — initialized from instance.json on startup. */
let _toolCallCount = 0;

/**
 * Get the active InstanceScope.
 * Returns null in legacy mode (no UUID isolation).
 */
export function getActiveScope(): InstanceScope | null {
  return activeScope;
}

/**
 * Check if we're running in UUID-scoped mode.
 */
export function isInstanceMode(): boolean {
  return activeScope !== null;
}

/**
 * Get the effective data directory.
 * UUID mode → instance's data dir.
 * Legacy mode → config.dataDir (flat).
 */
export function getEffectiveDataDir(): string {
  return activeScope?.dataDir ?? config.dataDir;
}

/**
 * Get a mutex key, optionally prefixed with instance UUID.
 * UUID mode → "<uuid>:<filename>"
 * Legacy mode → "<filename>" (unchanged behavior)
 */
export function getEffectiveMutexKey(filename: string): string {
  return activeScope?.mutexKey(filename) ?? filename;
}

/**
 * Record a single MCP tool invocation.
 * Increments the in-memory counter and persists to instance.json.
 * Safe to call in legacy mode (no-ops gracefully).
 */
export async function recordToolCall(): Promise<void> {
  _toolCallCount++;
  await updateInstanceCounters({ total_tool_calls: _toolCallCount });
}

/**
 * Get the current tool-call count (in-memory, for fast reads).
 */
export function getToolCallCount(): number {
  return _toolCallCount;
}

/* ------------------------------------------------------------------ */
/*  Default policy profiles                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_POLICIES: PoliciesFile = {
  schema_version: INSTANCE_SCHEMA_VERSION,
  profile: "strict",
  profiles: {
    strict: {
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
    },
    balanced: {
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
    },
    creative: {
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
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Instance creation                                                 */
/* ------------------------------------------------------------------ */

export interface CreateInstanceOptions {
  name: string;
  projectRoot?: string;
  mode?: InstanceMode;
  policyProfile?: PolicyProfile;
  transport?: InstanceTransport;
  repos?: Record<string, string>;
  masterDir?: string;
}

/**
 * Create a new DreamGraph instance with full directory scaffold.
 *
 * Steps:
 *   1. Generate UUID v4
 *   2. Create directory tree
 *   3. Write instance.json + config files + empty data stubs
 *   4. Register in master registry
 *   5. Return the InstanceScope
 */
export async function createInstance(
  opts: CreateInstanceOptions,
): Promise<{ instance: DreamGraphInstance; scope: InstanceScope }> {
  const uuid = randomUUID();
  const masterDir = opts.masterDir ?? resolveMasterDir();
  const instanceRoot = resolve(masterDir, uuid);
  const now = new Date().toISOString();

  logger.info(`Creating instance ${uuid} (${opts.name}) at ${instanceRoot}`);

  // 1. Create directory tree
  for (const subdir of INSTANCE_DIRS) {
    await mkdir(resolve(instanceRoot, subdir), { recursive: true });
  }

  // 2. Write instance.json
  const instance: DreamGraphInstance = {
    uuid,
    name: opts.name,
    project_root: opts.projectRoot ?? null,
    mode: opts.mode ?? "development",
    policy_profile: opts.policyProfile ?? "strict",
    version: config.server.version,
    transport: opts.transport ?? { type: "stdio" },
    created_at: now,
    last_active_at: now,
    total_dream_cycles: 0,
    total_tool_calls: 0,
  };

  await writeFile(
    resolve(instanceRoot, "instance.json"),
    JSON.stringify(instance, null, 2),
    "utf-8",
  );

  // 3. Write config files
  const policies: PoliciesFile = {
    ...DEFAULT_POLICIES,
    profile: opts.policyProfile ?? "strict",
  };
  await writeFile(
    resolve(instanceRoot, "config", "policies.json"),
    JSON.stringify(policies, null, 2),
    "utf-8",
  );

  const mcpConfig: InstanceMcpConfig = {
    instance_uuid: uuid,
    server: { name: config.server.name, version: config.server.version },
    transport: opts.transport ?? { type: "stdio" },
    tools: { enabled: ["*"], disabled: [], overrides: {} },
    discipline: {
      enabled: true,
      policy_profile: opts.policyProfile ?? "strict",
      requires_ground_truth: true,
    },
    data_dir: "./data",
    repos: opts.repos ?? {},
  };
  await writeFile(
    resolve(instanceRoot, "config", "mcp.json"),
    JSON.stringify(mcpConfig, null, 2),
    "utf-8",
  );

  await writeFile(
    resolve(instanceRoot, "config", "schema_version.json"),
    JSON.stringify({ schema_version: INSTANCE_SCHEMA_VERSION, migrated_at: now }, null, 2),
    "utf-8",
  );

  // engine.env — per-instance LLM & secrets configuration
  const engineEnvContent = [
    "# DreamGraph Engine Configuration",
    "# Per-instance LLM provider settings. Uncomment and edit as needed.",
    "# Values here override global environment variables.",
    "#",
    "# Provider: ollama (local, default) | openai (API) | sampling (MCP client) | none",
    "# DREAMGRAPH_LLM_PROVIDER=ollama",
    "#",
    "# Model name (provider-specific)",
    "# DREAMGRAPH_LLM_MODEL=qwen3:8b",
    "#",
    "# API base URL",
    "# DREAMGRAPH_LLM_URL=http://localhost:11434",
    "#",
    "# API key (for openai-compatible providers)",
    "# DREAMGRAPH_LLM_API_KEY=",
    "#",
    "# Creativity (0.0 = deterministic, 1.0 = maximum creativity)",
    "# DREAMGRAPH_LLM_TEMPERATURE=0.7",
    "#",
    "# Maximum response tokens per LLM call",
    "# DREAMGRAPH_LLM_MAX_TOKENS=2048",
    "",
  ].join("\n");

  await writeFile(
    resolve(instanceRoot, "config", "engine.env"),
    engineEnvContent,
    "utf-8",
  );

  // 4. Write data stubs — copy from templates/default/ first, fall back to DATA_STUBS
  const dataDir = resolve(instanceRoot, "data");
  const templateDir = resolve(PROJECT_ROOT, "templates", "default");
  let usedTemplates = false;

  if (existsSync(templateDir)) {
    try {
      const files = await readdir(templateDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const target = resolve(dataDir, file);
          if (!existsSync(target)) {
            await copyFile(resolve(templateDir, file), target);
          }
        }
      }
      usedTemplates = true;
      logger.debug(`Data stubs copied from ${templateDir}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Template copy failed, falling back to DATA_STUBS: ${msg}`);
    }
  }

  if (!usedTemplates) {
    for (const [filename, stub] of Object.entries(DATA_STUBS)) {
      const filePath = resolve(dataDir, filename);
      if (!existsSync(filePath)) {
        await writeFile(filePath, JSON.stringify(stub, null, 2), "utf-8");
      }
    }
    logger.debug("Data stubs written from in-code DATA_STUBS fallback");
  }

  // 5. Register in master registry
  await registerInstance(instance, masterDir);

  // 6. Build scope
  const scope = new InstanceScope(
    uuid,
    masterDir,
    opts.projectRoot ?? null,
    opts.repos ?? {},
  );

  logger.info(`Instance ${uuid} created successfully`);
  return { instance, scope };
}

/* ------------------------------------------------------------------ */
/*  Instance state updates                                            */
/* ------------------------------------------------------------------ */

/**
 * Update counters in the instance.json file.
 * Call after dream cycles, tool calls, etc. to keep status accurate.
 */
export async function updateInstanceCounters(
  updates: Partial<Pick<DreamGraphInstance, "total_dream_cycles" | "total_tool_calls" | "last_active_at">>,
): Promise<void> {
  const scope = getActiveScope();
  if (!scope) return; // Legacy mode — no instance.json to update

  const dir = resolveMasterDir();
  const instancePath = resolve(dir, scope.uuid, "instance.json");

  try {
    const raw = await readFile(instancePath, "utf-8");
    const instance = JSON.parse(raw) as DreamGraphInstance;

    if (updates.total_dream_cycles !== undefined) {
      instance.total_dream_cycles = updates.total_dream_cycles;
    }
    if (updates.total_tool_calls !== undefined) {
      instance.total_tool_calls = updates.total_tool_calls;
    }
    instance.last_active_at = updates.last_active_at ?? new Date().toISOString();

    await writeFile(instancePath, JSON.stringify(instance, null, 2), "utf-8");
  } catch (err) {
    logger.warn(`Failed to update instance counters: ${err instanceof Error ? err.message : err}`);
  }
}

/* ------------------------------------------------------------------ */
/*  Instance loading                                                  */
/* ------------------------------------------------------------------ */

/**
 * Load an existing instance by UUID.
 * Reads `<masterDir>/<uuid>/instance.json` and returns the scope.
 */
export async function loadInstance(
  uuid: string,
  masterDir?: string,
): Promise<{ instance: DreamGraphInstance; scope: InstanceScope }> {
  const dir = masterDir ?? resolveMasterDir();
  const instancePath = resolve(dir, uuid, "instance.json");

  const raw = await readFile(instancePath, "utf-8");
  const instance = JSON.parse(raw) as DreamGraphInstance;

  // Read repos from mcp.json if available
  let repos: Record<string, string> = {};
  const mcpPath = resolve(dir, uuid, "config", "mcp.json");
  try {
    const mcpRaw = await readFile(mcpPath, "utf-8");
    const mcpConfig = JSON.parse(mcpRaw) as InstanceMcpConfig;
    repos = mcpConfig.repos ?? {};
  } catch {
    // mcp.json may not exist yet
  }

  const scope = new InstanceScope(
    instance.uuid,
    dir,
    instance.project_root,
    repos,
  );

  return { instance, scope };
}

/* ------------------------------------------------------------------ */
/*  Startup resolution                                                */
/* ------------------------------------------------------------------ */

/**
 * Resolve the operating mode at startup.
 *
 * Called once during server initialization. Sets the process-wide
 * activeScope (or leaves it null for legacy mode).
 *
 * Resolution:
 *   1. DREAMGRAPH_INSTANCE_UUID → load specific instance
 *   2. Otherwise → legacy mode (flat data/)
 */
export async function resolveInstanceAtStartup(): Promise<InstanceScope | null> {
  const uuid = process.env.DREAMGRAPH_INSTANCE_UUID;

  if (!uuid) {
    logger.info("No DREAMGRAPH_INSTANCE_UUID set — running in legacy mode");
    activeScope = null;
    // Data dir resolver stays as default (config.dataDir)
    return null;
  }

  try {
    const { instance, scope } = await loadInstance(uuid);
    activeScope = scope;

    // Seed the in-memory tool-call counter from the persisted value
    _toolCallCount = instance.total_tool_calls ?? 0;

    // Wire the cache, path resolver, and mutex key resolver for instance mode
    setDataDirResolver(() => scope.dataDir);
    setDataDirOverride(scope.dataDir);
    setMutexKeyResolver((key) => scope.mutexKey(key));

    // Load per-instance engine.env (LLM provider, API keys, model config).
    // Values are injected into process.env BEFORE any config parsing runs,
    // so parseLlmConfig() picks up instance-specific overrides while
    // falling back to global env vars for anything not specified.
    const envVars = loadEngineEnv(scope.engineEnvPath);
    if (envVars > 0) {
      logger.info(`Loaded ${envVars} env vars from ${scope.engineEnvPath}`);
    }

    // Merge instance repos into config.repos so all tools can discover them.
    // mcp.json repos take precedence, then project_root as fallback default.
    for (const [name, repoPath] of Object.entries(scope.repos)) {
      config.repos[name] = repoPath;
    }
    // If project_root is set but no repos are configured, auto-register it
    if (instance.project_root && Object.keys(config.repos).length === 0) {
      const basename = instance.project_root.replace(/\\/g, "/").split("/").pop() ?? "project";
      config.repos[basename] = instance.project_root;
      logger.info(`Auto-registered project_root as repo '${basename}': ${instance.project_root}`);
    }

    logger.info(`Instance mode activated: ${scope}`);
    if (Object.keys(config.repos).length > 0) {
      logger.info(`Repos available: ${Object.keys(config.repos).join(", ")}`);
    }
    return scope;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to load instance ${uuid}: ${msg}`);
    logger.info("Falling back to legacy mode");
    activeScope = null;
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Migration helper                                                  */
/* ------------------------------------------------------------------ */

/**
 * Migrate an existing flat data/ directory into a new UUID instance.
 *
 * This copies all JSON files from the source data dir into the new
 * instance's data dir, preserving them.  The original data/ is untouched.
 */
export async function migrateFromLegacy(opts: {
  name: string;
  sourceDataDir: string;
  projectRoot?: string;
  repos?: Record<string, string>;
  policyProfile?: PolicyProfile;
  masterDir?: string;
}): Promise<{ instance: DreamGraphInstance; scope: InstanceScope }> {
  const { readdir, copyFile } = await import("node:fs/promises");

  // Create the instance first (with empty data stubs)
  const result = await createInstance({
    name: opts.name,
    projectRoot: opts.projectRoot,
    policyProfile: opts.policyProfile ?? "strict",
    repos: opts.repos,
    masterDir: opts.masterDir,
  });

  // Copy existing data files over the stubs
  const sourceDir = resolve(opts.sourceDataDir);
  const targetDir = result.scope.dataDir;

  try {
    const files = await readdir(sourceDir);
    let copied = 0;
    for (const file of files) {
      if (file.endsWith(".json")) {
        await copyFile(resolve(sourceDir, file), resolve(targetDir, file));
        copied++;
      }
    }
    logger.info(
      `Migrated ${copied} data files from ${sourceDir} to instance ${result.instance.uuid}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Migration copy encountered an issue: ${msg}`);
  }

  return result;
}
