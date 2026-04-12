# Chat Panel

> Provide an interactive conversational surface where a user collaborates with DreamGraph, sends prompts, and receives architecture-aware responses.

**ID:** `ui_chat_panel`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| messages | `array<object>` | ✅ | Conversation history for the active chat session. |
| context_payload | `object` | ❌ | Injected DreamGraph context, graph preamble, or retrieved subgraph data. |
| connection_status | `string` | ✅ | Daemon/MCP connection health indicator. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| message_submitted | `string` | on_submit | User submits a prompt to the assistant. |
| context_requested | `object` | on_click | UI requests additional graph context or entity details. |

## Interactions

- **send_message** — Submit a new user message.
- **view_context** — Inspect architectural context associated with a reply.
- **retry** — Retry failed daemon or model calls.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `ChatPanel` | extensions/vscode/src/chat-panel.ts | VS Code webview chat interface. |

**Used by features:** feature_vscode_extension, feature_graph_rag_retrieval

**Tags:** chat, assistant, conversation, context
