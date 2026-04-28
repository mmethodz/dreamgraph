# Explorer Filters Panel

> Controls the visible Explorer subgraph by applying semantic filters, type constraints, and focus rules.

**ID:** `explorer-filters-panel`  
**Category:** data_input  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| available_filters | `array<object>` | ✅ | Filter definitions and possible values supported by the Explorer backend. |
| active_filters | `object` | ❌ | Currently applied filter values. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| filters_changed | `object` | on_change | Emits the updated active filter set after user changes. |
| filters_reset | `boolean` | on_action | Emits when all active filters are cleared. |

## Interactions

- **filter** — Apply semantic constraints to visible graph content.
- **toggle** — Enable or disable filter facets or categories.
- **reset** — Clear all active filters and restore the default view.

## Visual Semantics

- **Role:** card
- **Emphasis:** secondary
- **Density:** compact
- **Chrome:** embedded

## Layout Semantics

- **Pattern:** stack
- **Alignment:** leading
- **Sizing behavior:** content_sized
- **Responsive behavior:** collapse

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `FiltersPanel` | explorer/src/FiltersPanel.tsx | Explorer control panel for graph filtering and scope adjustment. |

**Used by features:** dreamgraph-explorer

**Tags:** explorer, filters, graph-scope
