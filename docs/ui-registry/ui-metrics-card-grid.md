# Metrics Card Grid

> Summarize canonical DreamGraph operational and cognitive health as compact dashboard cards within the canonical dashboard feature boundary, using abstract card semantics rather than platform-specific styling tokens.

**ID:** `ui_metrics_card_grid`  
**Category:** data_display  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| metric_cards | `array<object>` | ✅ | List of dashboard metric cards with title, value, subtitle, and optional severity styling. |

### Outputs

*No outputs defined.*

## Interactions

- **scan_metrics** — Visually scan key health and status indicators at a glance.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `Dashboard KPI card grid` | src/server/dashboard.ts | Implemented via shared card/grid shell styles and used by dashboard routes to show health/status snapshots. |

**Used by features:** feature_dashboard_server, dashboard_server, feature_ui_registry

**Tags:** dashboard, metrics, summary, kpi, health, canonical, visual-meta-v2
