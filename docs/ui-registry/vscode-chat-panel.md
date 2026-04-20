# VS Code Chat Panel

> Provides the primary Architect interaction surface in the VS Code extension, combining conversation, streaming results, tool traces, and task outcome feedback in a semantically structured workspace.

**ID:** `vscode_chat_panel`  
**Category:** composite  
**Status:** active  

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

## Visual Semantics

- **Role:** inspector
- **Emphasis:** primary
- **Density:** comfortable
- **Chrome:** panel

### State Styling

- **idle** — Maintain a calm reading-and-authoring workspace with clear hierarchy between history and composer.
- **streaming** — Promote live progress, tool trace, and in-flight output without destabilizing layout.
- **action_required** — Elevate follow-up actions and verification prompts with stronger emphasis.
- **error_or_partial** — Preserve transcript continuity while surfacing warnings and failures with bounded prominence.

## Layout Semantics

- **Pattern:** inspector
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll, collapse

### Layout Hierarchy

- **conversation_stream** — primary
- **composer** — primary
- **tool_trace_and_supporting_panels** — secondary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `ChatPanelWebview` | extensions/vscode/src/chat-panel.ts | Webview-based Architect workspace inside VS Code |

**Used by features:** dreamgraph_extensions_vscode_src_types, feature_vscode_extension, feature_agentic_tool_execution_loop, feature_cognitive_output_rendering_plan, feature_ui_registry

**Tags:** chat, architect, webview, tool-trace, streaming, visual-meta-v3
