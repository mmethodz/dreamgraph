# Explorer Search Bar

> Global Explorer query input for locating entities, narrowing graph context, and jumping directly to relevant nodes.

**ID:** `explorer-search-bar`  
**Category:** data_input  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query_text | `string` | ❌ | Current search string entered by the user. |
| search_scope | `object` | ❌ | Optional filters controlling which entity types or sources are searched. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| query_changed | `string` | on_change | Emits updated query text as the user types. |
| result_selected | `string` | on_submit | Emits selected entity id when the user chooses a search result. |

## Interactions

- **type** — Enter a search string to find entities.
- **submit** — Run the current search query.
- **select_result** — Choose a suggested result to focus it in Explorer.
- **clear** — Reset the current query and search results.

## Visual Semantics

- **Role:** card
- **Emphasis:** primary
- **Density:** compact
- **Chrome:** embedded

## Layout Semantics

- **Pattern:** toolbar
- **Alignment:** leading
- **Sizing behavior:** fluid
- **Responsive behavior:** wrap

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `SearchBar` | explorer/src/SearchBar.tsx | Explorer search input with result-driven navigation to graph entities. |

**Used by features:** dreamgraph-explorer

**Tags:** explorer, search, navigation
