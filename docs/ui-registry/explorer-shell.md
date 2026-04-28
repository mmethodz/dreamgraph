# Explorer Shell

> Host the DreamGraph Explorer experience inside the Architect VS Code extension UI as a first-class graph exploration surface.

**ID:** `explorer-shell`  
**Category:** composite  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| graph_context | `object` | ✅ | Current graph data, explorer state, and selection context. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_entity | `string` | on_select | Requests navigation to a selected entity from the explorer UI. |

## Interactions

- **browse_graph** — Browse graph entities and relationships from within the Architect extension UI.
- **inspect_entity** — Inspect selected graph entities and their metadata.
- **observe_live_events** — Observe live graph/cache events relevant to explorer state.

## Visual Semantics

- **Role:** shell
- **Emphasis:** primary
- **Density:** comfortable
- **Chrome:** panel

## Layout Semantics

- **Pattern:** shell
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

### Layout Hierarchy

- **graph_canvas** — primary
- **inspector** — secondary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `DreamGraph Explorer` | extensions/vscode/package.json | Explorer is exposed as part of the Architect VS Code extension UI via dreamgraph.openExplorer. |

**Used by features:** dreamgraph-explorer

