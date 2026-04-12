---
title: "Status Bar Indicator"
---

# Status Bar Indicator

> Expose lightweight real-time DreamGraph health and activity state in a persistent navigation-adjacent UI element.

**ID:** `ui_status_bar`  
**Category:** feedback  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| health_state | `string` | ✅ | Current daemon or cognitive health state. |
| summary_text | `string` | ✅ | Compact human-readable status message. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_dashboard | `void` | on_click | User clicks the indicator to open a richer dashboard or detail view. |

## Interactions

- **view_status** — Read the current system health at a glance.
- **open_dashboard** — Jump to a richer monitoring surface.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `StatusBar` | extensions/vscode/src/status-bar.ts | VS Code status bar integration. |

**Used by features:** feature_vscode_extension, feature_dashboard_server

**Tags:** status, health, feedback, extension
