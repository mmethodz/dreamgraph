# DreamGraph Chat Panel

> Legacy extension-prefixed alias for the canonical chat panel semantic element. Retained only for backward-compatible lookup during registry migration; canonical identity is ui_chat_panel.

**ID:** `dreamgraph_chat_panel`  
**Category:** composite  
**Status:** deprecated  
**Superseded by:** ui_chat_panel  
**Lifecycle note:** Canonicalized under ADR-083/ADR-084 to the generic semantic id ui_chat_panel.  

> ⚠️ This entry is deprecated. Prefer the canonical replacement if one is listed.

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| messages | `array<object>` | ✅ | Ordered chat transcript including user, assistant, and system messages with render metadata. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| invoke_message_action | `object` | on_click | Legacy alias output for message action execution. |

## Interactions

- **deprecated_alias_lookup** — Transitional alias preserved only so older references can resolve during migration.

## Visual Semantics

- **Role:** shell
- **Emphasis:** primary
- **Density:** comfortable
- **Chrome:** panel

### State Styling

- **streaming** — Active assistant bubble with incremental content and progress indicators.
- **error** — Inline failure messaging with degraded emphasis.

## Layout Semantics

- **Pattern:** stack
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

### Layout Hierarchy

- **message_list** — primary
- **composer** — secondary
- **status_and_actions** — auxiliary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `VS Code Webview chat panel` | extensions/vscode/src/chat-panel.ts | WebviewView provider with embedded scripts for markdown, envelope rendering, entity links, and streaming updates. |
| vscode | `WebviewViewProvider` | extensions/vscode/src/chat-panel.ts | Transitional alias; canonical semantic id is ui_chat_panel. |

**Used by features:** dreamgraph_extensions_vscode_src, feature_ui_registry

**Tags:** vscode, alias, deprecated, canonicalized
