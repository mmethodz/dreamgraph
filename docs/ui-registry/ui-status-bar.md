# DreamGraph Status Bar

> Provide always-visible connection and cognitive-state feedback in the VS Code chrome, and act as the primary quick-entry point into common extension actions such as connect, reconnect, switch instance, status, dashboard, and context inspection.

**ID:** `ui_status_bar`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| connection_status | `string` | ✅ | Current daemon/extension connection state: connected, degraded, connecting, or disconnected. |
| instance_name | `string` | ❌ | Resolved DreamGraph instance name shown in the status label when available. |
| cognitive_state | `string` | ❌ | Current cognitive engine state appended to the label when known. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_action_picker | `void` | on_click | Invokes the DreamGraph status quick-pick action menu. |

## Interactions

- **scan_status** — Read the current connection and cognitive state from the status bar text and color treatment.
- **open_action_picker** — Click the status bar item to launch the DreamGraph quick-pick command surface.

## Visual Semantics

- **Role:** banner
- **Emphasis:** info
- **Density:** compact
- **Chrome:** minimal

### State Styling

- **connected** — Use calm positive emphasis that remains lightweight in editor chrome.
- **degraded** — Escalate toward warning emphasis without becoming visually dominant.
- **disconnected** — Surface actionable warning or danger emphasis to encourage reconnection.
- **connecting** — Use transitional informative emphasis with motion or spinner semantics.

## Layout Semantics

- **Pattern:** toolbar
- **Alignment:** leading
- **Sizing behavior:** content_sized
- **Responsive behavior:** collapse

### Layout Hierarchy

- **status_label** — primary
- **action_entry** — secondary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `VS Code StatusBarItem` | extensions/vscode/src/status-bar.ts | Uses icon/state variants for connected, degraded, connecting, and disconnected states. |
| vscode | `StatusBarItem` | extensions/vscode/src/status-bar.ts | Uses icon + text + themed background colors to represent connected, degraded, connecting, and disconnected states. Click routes to dreamgraph.statusQuickPick. |

**Used by features:** feature_vscode_extension, feature_dashboard_server, feature_ui_registry

**Tags:** vscode, status-bar, connection, health, cognitive-state, visual-meta-v3
