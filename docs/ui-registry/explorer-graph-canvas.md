# Explorer Graph Canvas

> Primary interactive visualization surface for exploring DreamGraph entities and relationships as a navigable graph.

**ID:** `explorer-graph-canvas`  
**Category:** data_display  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| graph_snapshot | `object` | ✅ | Projected graph snapshot containing nodes, edges, positions, and display metadata for Explorer rendering. |
| selection | `string` | ❌ | Currently selected node id, if any. |
| filters | `object` | ❌ | Active filter criteria controlling visible nodes, edges, and categories. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| node_selected | `string` | on_click | Emits the selected node id when the user focuses a graph node. |
| viewport_changed | `object` | on_change | Emits pan/zoom viewport changes for coordinated UI state. |
| layout_request | `string` | on_action | Emits requests to recompute or change graph layout strategy. |

## Interactions

- **pan** — Move across the graph canvas to inspect other regions.
- **zoom** — Adjust graph scale for overview or detail inspection.
- **select** — Select a node or edge to inspect related details.
- **hover** — Preview graph entity metadata before committing to selection.
- **focus** — Center the viewport around a chosen entity or neighborhood.

## Visual Semantics

- **Role:** shell
- **Emphasis:** primary
- **Density:** comfortable
- **Chrome:** panel

### State Styling

- **selected** — Highlight chosen node and de-emphasize unrelated context.
- **loading** — Show progressive loading indication while preserving shell layout.

## Layout Semantics

- **Pattern:** shell
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

### Layout Hierarchy

- **graph-viewport** — primary
- **graph-overlays** — secondary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `GraphCanvas` | explorer/src/GraphCanvas.tsx | Sigma/Graphology-powered visualization surface for Explorer graph navigation. |

**Used by features:** dreamgraph-explorer

**Tags:** explorer, graph, visualization, navigation
