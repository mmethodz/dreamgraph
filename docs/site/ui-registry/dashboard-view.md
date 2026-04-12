---
title: "DreamGraph Dashboard View"
---

# DreamGraph Dashboard View

> Embed the DreamGraph daemon's live /status web UI inside a VS Code sidebar panel via iframe, giving developers real-time cognitive state visibility without leaving the editor. Acts as the primary human-facing window into the system's dream cycles, tensions, and knowledge graph health.

**ID:** `dashboard_view`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| daemonHost | `string` | ❌ | Daemon host from VS Code config (dreamgraph.daemonHost), defaults to 127.0.0.1 |
| daemonPort | `number` | ❌ | Daemon port from VS Code config (dreamgraph.daemonPort), defaults to 8010 |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| refresh | `void` | on_visibility_change | Force-reloads the iframe with the current daemon URL |
| open | `void` | on_command | Focuses the dashboard panel in the sidebar via dreamgraph.dashboardView.focus command |

## Interactions

- **view_cognitive_state** — User observes live dream cycle status, tensions, and graph health from the embedded daemon UI
- **retry_connection** — User clicks Retry button in the offline fallback view to reload the iframe
- **auto_refresh** — Panel automatically refreshes when it becomes visible after being hidden

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `WebviewViewProvider (DashboardViewProvider)` | extensions/vscode/src/dashboard-view.ts | Embeds daemon /status URL in iframe. Refreshes on visibility change. CSP-locked to daemon origin. Nonce-based script/style injection. |

**Used by features:** feature_vscode_extension, feature_self_model

**Tags:** vscode, dashboard, sidebar, webview, iframe, daemon, cognitive-state
