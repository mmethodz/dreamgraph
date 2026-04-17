# Dashboard Shell

> Provides the canonical application shell for the DreamGraph dashboard, organizing navigation, summary, and primary content regions while preserving abstract visual hierarchy and composition semantics for cross-platform reconstruction.

**ID:** `ui_dashboard_shell`  
**Category:** layout  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| sections | `array<object>` | ✅ | Available dashboard sections and routes. |
| system_status | `object` | ❌ | Current daemon and system status summary. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| navigate | `string` | on_click | Selected section identifier. |

## Interactions

- **navigate** — Switch between top-level dashboard sections.
- **scan_status** — Visually scan summary areas and current system state.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `DashboardPage` | src/server/dashboard.ts | Server-rendered dashboard shell with semantic sections and summary regions. |
| react | `VS Code webview iframe host` | extensions/vscode/src/dashboard-view.ts | Embeds the daemon dashboard /status surface inside a sidebar webview. |
| vscode | `Embedded dashboard host` | extensions/vscode/src/dashboard-view.ts | Acts as the semantic parent of the embedded /status dashboard surface inside the VS Code webview. |

**Used by features:** feature_dashboard_server, dashboard_server, dashboard, feature_vscode_extension, feature_ui_registry

**Tags:** dashboard, shell, navigation, summary, canonical, visual-meta-v3
