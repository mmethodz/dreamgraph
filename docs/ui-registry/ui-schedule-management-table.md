# Schedule Management Table

> Display configured cognitive schedules and let operators inspect, create, run, toggle, or delete scheduled actions from the canonical dashboard management surface, with abstract table-and-toolbar semantics that remain platform independent.

**ID:** `ui_schedule_management_table`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| schedules | `array<object>` | ✅ | Configured schedules with timing, action, status, run counts, and identifiers. |
| history | `array<object>` | ❌ | Recent schedule execution history when available. |
| scheduler_config | `object` | ❌ | Current scheduler configuration needed to contextualize schedule behavior. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| run_schedule | `string` | on_click | Identifier of the schedule to execute immediately. |
| toggle_schedule | `object` | on_click | Enable/disable transition request for a schedule. |
| delete_schedule | `string` | on_click | Identifier of the schedule to delete. |
| create_schedule | `object` | on_submit | New schedule definition submitted from dashboard form controls. |

## Interactions

- **inspect_schedules** — Read schedule timing, action type, status, and execution counts.
- **run_now** — Execute a schedule immediately for testing or one-off operation.
- **toggle_enabled** — Pause or resume a schedule.
- **delete_schedule** — Remove a schedule from the system.
- **create_schedule** — Submit a new schedule through the dashboard form surface.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `Dashboard schedules table + management forms` | src/server/dashboard.ts | Served from GET/POST /schedules handlers with real-time history and action forms. |

**Used by features:** feature_dashboard_server, feature_cognitive_scheduler, feature_ui_registry

**Tags:** dashboard, schedules, operations, cognitive, forms, visual-meta-v2
