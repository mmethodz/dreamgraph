# DreamGraph Recommended Actions Bar

> Legacy extension-prefixed alias for the canonical recommended actions semantic element. Retained only for backward-compatible lookup during registry migration; canonical identity is ui_recommended_actions_bar.

**ID:** `dreamgraph_recommended_actions_bar`  
**Category:** action  
**Status:** deprecated  
**Superseded by:** ui_recommended_actions_bar  
**Lifecycle note:** Canonicalized under ADR-083/ADR-084 to the generic semantic id ui_recommended_actions_bar.  

> ⚠️ This entry is deprecated. Prefer the canonical replacement if one is listed.

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| suggested_actions | `array<object>` | ✅ | Legacy alias input for suggested actions. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| invoke_suggested_action | `object` | on_click | Legacy alias output for suggested action invocation. |

## Interactions

- **deprecated_alias_lookup** — Transitional alias preserved only so older references can resolve during migration.

## Visual Semantics

- **Role:** card
- **Emphasis:** secondary
- **Density:** compact
- **Chrome:** embedded

## Layout Semantics

- **Pattern:** toolbar
- **Alignment:** leading
- **Sizing behavior:** content_sized
- **Responsive behavior:** wrap

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `Envelope action buttons` | extensions/vscode/src/chat-panel.ts | Rendered from structured envelopes and wired through envelopeAction/envelopeDoAll messaging. |
| vscode | `Webview action row` | extensions/vscode/src/chat-panel.ts | Transitional alias; canonical semantic id is ui_recommended_actions_bar. |

**Used by features:** dreamgraph_extensions_vscode_src, feature_ui_registry

**Tags:** vscode, alias, deprecated, canonicalized
