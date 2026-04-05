/**
 * DreamGraph v6.0 "La Catedral" — Instance Scope.
 *
 * Enforces file-system isolation for a single DreamGraph instance.
 * Every file I/O operation should be validated through this class
 * to guarantee UUID-scoped confinement.
 *
 * Instance layout:
 *   <masterDir>/<uuid>/
 *     ├── instance.json
 *     ├── config/   (policies.json, mcp.json, schema_version.json)
 *     ├── data/     (all cognitive + seed JSON files)
 *     ├── runtime/  (locks/, cache/, temp/)
 *     ├── logs/     (system.log, scheduler.log, discipline.log)
 *     └── exports/  (docs/, snapshots/)
 */

import { resolve, relative, sep } from "node:path";
import type { DreamGraphInstance, ProjectBinding } from "./types.js";
import { logger } from "../utils/logger.js";

/* ------------------------------------------------------------------ */
/*  Scope Violation Error                                             */
/* ------------------------------------------------------------------ */

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeViolationError";
  }
}

/* ------------------------------------------------------------------ */
/*  InstanceScope                                                     */
/* ------------------------------------------------------------------ */

export class InstanceScope {
  /** UUID v4 — canonical instance identity. */
  readonly uuid: string;

  /** Absolute path to the master directory (e.g. ~/.dreamgraph). */
  readonly masterDir: string;

  /** Absolute path to this instance's root directory. */
  readonly instanceRoot: string;

  /** Absolute path to this instance's data directory. */
  readonly dataDir: string;

  /** Absolute path to this instance's config directory. */
  readonly configDir: string;

  /** Absolute path to this instance's runtime directory. */
  readonly runtimeDir: string;

  /** Absolute path to this instance's logs directory. */
  readonly logsDir: string;

  /** Absolute path to this instance's exports directory. */
  readonly exportsDir: string;

  /** Attached project root (null if unbound). */
  readonly projectRoot: string | null;

  /** Additional repository paths this instance may read. */
  readonly repos: Record<string, string>;

  constructor(
    uuid: string,
    masterDir: string,
    projectRoot: string | null = null,
    repos: Record<string, string> = {},
  ) {
    this.uuid = uuid;
    this.masterDir = resolve(masterDir);
    this.instanceRoot = resolve(masterDir, uuid);
    this.dataDir = resolve(masterDir, uuid, "data");
    this.configDir = resolve(masterDir, uuid, "config");
    this.runtimeDir = resolve(masterDir, uuid, "runtime");
    this.logsDir = resolve(masterDir, uuid, "logs");
    this.exportsDir = resolve(masterDir, uuid, "exports");
    this.projectRoot = projectRoot ? resolve(projectRoot) : null;
    this.repos = repos;
  }

  /**
   * Create an InstanceScope from a full DreamGraphInstance record.
   */
  static fromInstance(
    inst: DreamGraphInstance,
    masterDir: string,
    repos?: Record<string, string>,
  ): InstanceScope {
    return new InstanceScope(
      inst.uuid,
      masterDir,
      inst.project_root,
      repos ?? {},
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Boundary checks                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Is `targetPath` within this instance's own directory tree?
   */
  isOwnPath(targetPath: string): boolean {
    const resolved = resolve(targetPath);
    return (
      resolved === this.instanceRoot ||
      resolved.startsWith(this.instanceRoot + sep)
    );
  }

  /**
   * Is `targetPath` within the attached project's scope?
   * Includes the project root itself and any declared repo paths.
   */
  isProjectPath(targetPath: string): boolean {
    const resolved = resolve(targetPath);

    // Direct project root
    if (
      this.projectRoot !== null &&
      (resolved === this.projectRoot ||
        resolved.startsWith(this.projectRoot + sep))
    ) {
      return true;
    }

    // Declared repository paths
    for (const repoPath of Object.values(this.repos)) {
      const absRepo = resolve(repoPath);
      if (resolved === absRepo || resolved.startsWith(absRepo + sep)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Is `targetPath` within the allowed boundary?
   * Allowed = own instance dir OR attached project/repo paths.
   */
  isWithinBounds(targetPath: string): boolean {
    return this.isOwnPath(targetPath) || this.isProjectPath(targetPath);
  }

  /**
   * Does `targetPath` belong to ANOTHER instance under the same master dir?
   * This is the critical cross-instance contamination check.
   */
  isOtherInstance(targetPath: string): boolean {
    const resolved = resolve(targetPath);

    // Not inside master dir at all → not another instance
    if (!resolved.startsWith(this.masterDir + sep)) return false;

    // Inside master dir — check what top-level entry it belongs to
    const relativeToMaster = relative(this.masterDir, resolved);
    const topDir = relativeToMaster.split(sep)[0];

    // instances.json is not another instance, but it's also not ours
    if (topDir === "instances.json") return false;

    // If topDir is our own UUID, it's us
    if (topDir === this.uuid) return false;

    // Anything else under master dir is another instance
    return true;
  }

  /* ---------------------------------------------------------------- */
  /*  Guard functions                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Assert a path is within bounds.  Throws ScopeViolationError if not.
   */
  assertWithinBounds(targetPath: string, context?: string): void {
    if (this.isOtherInstance(targetPath)) {
      const msg =
        `BLOCKED: Attempted to access another instance's data. ` +
        `Path: ${targetPath}, Instance: ${this.uuid}` +
        (context ? `, Context: ${context}` : "");
      logger.error(msg);
      throw new ScopeViolationError(msg);
    }

    if (!this.isWithinBounds(targetPath)) {
      const msg =
        `BLOCKED: Path outside instance scope. ` +
        `Path: ${targetPath}, Instance: ${this.uuid}` +
        (context ? `, Context: ${context}` : "");
      logger.error(msg);
      throw new ScopeViolationError(msg);
    }
  }

  /**
   * Assert a path is within the instance's own data directory.
   * Stricter than assertWithinBounds — project paths are excluded.
   */
  assertOwnDataPath(targetPath: string, context?: string): void {
    const resolved = resolve(targetPath);
    if (
      resolved !== this.dataDir &&
      !resolved.startsWith(this.dataDir + sep)
    ) {
      const msg =
        `BLOCKED: Path is not within instance data directory. ` +
        `Path: ${targetPath}, Instance: ${this.uuid}` +
        (context ? `, Context: ${context}` : "");
      logger.error(msg);
      throw new ScopeViolationError(msg);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Convenience                                                     */
  /* ---------------------------------------------------------------- */

  /** Resolve a filename within the data directory. */
  dataPath(filename: string): string {
    return resolve(this.dataDir, filename);
  }

  /** Resolve a filename within the config directory. */
  configPath(filename: string): string {
    return resolve(this.configDir, filename);
  }

  /** Resolve a filename within the logs directory. */
  logPath(filename: string): string {
    return resolve(this.logsDir, filename);
  }

  /** Mutex key prefix for this instance. */
  mutexKey(filename: string): string {
    return `${this.uuid}:${filename}`;
  }

  /** Summary for logging / debugging. */
  toString(): string {
    return `InstanceScope(${this.uuid.slice(0, 8)}…, project=${this.projectRoot ?? "unbound"})`;
  }
}
