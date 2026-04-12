---
title: "Tension List"
---

# Tension List

> Display unresolved tensions with urgency and evidence summaries so users can prioritize investigation or remediation.

**ID:** `tension_list`  
**Category:** data_display  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tensions | `array<object>` | ✅ | Tension items including title, urgency, status, and supporting evidence. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| tension_selected | `string` | on_click | Emits selected tension identifier. |
| filter_changed | `object` | on_change | Emits updated filtering criteria. |

## Interactions

- **sort** — Sort tensions by urgency, age, or subsystem.
- **filter** — Filter tensions by status, severity, or evidence type.
- **select** — Open a specific tension for deeper inspection.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `TensionList` | - | Semantic registration for dashboard and future dedicated views. |

**Used by features:** dashboard_view

**Tags:** tensions, triage, vscode
