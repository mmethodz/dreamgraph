# Dashboard Shell

> Provides the canonical application shell for the DreamGraph dashboard, organizing navigation, summary, and primary content regions while preserving abstract visual hierarchy and composition semantics for cross-platform reconstruction.

**ID:** `ui_dashboard_shell`  
**Category:** layout  
**Status:** active  

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

## Visual Semantics

- **Role:** shell
- **Emphasis:** secondary
- **Density:** comfortable
- **Chrome:** full_shell

### State Styling

- **default** — Preserve clear application-level hierarchy between navigation, summary, and current content.
- **summary_attention** — Elevate high-signal summary regions without destabilizing the shell structure.
- **embedded_offline** — Promote recovery messaging when embedded dashboard access is degraded.

## Layout Semantics

- **Pattern:** shell
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll, collapse

### Layout Hierarchy

- **navigation** — secondary
- **summary** — primary
- **content** — primary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `DashboardPage` | src/server/dashboard.ts | Server-rendered dashboard shell with semantic sections and summary regions. |
| react | `VS Code webview iframe host` | extensions/vscode/src/dashboard-view.ts | Embeds the daemon dashboard /status surface inside a sidebar webview. |
| vscode | `Embedded dashboard host` | extensions/vscode/src/dashboard-view.ts | Acts as the semantic parent of the embedded /status dashboard surface inside the VS Code webview. |

**Used by features:** feature_dashboard_server, dashboard_server, dashboard, feature_vscode_extension, feature_ui_registry

**Tags:** dashboard, shell, navigation, summary, canonical, visual-meta-v3
