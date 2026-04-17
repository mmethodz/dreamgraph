# Command Action Picker

> Offer a quick-pick action surface for common DreamGraph extension commands, especially from the status bar, so users can rapidly connect, reconnect, switch instances, inspect status, open the dashboard, or inspect context through a compact command palette idiom.

**ID:** `ui_command_action_picker`  
**Category:** action  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| available_actions | `array<object>` | ✅ | Quick-pick items representing DreamGraph actions and their descriptions. |
| current_instance | `object` | ❌ | Current resolved instance context used to personalize available actions when needed. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| selected_action | `string` | on_select | The command/action chosen by the user from the quick pick. |

## Interactions

- **choose_command** — Pick a DreamGraph action from the quick-pick list.
- **dismiss** — Close the picker without triggering an action.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `QuickPick` | extensions/vscode/src/commands.ts | Used by the status quick-pick command to route into Connect Instance, Reconnect, Switch Instance, Show Status, Open Dashboard, and Inspect Context. |

**Used by features:** feature_vscode_extension, feature_ui_registry

**Tags:** vscode, quickpick, commands, status-bar, visual-meta-v3
