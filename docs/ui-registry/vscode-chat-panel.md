# VS Code Chat Panel

> Provides the primary Architect interaction surface in the VS Code extension, combining conversation, streaming results, tool traces, and task outcome feedback in a semantically structured workspace.

**ID:** `vscode_chat_panel`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| messages | `array<object>` | ✅ | Conversation history and assistant responses |
| active_context | `object` | ❌ | Current file, graph context, and task state |
| tool_activity | `array<object>` | ❌ | Tool execution trace and status events |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| submit_prompt | `object` | on_submit | User-authored architect request payload |
| invoke_action | `string` | on_click | Requested inline action or follow-up command |

## Interactions

- **prompt** — Enter and submit an Architect request
- **inspect_trace** — Review tool calls and progress while work is running
- **review_result** — Read and act on the final grounded response
- **follow_up** — Continue the same task with additional prompts or actions

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `ChatPanelWebview` | extensions/vscode/src/chat-panel.ts | Webview-based Architect workspace inside VS Code |

**Used by features:** dreamgraph_extensions_vscode_src_types, feature_vscode_extension, feature_agentic_tool_execution_loop, feature_cognitive_output_rendering_plan, feature_ui_registry

**Tags:** chat, architect, webview, tool-trace, streaming, visual-meta-v3
