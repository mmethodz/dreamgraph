# DreamGraph Status Bar Indicator

> Provide always-visible DreamGraph connection and cognitive-state feedback in the VS Code status bar and offer quick access to status-oriented commands.

**ID:** `ui_status_bar_indicator`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| connection_state | `object` | ✅ | Resolved daemon connection status, instance identity, and health summary. |
| cognitive_state | `object` | ❌ | Current cognitive/dream status used to summarize readiness or issues. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_status_actions | `void` | on_click | Open the status-related quick actions or restore sidebar flow. |

## Interactions

- **inspect_status** — Read current DreamGraph status directly from the status bar text and tooltip.
- **open_quick_actions** — Click the indicator to open status-related commands or restore the main UI.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `StatusBarItem` | extensions/vscode/src/status-bar.ts | Displays compact connection/cognitive state and routes into quick actions or sidebar restoration flows. |

**Used by features:** feature_vscode_extension, feature_ui_registry

**Tags:** vscode, status-bar, status, feedback, canonicalized
