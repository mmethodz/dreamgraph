"use strict";
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
exports.HealthMonitor = void 0;
const vscode = __importStar(require("vscode"));
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
class HealthMonitor {
    _client;
    _timer = null;
    _reconnectTimer = null;
    _consecutiveFailures = 0;
    _connectRetries = 0;
    _disposed = false;
    /** Current health state */
    _state = {
        status: "disconnected",
        lastCheck: new Date(),
        latencyMs: 0,
        cognitiveState: "unknown",
        sessions: 0,
        llmAvailable: false,
        instanceUuid: "",
    };
    /** Cached instance details from last successful fetch */
    _instanceDetails = null;
    /** Event emitter for health transitions */
    _onTransition = new vscode.EventEmitter();
    onTransition = this._onTransition.event;
    /** Event emitter for any state update (including non-transitions) */
    _onUpdate = new vscode.EventEmitter();
    onUpdate = this._onUpdate.event;
    constructor(client) {
        this._client = client;
    }
    /* ---- Accessors ---- */
    get state() {
        return { ...this._state };
    }
    get instanceDetails() {
        return this._instanceDetails;
    }
    /* ---- Lifecycle ---- */
    /**
     * Start polling. Sets state to `connecting` and begins health checks.
     */
    start(instanceUuid, intervalMs, reconnectIntervalMs) {
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
    stop() {
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
    reconnect() {
        this._consecutiveFailures = 0;
        this._connectRetries = 0;
        this._transition("connecting", "Manual reconnect");
        void this._check();
    }
    dispose() {
        this._disposed = true;
        this.stop();
        this._onTransition.dispose();
        this._onUpdate.dispose();
    }
    /* ---- Health Check ---- */
    async _check() {
        if (this._disposed)
            return;
        // Skip polling if we're disconnected and not connecting
        if (this._state.status === "disconnected")
            return;
        const result = await this._client.getHealth();
        if (result) {
            // Success
            this._consecutiveFailures = 0;
            const isDegraded = result.response.status !== "ok";
            // Fetch instance details on first success or periodically
            if (!this._instanceDetails || this._state.status !== "connected") {
                this._instanceDetails = await this._client.getInstance();
            }
            const newStatus = isDegraded ? "degraded" : "connected";
            const cogState = this._instanceDetails?.cognitive?.state ?? "unknown";
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
        }
        else {
            // Failure
            this._consecutiveFailures++;
            this._instanceDetails = null;
            if (this._state.status === "connecting") {
                this._connectRetries++;
                if (this._connectRetries >= MAX_CONNECT_RETRIES) {
                    this._transition("disconnected", `Failed after ${MAX_CONNECT_RETRIES} retries`);
                }
            }
            else if (this._state.status === "connected" ||
                this._state.status === "degraded") {
                if (this._consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                    this._transition("disconnected", `${MAX_CONSECUTIVE_FAILURES} consecutive health check failures`);
                }
            }
            this._state.lastCheck = new Date();
            this._state.latencyMs = 0;
            this._onUpdate.fire(this.state);
        }
    }
    /* ---- State Transition ---- */
    _previousStatus = "disconnected";
    _transition(to, reason) {
        if (this._previousStatus === to)
            return;
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
exports.HealthMonitor = HealthMonitor;
//# sourceMappingURL=health-monitor.js.map