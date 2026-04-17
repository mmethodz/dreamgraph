# Changed Files View

> Provide a session-scoped tree view of files created, edited, deleted, or renamed during the current VS Code session so users can quickly review tool-touched files and reopen them, using abstract navigational tree semantics rather than implementation-specific widget details.

**ID:** `ui_changed_files_view`  
**Category:** data_display  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| changed_file_entries | `array<object>` | ✅ | Session-scoped entries including file path, change type, optional previous path, and timestamp. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_file | `string` | on_click | Open the selected changed file in the editor. |
| copy_path | `string` | on_action | Copy the selected changed file path to the clipboard. |
| reveal_in_explorer | `string` | on_action | Reveal the selected changed file in the OS file explorer. |
| clear_entries | `void` | on_click | Clear the current session's changed-file entries. |

## Interactions

- **review_recent_changes** — Browse a reverse-chronological list of file changes with icons and timestamps.
- **open_changed_file** — Open a file directly from the tree view.
- **copy_file_path** — Copy the selected file path for reuse elsewhere.
- **reveal_file** — Reveal the selected file in the operating system explorer.
- **clear_change_list** — Reset the session-scoped changed file list.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `TreeView` | extensions/vscode/src/changed-files-view.ts | Backed by a FileSystemWatcher and workspaceState persistence. Filters out noise such as node_modules, .git, dist, and out. |

**Used by features:** feature_vscode_extension, feature_ui_registry

**Tags:** vscode, tree-view, changed-files, session-state, visual-meta-v3
