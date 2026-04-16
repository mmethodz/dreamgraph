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
import * as vscode from "vscode";
import type { HealthState } from "./types.js";
export declare class StatusBarManager implements vscode.Disposable {
    private readonly _item;
    private _instanceName;
    constructor();
    /**
     * Update after a health state change.
     */
    update(state: HealthState, instanceName?: string): void;
    /**
     * Convenience: set to connecting state.
     */
    setConnecting(): void;
    /**
     * Convenience: set to disconnected state.
     */
    setDisconnected(): void;
    dispose(): void;
    private _render;
    private _setDisconnected;
}
//# sourceMappingURL=status-bar.d.ts.map