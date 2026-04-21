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
import type { ConnectionStatus, HealthState } from "./types.js";

/* ------------------------------------------------------------------ */
/*  Status Bar Manager                                                */
/* ------------------------------------------------------------------ */

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

export class StatusBarManager implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;
  private readonly _restoreItem: vscode.StatusBarItem;
  private _instanceName: string = "";
  private _isRestoreVisible = false;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this._item.command = "dreamgraph.statusQuickPick";
    this._item.name = "DreamGraph";

    this._restoreItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99,
    );
    this._restoreItem.command = "dreamgraph.restoreSidebar";
    this._restoreItem.name = "DreamGraph Restore Sidebar";
    this._restoreItem.text = "$(layers-active) DG Sidebar";
    this._restoreItem.tooltip = "DreamGraph: Restore sidebar icon and reopen the dashboard";
    this._restoreItem.backgroundColor = undefined;

    this._setDisconnected();
    this._item.show();
  }

  /* ---- Public API ---- */

  /**
   * Update after a health state change.
   */
  update(state: HealthState, instanceName?: string): void {
    if (instanceName !== undefined) {
      this._instanceName = instanceName;
    }
    this._render(state.status, state.cognitiveState);
  }

  /**
   * Convenience: set to connecting state.
   */
  setConnecting(): void {
    this._render("connecting");
  }

  /**
   * Convenience: set to disconnected state.
   */
  setDisconnected(): void {
    this._setDisconnected();
  }

  /**
   * Show or hide the explicit sidebar restore fallback button.
   */
  setRestoreSidebarVisible(visible: boolean): void {
    if (visible === this._isRestoreVisible) {
      return;
    }
    this._isRestoreVisible = visible;
    if (visible) {
      this._restoreItem.show();
    } else {
      this._restoreItem.hide();
    }
  }

  dispose(): void {
    this._restoreItem.dispose();
    this._item.dispose();
  }

  /* ---- Rendering ---- */

  private _render(status: ConnectionStatus, cognitiveState?: string): void {
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
        this._item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
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

  private _setDisconnected(): void {
    this._item.text = "$(error) DG: disconnected";
    this._item.tooltip = "DreamGraph: Not connected\nClick to connect";
    this._item.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
  }
}
