---
title: "Cognitive Dashboard Panel"
---

# Cognitive Dashboard Panel

> Present DreamGraph system health, unresolved tensions, recent dream promotions, and graph coverage gaps in a single operational dashboard within VS Code.

**ID:** `dashboard_panel`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| health_summary | `object` | ✅ | Aggregated health status including connectivity, tension counts, and recent activity. |
| tensions | `array<object>` | ❌ | List of unresolved or high-urgency tensions. |
| recent_promotions | `array<object>` | ❌ | Recently validated dream edges or cognitive promotions. |
| coverage_gaps | `array<object>` | ❌ | Missing or stale knowledge areas such as empty registries or weak overview coverage. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| refresh_requested | `void` | on_click | Requests dashboard data refresh. |
| tension_selected | `string` | on_click | Emits selected tension identifier for inspection. |
| promotion_selected | `string` | on_click | Emits selected promotion identifier for drill-down. |

## Interactions

- **refresh** — Reload dashboard data from DreamGraph services.
- **inspect_tension** — Open details for a selected unresolved tension.
- **inspect_promotion** — Open details for a recent dream promotion.
- **filter** — Filter visible issues by severity or subsystem.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `DashboardView` | extensions/vscode/src/dashboard-view.ts | Primary dashboard surface in the VS Code extension. |

**Tags:** vscode, dashboard, cognitive-health, tensions
