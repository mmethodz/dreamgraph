# Recommended Actions Bar

> Present structured suggested actions for a rendered DreamGraph response so users can trigger follow-up commands directly from the current or restored message context.

**ID:** `ui_recommended_actions_bar`  
**Category:** action  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| suggested_actions | `array<object>` | ✅ | Ordered suggested actions with labels, ids, and invocation payloads derived from assistant output. |
| message_id | `string` | ✅ | Owning message identifier used to scope action execution and history rehydration. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| invoke_suggested_action | `object` | on_click | Selected suggested action payload ready for execution. |

## Interactions

- **choose_suggested_action** — Click a suggested action to run the associated follow-up behavior.
- **review_available_actions** — Inspect the available next steps presented for the current message.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `Webview action row` | extensions/vscode/src/chat-panel.ts | Rendered within message summaries/envelopes and remains clickable after historical transcript restoration. |

**Used by features:** feature_vscode_extension, feature_cognitive_output_rendering_plan, feature_ui_registry

**Tags:** vscode, actions, suggested-actions, message-ui, canonicalized
