/**
 * DreamGraph v6.0 "La Catedral" — Master Registry.
 *
 * Manages the global `instances.json` file that indexes all known
 * DreamGraph instances under the master directory (~/.dreamgraph/).
 *
 * Operations:
 *   loadRegistry()       — Read the master registry (create if missing)
 *   saveRegistry()       — Write the master registry atomically
 *   registerInstance()   — Add a new instance to the registry
 *   deregisterInstance() — Remove an instance from the registry
 *   updateInstanceEntry()— Update fields (name, status, last_active_at)
 *   findInstance()       — Look up by UUID or name
 *   listInstances()      — Get all entries, optionally filtered
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  MasterRegistry,
  RegistryEntry,
  InstanceStatus,
  DreamGraphInstance,
} from "./types.js";
import { INSTANCE_SCHEMA_VERSION } from "./types.js";
import { withFileLock } from "../utils/mutex.js";
import { logger } from "../utils/logger.js";

/* ------------------------------------------------------------------ */
/*  Master directory resolution                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the master directory.
 *
 * Priority:
 *   1. DREAMGRAPH_MASTER_DIR env var (absolute path)
 *   2. ~/.dreamgraph/  (cross-platform home directory)
 */
export function resolveMasterDir(): string {
  const envDir = process.env.DREAMGRAPH_MASTER_DIR;
  if (envDir) return resolve(envDir);

  const home =
    process.env.HOME ??
    process.env.USERPROFILE ??
    process.env.HOMEPATH ??
    ".";
  return resolve(home, ".dreamgraph");
}

/* ------------------------------------------------------------------ */
/*  Registry I/O                                                      */
/* ------------------------------------------------------------------ */

const REGISTRY_FILENAME = "instances.json";

/** Path to the registry file. */
function registryPath(masterDir: string): string {
  return resolve(masterDir, REGISTRY_FILENAME);
}

/** Mutex key for the registry file. Shared across all instances. */
const REGISTRY_LOCK_KEY = "master:instances.json";

/**
 * Load the master registry from disk.
 * Creates both the master directory and an empty registry if they don't exist.
 */
export async function loadRegistry(
  masterDir?: string,
): Promise<{ registry: MasterRegistry; masterDir: string }> {
  const dir = masterDir ?? resolveMasterDir();
  const filePath = registryPath(dir);

  // Ensure master directory exists
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
    logger.info(`Created master directory: ${dir}`);
  }

  // Read or create
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    // Defensive: ensure structure
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.schema_version === INSTANCE_SCHEMA_VERSION &&
      Array.isArray(parsed.instances)
    ) {
      return { registry: parsed as MasterRegistry, masterDir: dir };
    }

    logger.warn(
      `Registry at ${filePath} has unexpected structure, resetting.`,
    );
  } catch {
    // File doesn't exist or is corrupt — create a fresh one
  }

  const empty: MasterRegistry = {
    schema_version: INSTANCE_SCHEMA_VERSION,
    instances: [],
  };
  await writeFile(filePath, JSON.stringify(empty, null, 2), "utf-8");
  logger.info(`Initialized empty master registry: ${filePath}`);
  return { registry: empty, masterDir: dir };
}

/**
 * Write the master registry to disk atomically (within a mutex).
 */
export async function saveRegistry(
  registry: MasterRegistry,
  masterDir?: string,
): Promise<void> {
  const dir = masterDir ?? resolveMasterDir();
  const filePath = registryPath(dir);

  await withFileLock(REGISTRY_LOCK_KEY, async () => {
    await writeFile(filePath, JSON.stringify(registry, null, 2), "utf-8");
  });
}

/* ------------------------------------------------------------------ */
/*  CRUD operations                                                   */
/* ------------------------------------------------------------------ */

/**
 * Register a new instance in the master registry.
 * Idempotent — if the UUID already exists, updates it.
 */
export async function registerInstance(
  instance: DreamGraphInstance,
  masterDir?: string,
): Promise<void> {
  const dir = masterDir ?? resolveMasterDir();

  await withFileLock(REGISTRY_LOCK_KEY, async () => {
    const { registry } = await loadRegistry(dir);

    const entry: RegistryEntry = {
      uuid: instance.uuid,
      name: instance.name,
      project_root: instance.project_root,
      mode: instance.mode,
      status: "active",
      created_at: instance.created_at,
      last_active_at: instance.last_active_at,
    };

    const idx = registry.instances.findIndex((e) => e.uuid === instance.uuid);
    if (idx >= 0) {
      registry.instances[idx] = entry;
      logger.info(`Updated registry entry for instance ${instance.uuid}`);
    } else {
      registry.instances.push(entry);
      logger.info(`Registered new instance ${instance.uuid} (${instance.name})`);
    }

    const filePath = registryPath(dir);
    await writeFile(filePath, JSON.stringify(registry, null, 2), "utf-8");
  });
}

/**
 * Remove an instance from the master registry.
 * Does NOT delete the instance directory — that is a separate operation.
 */
export async function deregisterInstance(
  uuid: string,
  masterDir?: string,
): Promise<boolean> {
  const dir = masterDir ?? resolveMasterDir();

  return withFileLock(REGISTRY_LOCK_KEY, async () => {
    const { registry } = await loadRegistry(dir);
    const before = registry.instances.length;
    registry.instances = registry.instances.filter((e) => e.uuid !== uuid);

    if (registry.instances.length === before) {
      logger.warn(`Instance ${uuid} not found in registry`);
      return false;
    }

    const filePath = registryPath(dir);
    await writeFile(filePath, JSON.stringify(registry, null, 2), "utf-8");
    logger.info(`Deregistered instance ${uuid}`);
    return true;
  });
}

/**
 * Update specific fields on a registry entry.
 */
export async function updateInstanceEntry(
  uuid: string,
  updates: Partial<Pick<RegistryEntry, "name" | "status" | "last_active_at" | "project_root" | "mode">>,
  masterDir?: string,
): Promise<boolean> {
  const dir = masterDir ?? resolveMasterDir();

  return withFileLock(REGISTRY_LOCK_KEY, async () => {
    const { registry } = await loadRegistry(dir);
    const entry = registry.instances.find((e) => e.uuid === uuid);
    if (!entry) {
      logger.warn(`Instance ${uuid} not found in registry for update`);
      return false;
    }

    Object.assign(entry, updates);

    const filePath = registryPath(dir);
    await writeFile(filePath, JSON.stringify(registry, null, 2), "utf-8");
    logger.debug(`Updated registry entry for ${uuid}: ${JSON.stringify(updates)}`);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  Query                                                             */
/* ------------------------------------------------------------------ */

/**
 * Find an instance by UUID or name.
 */
export function findInstance(
  registry: MasterRegistry,
  query: string,
): RegistryEntry | undefined {
  // Try UUID first (exact match)
  const byUuid = registry.instances.find((e) => e.uuid === query);
  if (byUuid) return byUuid;

  // Then try name (case-insensitive)
  const lower = query.toLowerCase();
  return registry.instances.find((e) => e.name.toLowerCase() === lower);
}

/**
 * List all instances, optionally filtered by status.
 */
export function listInstances(
  registry: MasterRegistry,
  status?: InstanceStatus,
): RegistryEntry[] {
  if (!status) return [...registry.instances];
  return registry.instances.filter((e) => e.status === status);
}
