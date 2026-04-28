# DreamGraph Tool Progress View

> Legacy extension-prefixed alias for the canonical tool progress semantic element. Retained only for backward-compatible lookup during registry migration; canonical identity is ui_tool_progress_view.

**ID:** `dreamgraph_tool_progress_view`  
**Category:** feedback  
**Status:** deprecated  
**Superseded by:** ui_tool_progress_view  
**Lifecycle note:** Canonicalized under ADR-083/ADR-084 to the generic semantic id ui_tool_progress_view.  

> ⚠️ This entry is deprecated. Prefer the canonical replacement if one is listed.

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| tool_events | `array<object>` | ✅ | Tool execution progress events. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| inspect_tool_step | `object` | on_click | Legacy alias output for step inspection. |

## Interactions

- **deprecated_alias_lookup** — Transitional alias preserved only so older references can resolve during migration.

## Visual Semantics

- **Role:** banner
- **Emphasis:** info
- **Density:** compact
- **Chrome:** embedded

### State Styling

- **active** — Animated in-progress indicator.
- **complete** — Replaced by final assistant content.

## Layout Semantics

- **Pattern:** flow
- **Alignment:** leading
- **Sizing behavior:** fluid
- **Responsive behavior:** wrap

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `Embedded chat progress indicator` | extensions/vscode/src/chat-panel.ts | Driven by extension-to-webview message type 'tool-progress'; recently included animation fixes. |
| vscode | `Webview embedded progress region` | extensions/vscode/src/chat-panel.ts | Transitional alias; canonical semantic id is ui_tool_progress_view. |

**Used by features:** dreamgraph_extensions_vscode_src, feature_ui_registry

**Tags:** vscode, alias, deprecated, canonicalized
