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
import type { ResolvedInstance, RegistryEntry, CliStatusResponse } from "./types.js";
/**
 * Read the master registry file.
 * Returns an empty array on any I/O error (file missing, corrupt JSON, etc.)
 */
export declare function readRegistry(masterDir: string): Promise<RegistryEntry[]>;
/**
 * Query daemon status for an instance via `dg status --instance <uuid> --json`.
 * This is the authoritative source for port, pid, running state, project root.
 * Returns null if the CLI call fails (instance not found, CLI not installed, etc.)
 */
export declare function queryCliStatus(uuid: string, timeoutMs?: number): Promise<CliStatusResponse | null>;
export interface ResolveOptions {
    /** dreamgraph.instanceUuid from workspace settings */
    workspaceInstanceUuid: string | undefined;
    /** Absolute path to the current workspace folder */
    workspaceFolderPath: string | undefined;
    /** dreamgraph.masterDir — defaults to ~/.dreamgraph */
    masterDir: string;
    /** dreamgraph.daemonHost — used when building the HTTP client endpoint */
    daemonHost: string;
}
export interface ResolveResult {
    instance: ResolvedInstance | null;
    /** Registry entries for the manual fallback quick pick */
    registryEntries: RegistryEntry[];
}
/**
 * Run the discovery chain (steps 1–3).
 * Returns the resolved instance or null (caller should offer manual pick).
 */
export declare function resolveInstance(options: ResolveOptions): Promise<ResolveResult>;
//# sourceMappingURL=instance-resolver.d.ts.map