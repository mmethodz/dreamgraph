# DreamGraph Dashboard View

> Embed the canonical DreamGraph dashboard inside a VS Code sidebar view so operators can monitor dashboard surfaces without leaving the editor, using an abstract embedded-shell contract rather than implementation-specific iframe styling.

**ID:** `dashboard_view`  
**Category:** composite  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| daemon_url | `string` | ✅ | Resolved daemon /status URL derived from runtime-discovered host and port or VS Code settings fallback. |
| view_visibility | `boolean` | ❌ | Whether the webview view is currently visible, used to trigger refresh behavior. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| refresh | `void` | on_visibility_change | Reloads the embedded dashboard iframe with the current daemon URL. |
| focus_view | `void` | on_command | Focuses the dashboard view in the VS Code sidebar. |

## Interactions

- **monitor_dashboard** — View the live DreamGraph dashboard inside the VS Code sidebar.
- **retry_connection** — Use the offline fallback retry button to attempt to reload the embedded dashboard when the daemon is unreachable.
- **auto_refresh_on_visibility** — Refresh the iframe whenever the view becomes visible again.

## Visual Semantics

- **Role:** shell
- **Emphasis:** secondary
- **Density:** comfortable
- **Chrome:** embedded

### State Styling

- **loading** — Keep the host calm and transitional while embedded content initializes.
- **connected** — Prioritize the embedded dashboard content over surrounding host chrome.
- **offline_fallback** — Promote warning feedback while preserving a clear recovery action path.

## Layout Semantics

- **Pattern:** shell
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

### Layout Hierarchy

- **embedded_dashboard** — primary
- **offline_recovery** — auxiliary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `WebviewViewProvider` | extensions/vscode/src/dashboard-view.ts | Embeds daemon /status in an iframe with CSP limited to daemon origin, refreshes on visibility changes, and shows an offline fallback on load failure or timeout. |

**Used by features:** feature_vscode_extension, feature_self_model, feature_dashboard_server, feature_ui_registry

**Tags:** vscode, dashboard, sidebar, webview, canonical, visual-meta-v3
