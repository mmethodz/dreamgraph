/**
 * DreamGraph Daemon HTTP Client — Layer 3.
 *
 * Pure HTTP client for the daemon's REST API. No VS Code dependencies.
 * Handles /health, /api/instance, /api/graph-context, and /api/validate.
 *
 * @see TDD §1.2 (Layer 3), §1.4 (Communication Protocol), §2.4 (Health)
 */
import type { DaemonHealthResponse, DaemonInstanceResponse } from "./types.js";
export interface DaemonClientOptions {
    host: string;
    port: number;
    /** Request timeout in ms (default: 5000) */
    timeoutMs?: number;
}
export interface GraphContextRequest {
    file_path?: string;
    feature_ids?: string[];
    include_adrs?: boolean;
    include_ui?: boolean;
    include_api_surface?: boolean;
    include_tensions?: boolean;
}
export interface GraphContextResponse {
    features: Array<{
        id: string;
        name: string;
        description?: string;
        relevance?: number;
    }>;
    workflows: Array<{
        id: string;
        name: string;
        relevance?: number;
    }>;
    adrs: Array<{
        id: string;
        title: string;
        status: string;
        summary?: string;
        relevance?: number;
    }>;
    ui_elements: Array<{
        id: string;
        name: string;
        element_type: string;
        relevance?: number;
    }>;
    api_surface: object | null;
    tensions: Array<{
        id: string;
        description?: string;
        summary?: string;
        severity?: string;
        urgency?: number;
        relevance?: number;
    }>;
    cognitive_state?: string;
}
export declare class DaemonClient {
    private _host;
    private _port;
    private _timeoutMs;
    private _abortController;
    constructor(options: DaemonClientOptions);
    get baseUrl(): string;
    get port(): number;
    updateEndpoint(host: string, port: number): void;
    /**
     * Probe `GET /health` (Accept: application/json).
     * Returns the health response + latency, or null on failure.
     */
    getHealth(): Promise<{
        response: DaemonHealthResponse;
        latencyMs: number;
    } | null>;
    /**
     * Quick boolean check — is the daemon responsive?
     */
    isAvailable(): Promise<boolean>;
    /**
     * Fetch full instance details from `GET /api/instance`.
     */
    getInstance(): Promise<DaemonInstanceResponse | null>;
    /**
     * Fetch graph-side enrichment for a file/feature set.
     * `POST /api/graph-context`
     */
    getGraphContext(request: GraphContextRequest): Promise<GraphContextResponse | null>;
    /**
     * Run combined validation (ADR + UI + API surface).
     * `POST /api/validate`
     */
    validate(body: {
        file_path: string;
        content?: string;
    }): Promise<{
        ok: boolean;
        violations: unknown[];
    } | null>;
    /**
     * Cancel any in-flight requests (used on dispose).
     */
    dispose(): void;
    private _fetch;
}
//# sourceMappingURL=daemon-client.d.ts.map