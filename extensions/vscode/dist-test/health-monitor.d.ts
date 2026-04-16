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
import type { HealthState, HealthTransitionEvent, DaemonInstanceResponse } from "./types.js";
export declare class HealthMonitor implements vscode.Disposable {
    private _client;
    private _timer;
    private _reconnectTimer;
    private _consecutiveFailures;
    private _connectRetries;
    private _disposed;
    /** Current health state */
    private _state;
    /** Cached instance details from last successful fetch */
    private _instanceDetails;
    /** Event emitter for health transitions */
    private readonly _onTransition;
    readonly onTransition: vscode.Event<HealthTransitionEvent>;
    /** Event emitter for any state update (including non-transitions) */
    private readonly _onUpdate;
    readonly onUpdate: vscode.Event<HealthState>;
    constructor(client: DaemonClient);
    get state(): HealthState;
    get instanceDetails(): DaemonInstanceResponse | null;
    /**
     * Start polling. Sets state to `connecting` and begins health checks.
     */
    start(instanceUuid: string, intervalMs: number, reconnectIntervalMs: number): void;
    /**
     * Stop all polling timers.
     */
    stop(): void;
    /**
     * Force reconnect — transitions to connecting state.
     */
    reconnect(): void;
    dispose(): void;
    private _check;
    private _previousStatus;
    private _transition;
}
//# sourceMappingURL=health-monitor.d.ts.map