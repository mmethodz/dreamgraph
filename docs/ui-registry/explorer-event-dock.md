# Explorer Event Dock

> Live event surface showing recent graph, cognitive, and explorer activity streamed into the Explorer experience.

**ID:** `explorer-event-dock`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| event_stream | `array<object>` | ✅ | Recent Explorer events from SSE or replay history. |
| connection_state | `string` | ✅ | Current live connection state for the event stream. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| event_selected | `object` | on_click | Emits the chosen event when the user opens event details or navigates from it. |

## Interactions

- **observe** — Watch recent live events affecting the graph or Explorer state.
- **scroll** — Review older events retained in the dock.
- **select** — Open or follow an event to the affected entity or context.

## Visual Semantics

- **Role:** banner
- **Emphasis:** info
- **Density:** compact
- **Chrome:** embedded

### State Styling

- **connected** — Show healthy live-state indicator.
- **disconnected** — Show warning live-state indicator and stale data messaging.

## Layout Semantics

- **Pattern:** stack
- **Alignment:** leading
- **Sizing behavior:** content_sized
- **Responsive behavior:** scroll, collapse

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `EventDock` | explorer/src/EventDock.tsx | Live event panel backed by Explorer SSE updates. |

**Used by features:** dreamgraph-explorer

**Tags:** explorer, events, sse, activity
