# Explorer Inspector

> Context panel for viewing structured details, relationships, evidence, and actions for the currently focused Explorer entity.

**ID:** `explorer-inspector`  
**Category:** composite  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| selected_entity | `object` | ✅ | Resolved node/entity record currently in focus. |
| neighborhood | `object` | ❌ | Adjacent relationships and connected entities for the focused node. |
| metrics | `object` | ❌ | Optional per-entity metrics, tensions, or runtime annotations. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| entity_action | `object` | on_click | Emits an action request tied to the selected entity, such as open, inspect, or mutate. |
| follow_relation | `string` | on_click | Emits a related entity id when the user follows a relationship from the inspector. |

## Interactions

- **inspect** — Review properties, provenance, and connected context for the selected entity.
- **expand** — Reveal additional sections such as relationships, evidence, or metrics.
- **follow_link** — Navigate to a related entity from the current inspector context.

## Visual Semantics

- **Role:** inspector
- **Emphasis:** secondary
- **Density:** comfortable
- **Chrome:** panel

### State Styling

- **empty** — Show instructional placeholder content.
- **error** — Show warning/error treatment while preserving layout slot.

## Layout Semantics

- **Pattern:** inspector
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** collapse

### Layout Hierarchy

- **summary** — primary
- **relationships** — secondary
- **actions** — auxiliary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `Inspector` | explorer/src/Inspector.tsx | Side-panel inspector for selected graph entities and their related context. |

**Used by features:** dreamgraph-explorer

**Tags:** explorer, inspector, entity-details
