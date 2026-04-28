# Tool Progress View

> Expose live and historical tool execution progress inside the DreamGraph chat surface so users can see in-flight steps, completion state, and animated progress feedback without leaving the conversation context.

**ID:** `ui_tool_progress_view`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tool_events | `array<object>` | ✅ | Ordered tool execution events with step, state, and summary metadata. |
| active_request_id | `string` | ❌ | Correlation id for the currently running architect request. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| inspect_tool_step | `object` | on_click | Selected tool progress item for deeper inspection or navigation. |

## Interactions

- **observe_progress** — Watch tools advance through execution states and summaries.
- **inspect_step** — Open or focus details for a specific tool step from the progress surface.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `Webview embedded progress region` | extensions/vscode/src/chat-panel.ts | Animated progress UI rendered within the chat panel; supports both live execution and restored historical progress state. |

**Used by features:** feature_vscode_extension, feature_agentic_tool_execution_loop, feature_cognitive_output_rendering_plan, feature_ui_registry

**Tags:** vscode, tool-progress, feedback, async, canonicalized
