"use strict";
/**
 * DreamGraph Status Bar — Layer 1 (VS Code Integration).
 *
 * Displays connection state and instance name in the status bar.
 *
 * Formats (§2.5):
 *   $(check)   DG: my-project ✓   — connected
 *   $(warning) DG: my-project ⚠   — degraded
 *   $(error)   DG: disconnected    — no connection
 *   $(loading~spin) DG: connecting… — connecting
 *
 * Click → quick pick with connection commands.
 *
 * @see TDD §2.5 (Status Bar)
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
exports.StatusBarManager = void 0;
const vscode = __importStar(require("vscode"));
/* ------------------------------------------------------------------ */
/*  Status Bar Manager                                                */
/* ------------------------------------------------------------------ */
class StatusBarManager {
    _item;
    _instanceName = "";
    constructor() {
        this._item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this._item.command = "dreamgraph.statusQuickPick";
        this._item.name = "DreamGraph";
        this._setDisconnected();
        this._item.show();
    }
    /* ---- Public API ---- */
    /**
     * Update after a health state change.
     */
    update(state, instanceName) {
        if (instanceName !== undefined) {
            this._instanceName = instanceName;
        }
        this._render(state.status, state.cognitiveState);
    }
    /**
     * Convenience: set to connecting state.
     */
    setConnecting() {
        this._render("connecting");
    }
    /**
     * Convenience: set to disconnected state.
     */
    setDisconnected() {
        this._setDisconnected();
    }
    dispose() {
        this._item.dispose();
    }
    /* ---- Rendering ---- */
    _render(status, cognitiveState) {
        const cog = cognitiveState && cognitiveState !== "unknown"
            ? ` [${cognitiveState.toUpperCase()}]`
            : "";
        switch (status) {
            case "connected":
                this._item.text = `$(check) DG: ${this._instanceName || "connected"} ✓${cog}`;
                this._item.tooltip = `DreamGraph: Connected${cog}\nClick for options`;
                this._item.backgroundColor = undefined;
                break;
            case "degraded":
                this._item.text = `$(warning) DG: ${this._instanceName || "degraded"} ⚠${cog}`;
                this._item.tooltip = `DreamGraph: Degraded${cog}\nSome services unavailable.\nClick for options`;
                this._item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
                break;
            case "connecting":
                this._item.text = "$(loading~spin) DG: connecting…";
                this._item.tooltip = "DreamGraph: Connecting…";
                this._item.backgroundColor = undefined;
                break;
            case "disconnected":
                this._setDisconnected();
                break;
        }
    }
    _setDisconnected() {
        this._item.text = "$(error) DG: disconnected";
        this._item.tooltip = "DreamGraph: Not connected\nClick to connect";
        this._item.backgroundColor = new vscode.ThemeColor("statusBarItem.errorBackground");
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=status-bar.js.map