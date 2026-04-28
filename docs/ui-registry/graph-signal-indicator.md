# Graph Signal Indicator

> Surface immediate graph awareness for the currently active file by summarizing related tensions, insights, ADRs, and features before the user asks, and provide a lightweight affordance to inspect richer graph context.

**ID:** `graph_signal_indicator`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| active_file_path | `string` | ✅ | Workspace-relative path for the current active editor document. |
| file_graph_signal | `object` | ❌ | Cached or freshly fetched graph signal containing counts, summary text, and related tensions, insights, ADRs, and features for the current file. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| show_graph_signal | `void` | on_click | Opens or focuses the graph signal inspection command for the current file. |
| signal_available | `object` | on_active_file_change | Publishes the resolved graph signal for the active file to subscribers inside the extension. |

## Interactions

- **monitor_graph_context** — See whether the active file has known tensions, insights, ADRs, or related features.
- **open_signal_details** — Click the indicator to inspect richer graph context for the current file.
- **pre_fetch_context** — Automatically fetch and cache graph context when the active editor changes.

## Visual Semantics

- **Role:** banner
- **Emphasis:** info
- **Density:** compact
- **Chrome:** minimal

### State Styling

- **signal_present** — Display compact count badges for tensions, insights, ADRs, and related features.
- **no_signal** — Display a neutral placeholder indicator with explanatory tooltip.

## Layout Semantics

- **Pattern:** toolbar
- **Alignment:** distributed
- **Sizing behavior:** content_sized
- **Responsive behavior:** collapse

### Layout Hierarchy

- **status_indicator** — primary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `StatusBarItem` | extensions/vscode/src/graph-signal.ts | Debounced active-file watcher fetches graph context from the daemon, caches signals for 60 seconds, and shows count badges in the status bar. |

**Used by features:** feature_vscode_extension

**Tags:** vscode, status-bar, graph-context, prefetch, awareness
