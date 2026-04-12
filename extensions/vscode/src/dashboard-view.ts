/**
 * DreamGraph Dashboard View — Dockable WebviewView provider.
 *
 * Embeds the daemon's web dashboard (served at /status) inside a VS Code
 * sidebar panel via an iframe. Refreshes on visibility change and when
 * the daemon connection changes.
 */

import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  Dashboard View Provider                                           */
/* ------------------------------------------------------------------ */

export class DashboardViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "dreamgraph.dashboardView";

  private _view: vscode.WebviewView | null = null;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /* ---- WebviewViewProvider ---- */

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    const daemonUrl = this._getDaemonUrl();

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.html = this._getHtml(daemonUrl);

    // Refresh iframe when view becomes visible
    this._disposables.push(
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          const url = this._getDaemonUrl();
          webviewView.webview.html = this._getHtml(url);
        }
      }),
    );

    webviewView.onDidDispose(
      () => {
        this._view = null;
      },
      null,
      this._disposables,
    );
  }

  /**
   * Force-refresh the dashboard content.
   */
  refresh(): void {
    if (this._view) {
      const url = this._getDaemonUrl();
      this._view.webview.html = this._getHtml(url);
    }
  }

  /**
   * Focus the dashboard view in the sidebar.
   */
  open(): void {
    void vscode.commands.executeCommand("dreamgraph.dashboardView.focus");
  }

  /* ---- Helpers ---- */

  private _getDaemonUrl(): string {
    const config = vscode.workspace.getConfiguration("dreamgraph");
    const host = config.get<string>("daemonHost") ?? "127.0.0.1";
    const port = config.get<number>("daemonPort") ?? 8010;
    return `http://${host}:${port}/status`;
  }

  private _getHtml(daemonUrl: string): string {
    const nonce = getNonce();
    const origin = (() => {
      try {
        return new URL(daemonUrl).origin;
      } catch {
        return "http://127.0.0.1:8010";
      }
    })();

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; frame-src ${origin}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
    iframe { width: 100%; height: 100%; border: none; }
    .offline {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 100%; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family);
      gap: 12px; padding: 24px; text-align: center;
    }
    .offline button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; padding: 6px 16px; cursor: pointer;
      font-family: inherit; font-size: 13px;
    }
    .offline button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <iframe id="dash" src="${daemonUrl}"></iframe>
  <div class="offline" id="offline" style="display:none">
    <span style="font-size:32px">🧠</span>
    <div>DreamGraph daemon is not reachable.</div>
    <div style="font-size:12px">Start the daemon or check <code>dreamgraph.daemonPort</code> setting.</div>
    <button onclick="location.reload()">Retry</button>
  </div>
  <script nonce="${nonce}">
    const iframe = document.getElementById("dash");
    const offline = document.getElementById("offline");
    // Show offline fallback if iframe fails to load
    iframe.addEventListener("error", () => {
      iframe.style.display = "none";
      offline.style.display = "flex";
    });
    // Timeout fallback — if iframe doesn't load within 5s, show offline
    const timeout = setTimeout(() => {
      try { if (!iframe.contentWindow || !iframe.contentWindow.document.body.innerHTML) throw 0; } catch {
        iframe.style.display = "none";
        offline.style.display = "flex";
      }
    }, 5000);
    iframe.addEventListener("load", () => clearTimeout(timeout));
  </script>
</body>
</html>`;
  }

  /* ---- Dispose ---- */

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }
}

/* ------------------------------------------------------------------ */
/*  Utility                                                           */
/* ------------------------------------------------------------------ */

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
