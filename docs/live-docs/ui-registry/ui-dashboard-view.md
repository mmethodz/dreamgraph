# Dashboard View

> Present DreamGraph system status, knowledge graph counts, and cognitive insights in a consolidated monitoring surface for operators.

**ID:** `ui_dashboard_view`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| system_overview | `object` | ✅ | System overview summary including repository and graph counts. |
| cognitive_status | `object` | ✅ | Current cognitive engine state and dream graph statistics. |
| dream_insights | `object` | ❌ | Recent edges, tensions, clusters, and strongest hypotheses. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| refresh_requested | `void` | on_click | User requests a fresh status fetch. |
| entity_selected | `string` | on_click | User selects an entity or insight to inspect deeper. |

## Interactions

- **refresh** — Reload dashboard data from MCP resources and tools.
- **inspect_entity** — Open deeper details for a selected feature, workflow, tension, or insight.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `Dashboard` | src/server/dashboard.ts | Server-hosted dashboard surface. |
| react | `DashboardView` | extensions/vscode/src/dashboard-view.ts | VS Code extension dashboard rendering. |

**Used by features:** feature_dashboard_server, feature_vscode_extension

**Tags:** dashboard, monitoring, status, cognitive
