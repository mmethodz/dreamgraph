# DreamGraph Dashboard View

> Embeds the daemon status dashboard in a dockable sidebar webview so users can inspect operational status without leaving VS Code.

**ID:** `dreamgraph_dashboard_view`  
**Category:** data_display  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| daemon_url | `string` | ✅ | Resolved daemon status endpoint URL used as iframe source. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| retry | `void` | on_click | Requests a refresh when the offline fallback retry button is clicked. |

## Interactions

- **inspect_status** — View the daemon dashboard in an embedded iframe.
- **retry_load** — Retry loading when the daemon is unreachable.

## Visual Semantics

- **Role:** panel
- **Emphasis:** secondary
- **Density:** comfortable
- **Chrome:** panel

## Layout Semantics

- **Pattern:** shell
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `Webview iframe dashboard` | extensions/vscode/src/dashboard-view.ts | Displays /status in an iframe with offline fallback. |

**Used by features:** dreamgraph_extensions_vscode_src

**Tags:** ui, dashboard, status, webview
