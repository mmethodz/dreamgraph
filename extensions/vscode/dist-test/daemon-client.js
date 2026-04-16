"use strict";
/**
 * DreamGraph Daemon HTTP Client — Layer 3.
 *
 * Pure HTTP client for the daemon's REST API. No VS Code dependencies.
 * Handles /health, /api/instance, /api/graph-context, and /api/validate.
 *
 * @see TDD §1.2 (Layer 3), §1.4 (Communication Protocol), §2.4 (Health)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonClient = void 0;
/* ------------------------------------------------------------------ */
/*  Client                                                            */
/* ------------------------------------------------------------------ */
class DaemonClient {
    _host;
    _port;
    _timeoutMs;
    _abortController = null;
    constructor(options) {
        this._host = options.host;
        this._port = options.port;
        this._timeoutMs = options.timeoutMs ?? 5000;
    }
    /* ---- Configuration ---- */
    get baseUrl() {
        return `http://${this._host}:${this._port}`;
    }
    get port() {
        return this._port;
    }
    updateEndpoint(host, port) {
        this._host = host;
        this._port = port;
    }
    /* ---- Health ---- */
    /**
     * Probe `GET /health` (Accept: application/json).
     * Returns the health response + latency, or null on failure.
     */
    async getHealth() {
        const start = Date.now();
        try {
            const res = await this._fetch("/health", {
                headers: { Accept: "application/json" },
            });
            if (!res.ok)
                return null;
            const body = (await res.json());
            return { response: body, latencyMs: Date.now() - start };
        }
        catch {
            return null;
        }
    }
    /**
     * Quick boolean check — is the daemon responsive?
     */
    async isAvailable() {
        const result = await this.getHealth();
        return result !== null;
    }
    /* ---- Instance ---- */
    /**
     * Fetch full instance details from `GET /api/instance`.
     */
    async getInstance() {
        try {
            const res = await this._fetch("/api/instance");
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            return null;
        }
    }
    /* ---- Graph Context ---- */
    /**
     * Fetch graph-side enrichment for a file/feature set.
     * `POST /api/graph-context`
     */
    async getGraphContext(request) {
        try {
            const res = await this._fetch("/api/graph-context", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(request),
            });
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            return null;
        }
    }
    /* ---- Validate ---- */
    /**
     * Run combined validation (ADR + UI + API surface).
     * `POST /api/validate`
     */
    async validate(body) {
        try {
            const res = await this._fetch("/api/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            return null;
        }
    }
    /* ---- Lifecycle ---- */
    /**
     * Cancel any in-flight requests (used on dispose).
     */
    dispose() {
        this._abortController?.abort();
    }
    /* ---- Internal ---- */
    async _fetch(path, init) {
        this._abortController = new AbortController();
        const timeoutId = setTimeout(() => this._abortController?.abort(), this._timeoutMs);
        try {
            return await fetch(`${this.baseUrl}${path}`, {
                ...init,
                signal: this._abortController.signal,
            });
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
}
exports.DaemonClient = DaemonClient;
//# sourceMappingURL=daemon-client.js.map