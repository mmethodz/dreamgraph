/**
 * DreamGraph Health Monitor — Layer 3 / Layer 2 bridge.
 *
 * Polls `GET /health` at a configurable interval (default 10s).
 * Tracks connection state and emits events on transitions.
 *
 * State machine (§2.4):
 *   disconnected → connecting → connected | disconnected
 *   connected → degraded | disconnected
 *   degraded → connected | disconnected
 *   disconnected → connecting (auto-reconnect or manual)
 *
 * @see TDD §2.4 (Health Monitoring)
 */

import * as vscode from "vscode";
import { DaemonClient } from "./daemon-client.js";
import type {
  ConnectionStatus,
  HealthState,
  HealthTransitionEvent,
  DaemonInstanceResponse,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

/** Max consecutive failures before connected → disconnected */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Max retries when in connecting state before giving up */
const MAX_CONNECT_RETRIES = 5;

/* ------------------------------------------------------------------ */
/*  Monitor                                                           */
/* ------------------------------------------------------------------ */

export class HealthMonitor implements vscode.Disposable {
  private _client: DaemonClient;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private _consecutiveFailures = 0;
  private _connectRetries = 0;
  private _disposed = false;

  /** Current health state */
  private _state: HealthState = {
    status: "disconnected",
    lastCheck: new Date(),
    latencyMs: 0,
    cognitiveState: "unknown",
    sessions: 0,
    llmAvailable: false,
    instanceUuid: "",
  };

  /** Cached instance details from last successful fetch */
  private _instanceDetails: DaemonInstanceResponse | null = null;

  /** Event emitter for health transitions */
  private readonly _onTransition =
    new vscode.EventEmitter<HealthTransitionEvent>();
  readonly onTransition: vscode.Event<HealthTransitionEvent> =
    this._onTransition.event;

  /** Event emitter for any state update (including non-transitions) */
  private readonly _onUpdate = new vscode.EventEmitter<HealthState>();
  readonly onUpdate: vscode.Event<HealthState> = this._onUpdate.event;

  constructor(client: DaemonClient) {
    this._client = client;
  }

  /* ---- Accessors ---- */

  get state(): HealthState {
    return { ...this._state };
  }

  get instanceDetails(): DaemonInstanceResponse | null {
    return this._instanceDetails;
  }

  /* ---- Lifecycle ---- */

  /**
   * Start polling. Sets state to `connecting` and begins health checks.
   */
  start(
    instanceUuid: string,
    intervalMs: number,
    reconnectIntervalMs: number,
  ): void {
    this.stop();
    this._state.instanceUuid = instanceUuid;
    this._transition("connecting", "Connection initiated");
    this._connectRetries = 0;

    // Immediate first check
    void this._check();

    // Periodic polling
    this._timer = setInterval(() => void this._check(), intervalMs);

    // Auto-reconnect timer (only fires when disconnected)
    if (reconnectIntervalMs > 0) {
      this._reconnectTimer = setInterval(() => {
        if (this._state.status === "disconnected") {
          this._transition("connecting", "Auto-reconnect");
          this._connectRetries = 0;
        }
      }, reconnectIntervalMs);
    }
  }

  /**
   * Stop all polling timers.
   */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /**
   * Force reconnect — transitions to connecting state.
   */
  reconnect(): void {
    this._consecutiveFailures = 0;
    this._connectRetries = 0;
    this._transition("connecting", "Manual reconnect");
    void this._check();
  }

  dispose(): void {
    this._disposed = true;
    this.stop();
    this._onTransition.dispose();
    this._onUpdate.dispose();
  }

  /* ---- Health Check ---- */

  private async _check(): Promise<void> {
    if (this._disposed) return;

    // Skip polling if we're disconnected and not connecting
    if (this._state.status === "disconnected") return;

    const result = await this._client.getHealth();

    if (result) {
      // Success
      this._consecutiveFailures = 0;
      const isDegraded = result.response.status !== "ok";

      // Fetch instance details on first success or periodically
      if (!this._instanceDetails || this._state.status !== "connected") {
        this._instanceDetails = await this._client.getInstance();
      }

      const newStatus: ConnectionStatus = isDegraded ? "degraded" : "connected";
      const cogState =
        this._instanceDetails?.cognitive?.state ?? "unknown";

      this._state = {
        status: newStatus,
        lastCheck: new Date(),
        latencyMs: result.latencyMs,
        cognitiveState: cogState,
        sessions: result.response.sessions,
        llmAvailable: !isDegraded,
        instanceUuid: this._state.instanceUuid,
      };

      if (this._state.status !== newStatus) {
        // _state was already updated, but we compare against the *previous* status
        // The transition was already set above via _state assignment — emit event
      }

      // Emit transition if status changed
      this._transition(newStatus);
      this._onUpdate.fire(this.state);
    } else {
      // Failure
      this._consecutiveFailures++;
      this._instanceDetails = null;

      if (this._state.status === "connecting") {
        this._connectRetries++;
        if (this._connectRetries >= MAX_CONNECT_RETRIES) {
          this._transition("disconnected", `Failed after ${MAX_CONNECT_RETRIES} retries`);
        }
      } else if (
        this._state.status === "connected" ||
        this._state.status === "degraded"
      ) {
        if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this._transition(
            "disconnected",
            `${MAX_CONSECUTIVE_FAILURES} consecutive health check failures`,
          );
        }
      }

      this._state.lastCheck = new Date();
      this._state.latencyMs = 0;
      this._onUpdate.fire(this.state);
    }
  }

  /* ---- State Transition ---- */

  private _previousStatus: ConnectionStatus = "disconnected";

  private _transition(to: ConnectionStatus, reason?: string): void {
    if (this._previousStatus === to) return;
    const from = this._previousStatus;
    this._previousStatus = to;
    this._state.status = to;

    this._onTransition.fire({
      from,
      to,
      timestamp: new Date(),
      reason,
    });
  }
}
