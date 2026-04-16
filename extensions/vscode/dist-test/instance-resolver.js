"use strict";
/**
 * DreamGraph Instance Resolver — Layer 3.
 *
 * Implements the §2.2 discovery chain:
 *   1. Workspace setting (dreamgraph.instanceUuid)
 *   2. Project root match (scan ~/.dreamgraph/instances.json)
 *   3. Environment variable (DREAMGRAPH_INSTANCE_UUID)
 *   4. Manual selection (user picks via quick pick)
 *
 * Daemon status (port, pid, running) is queried via `dg status --instance
 * <uuid> --json` because the master registry does not store runtime info.
 *
 * No VS Code API dependency in the resolution logic itself — the caller
 * passes workspace config values and the resolver returns data.
 * The quick-pick fallback is handled by the command layer.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readRegistry = readRegistry;
exports.queryCliStatus = queryCliStatus;
exports.resolveInstance = resolveInstance;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const cp = __importStar(require("node:child_process"));
/* ------------------------------------------------------------------ */
/*  Master Registry I/O                                               */
/* ------------------------------------------------------------------ */
/**
 * Expand `~` to the user home directory and resolve the path.
 */
function expandHome(p) {
    if (p.startsWith("~")) {
        return path.join(os.homedir(), p.slice(1));
    }
    return p;
}
/**
 * Read the master registry file.
 * Returns an empty array on any I/O error (file missing, corrupt JSON, etc.)
 */
async function readRegistry(masterDir) {
    try {
        const filePath = path.join(expandHome(masterDir), "instances.json");
        const raw = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        // The registry file is { schema_version, instances: [...] }
        // Support both the wrapped format and a raw array for forward compat.
        const entries = Array.isArray(data)
            ? data
            : Array.isArray(data?.instances)
                ? data.instances
                : [];
        return entries;
    }
    catch {
        return [];
    }
}
/* ------------------------------------------------------------------ */
/*  CLI Status Query                                                  */
/* ------------------------------------------------------------------ */
/**
 * Query daemon status for an instance via `dg status --instance <uuid> --json`.
 * This is the authoritative source for port, pid, running state, project root.
 * Returns null if the CLI call fails (instance not found, CLI not installed, etc.)
 */
function queryCliStatus(uuid, timeoutMs = 8000) {
    return new Promise((resolve) => {
        cp.exec(`dg status --instance ${uuid} --json`, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
            if (err) {
                resolve(null);
                return;
            }
            try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
            }
            catch {
                resolve(null);
            }
        });
    });
}
/**
 * Run the discovery chain (steps 1–3).
 * Returns the resolved instance or null (caller should offer manual pick).
 */
async function resolveInstance(options) {
    const registry = await readRegistry(options.masterDir);
    // Step 1: Workspace setting
    if (options.workspaceInstanceUuid) {
        const entry = registry.find((e) => e.uuid === options.workspaceInstanceUuid);
        if (entry) {
            const instance = await probeAndBuild(entry, "workspace_setting");
            return { instance, registryEntries: registry };
        }
    }
    // Step 2a: Project root match from registry
    if (options.workspaceFolderPath) {
        const normalized = normalizePath(options.workspaceFolderPath);
        const entry = registry.find((e) => e.project_root !== null &&
            normalizePath(e.project_root) === normalized);
        if (entry) {
            const instance = await probeAndBuild(entry, "project_match");
            return { instance, registryEntries: registry };
        }
        // Step 2b: Registry project_root may be null or stale.
        // Query `dg status` for each entry — the CLI always knows the real
        // project dir even when the registry doesn't.
        for (const entry of registry) {
            if (entry.project_root !== null)
                continue; // already checked above
            const cliStatus = await queryCliStatus(entry.uuid);
            if (cliStatus?.project.root &&
                normalizePath(cliStatus.project.root) === normalized) {
                const instance = buildFromCliStatus(cliStatus, entry, "project_match");
                return { instance, registryEntries: registry };
            }
        }
    }
    // Step 3: Environment variable
    const envUuid = process.env.DREAMGRAPH_INSTANCE_UUID;
    if (envUuid) {
        const entry = registry.find((e) => e.uuid === envUuid);
        if (entry) {
            const instance = await probeAndBuild(entry, "env_var");
            return { instance, registryEntries: registry };
        }
    }
    // Step 4 is manual — return null so the caller can show a quick pick
    return { instance: null, registryEntries: registry };
}
/* ------------------------------------------------------------------ */
/*  Probe + Build                                                     */
/* ------------------------------------------------------------------ */
/**
 * Build a ResolvedInstance from a CLI status response.
 */
function buildFromCliStatus(cliStatus, entry, source) {
    return {
        uuid: cliStatus.identity.uuid,
        name: cliStatus.identity.name,
        project_root: cliStatus.project.root,
        mode: entry.mode,
        status: entry.status,
        daemon: {
            running: cliStatus.daemon.running,
            pid: cliStatus.daemon.pid,
            port: cliStatus.daemon.port,
            transport: (cliStatus.daemon.transport === "http" ? "http" : "stdio"),
            version: cliStatus.daemon.version ?? cliStatus.identity.version,
        },
        source,
    };
}
/**
 * Given a registry entry, query its daemon status via `dg status` CLI
 * and build a ResolvedInstance with accurate port/pid/running info.
 */
async function probeAndBuild(entry, source) {
    const cliStatus = await queryCliStatus(entry.uuid);
    if (cliStatus) {
        return buildFromCliStatus(cliStatus, entry, source);
    }
    // CLI failed — return what we know from the registry (daemon status unknown)
    return {
        uuid: entry.uuid,
        name: entry.name,
        project_root: entry.project_root,
        mode: entry.mode,
        status: entry.status,
        daemon: {
            running: false,
            pid: null,
            port: null,
            transport: "http",
            version: null,
        },
        source,
    };
}
/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
/**
 * Normalize a filesystem path for comparison (lowercase on Windows,
 * forward slashes, no trailing slash).
 */
function normalizePath(p) {
    let result = p.replace(/\\/g, "/").replace(/\/+$/, "");
    if (process.platform === "win32") {
        result = result.toLowerCase();
    }
    return result;
}
//# sourceMappingURL=instance-resolver.js.map