# Health Banner

> Provide a compact, always-visible summary of DreamGraph health inside the extension, such as daemon connectivity, unresolved tensions, and recent tool failures.

**ID:** `health_banner`  
**Category:** feedback  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| healthState | `object` | ✅ | Current summarized health state from extension monitoring or daemon status |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| healthDetailsRequested | `boolean` | on_click | Signal that the user wants to inspect health details |

## Interactions

- **view_health_details** — Open richer health details or dashboard surfaces
- **retry_connection** — Attempt to reconnect to the daemon when unavailable

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `VS Code Status/Health Surface` | extensions/vscode/src/health-monitor.ts | Can be rendered as banner, badge, or inline panel element. |

**Tags:** vscode, health, status, feedback
