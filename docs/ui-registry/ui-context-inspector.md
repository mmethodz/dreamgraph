# Context Inspector

> Expose transparent diagnostic views of the active editor context envelope and resolved instance status so users can inspect what DreamGraph sees and why it is reasoning a certain way.

**ID:** `ui_context_inspector`  
**Category:** feedback  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| editor_context_envelope | `object` | ❌ | Current editor context snapshot including active file, visible files, changed files, intent, and graph context. |
| instance_status | `object` | ❌ | Resolved instance and health-monitor state used to render detailed status output. |
| raw_output | `string` | ❌ | Text output to append when command results need to be shown outside the chat panel. |

### Outputs

*No outputs defined.*

## Interactions

- **inspect_context** — Open the DreamGraph Context output channel and review the current context envelope details.
- **inspect_instance_status** — Open the DreamGraph Instance Status output channel and review resolved instance, daemon, latency, and LLM state.
- **review_raw_output** — Read non-chat command output emitted to the output channel for transparency and debugging.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `VS Code OutputChannel surfaces` | extensions/vscode/src/context-inspector.ts | Uses dedicated output channels for context and instance status. |
| vscode | `OutputChannel pair` | extensions/vscode/src/context-inspector.ts | Maintains separate channels for DreamGraph Context and DreamGraph: Instance Status. Formats envelope and instance health information for inspection. |

**Used by features:** feature_vscode_extension, feature_ui_registry

**Tags:** vscode, debugging, transparency, context, status, visual-meta-v3
