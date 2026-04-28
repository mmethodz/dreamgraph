# Changed Files View

> Show a session-scoped list of files changed during the current VS Code session so users can review and jump to tool-driven edits or filesystem changes without leaving the extension workflow.

**ID:** `changed_files_view`  
**Category:** data_display  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| changed_file_entries | `array<object>` | ✅ | Session-scoped changed file entries including change type, file path, optional previous path, and timestamp. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_file | `uri` | on_click | Opens the selected changed file in the editor. |
| clear_entries | `void` | on_command | Clears the session change list. |
| copy_path | `string` | on_command | Copies the selected file path to the clipboard. |
| reveal_in_os | `uri` | on_command | Reveals the selected file in the operating system file explorer. |

## Interactions

- **browse_recent_changes** — Review recently changed files in reverse chronological order.
- **open_changed_file** — Open a changed file directly from the tree item.
- **clear_change_history** — Clear the session-scoped change list.
- **copy_file_path** — Copy the full path of a changed file.
- **reveal_file** — Reveal the changed file in the operating system explorer.

## Visual Semantics

- **Role:** inspector
- **Emphasis:** secondary
- **Density:** compact
- **Chrome:** panel

### State Styling

- **recent_change** — Show change-type icon and human-readable timestamp in each row.
- **empty** — Render as an empty tree with no child entries until changes are recorded.

## Layout Semantics

- **Pattern:** inspector
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

### Layout Hierarchy

- **change_list** — primary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `TreeView` | extensions/vscode/src/changed-files-view.ts | Backed by a FileSystemWatcher plus optional programmatic recording API; persists entries in workspaceState and restores them on activation. |

**Used by features:** feature_vscode_extension

**Tags:** vscode, tree-view, session-state, file-monitoring, changed-files
