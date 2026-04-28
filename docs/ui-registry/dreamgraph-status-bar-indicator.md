# DreamGraph Status Bar Indicator (Legacy Alias)

> Legacy extension-prefixed alias for the canonical status bar indicator semantic element. Retained only for backward-compatible lookup during registry migration; canonical identity is ui_status_bar_indicator.

**ID:** `dreamgraph_status_bar_indicator`  
**Category:** feedback  
**Status:** deprecated  
**Superseded by:** ui_status_bar_indicator  
**Lifecycle note:** Canonicalized under ADR-083/ADR-084 to the generic semantic id ui_status_bar_indicator.  

> ⚠️ This entry is deprecated. Prefer the canonical replacement if one is listed.

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| connection_state | `object` | ✅ | Legacy alias input for connection/cognitive state. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_status_actions | `void` | on_click | Legacy alias output for status quick actions. |

## Interactions

- **deprecated_alias_lookup** — Transitional alias preserved only so older references can resolve during migration.

## Visual Semantics

- **Role:** banner
- **Emphasis:** info
- **Density:** compact
- **Chrome:** minimal

## Layout Semantics

- **Pattern:** toolbar
- **Alignment:** leading
- **Sizing behavior:** content_sized

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `VS Code status bar items` | extensions/vscode/src/status-bar.ts | Main status item plus secondary restore-sidebar item. |
| vscode | `StatusBarItem` | extensions/vscode/src/status-bar.ts | Transitional alias; canonical semantic id is ui_status_bar_indicator. |

**Used by features:** dreamgraph_extensions_vscode_src, feature_ui_registry

**Tags:** vscode, alias, deprecated, canonicalized
