/**
 * DreamGraph Daemon HTTP Client — Layer 3.
 *
 * Pure HTTP client for the daemon's REST API. No VS Code dependencies.
 * Handles /health, /api/instance, /api/graph-context, and /api/validate.
 *
 * @see TDD §1.2 (Layer 3), §1.4 (Communication Protocol), §2.4 (Health)
 */

import type {
  DaemonHealthResponse,
  DaemonInstanceResponse,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

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
  features: Array<{ id: string; name: string; description: string }>;
  workflows: Array<{ id: string; name: string }>;
  adrs: Array<{ id: string; title: string; status: string }>;
  ui_elements: Array<{ id: string; name: string; element_type: string }>;
  api_surface: object | null;
  tensions: Array<{ id: string; description: string; severity: string }>;
}

/* ------------------------------------------------------------------ */
/*  Client                                                            */
/* ------------------------------------------------------------------ */

export class DaemonClient {
  private _host: string;
  private _port: number;
  private _timeoutMs: number;
  private _abortController: AbortController | null = null;

  constructor(options: DaemonClientOptions) {
    this._host = options.host;
    this._port = options.port;
    this._timeoutMs = options.timeoutMs ?? 5000;
  }

  /* ---- Configuration ---- */

  get baseUrl(): string {
    return `http://${this._host}:${this._port}`;
  }

  get port(): number {
    return this._port;
  }

  updateEndpoint(host: string, port: number): void {
    this._host = host;
    this._port = port;
  }

  /* ---- Health ---- */

  /**
   * Probe `GET /health` (Accept: application/json).
   * Returns the health response + latency, or null on failure.
   */
  async getHealth(): Promise<{
    response: DaemonHealthResponse;
    latencyMs: number;
  } | null> {
    const start = Date.now();
    try {
      const res = await this._fetch("/health", {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as DaemonHealthResponse;
      return { response: body, latencyMs: Date.now() - start };
    } catch {
      return null;
    }
  }

  /**
   * Quick boolean check — is the daemon responsive?
   */
  async isAvailable(): Promise<boolean> {
    const result = await this.getHealth();
    return result !== null;
  }

  /* ---- Instance ---- */

  /**
   * Fetch full instance details from `GET /api/instance`.
   */
  async getInstance(): Promise<DaemonInstanceResponse | null> {
    try {
      const res = await this._fetch("/api/instance");
      if (!res.ok) return null;
      return (await res.json()) as DaemonInstanceResponse;
    } catch {
      return null;
    }
  }

  /* ---- Graph Context ---- */

  /**
   * Fetch graph-side enrichment for a file/feature set.
   * `POST /api/graph-context`
   */
  async getGraphContext(
    request: GraphContextRequest,
  ): Promise<GraphContextResponse | null> {
    try {
      const res = await this._fetch("/api/graph-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!res.ok) return null;
      return (await res.json()) as GraphContextResponse;
    } catch {
      return null;
    }
  }

  /* ---- Validate ---- */

  /**
   * Run combined validation (ADR + UI + API surface).
   * `POST /api/validate`
   */
  async validate(body: {
    file_path: string;
    content?: string;
  }): Promise<{ ok: boolean; violations: unknown[] } | null> {
    try {
      const res = await this._fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return (await res.json()) as { ok: boolean; violations: unknown[] };
    } catch {
      return null;
    }
  }

  /* ---- Lifecycle ---- */

  /**
   * Cancel any in-flight requests (used on dispose).
   */
  dispose(): void {
    this._abortController?.abort();
  }

  /* ---- Internal ---- */

  private async _fetch(
    path: string,
    init?: RequestInit,
  ): Promise<Response> {
    this._abortController = new AbortController();
    const timeoutId = setTimeout(
      () => this._abortController?.abort(),
      this._timeoutMs,
    );

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: this._abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
