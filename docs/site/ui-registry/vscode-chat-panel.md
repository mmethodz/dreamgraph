---
title: "VS Code Chat Panel"
---

# VS Code Chat Panel

> Provide a persistent conversational interface inside the VS Code extension where users can ask questions, receive streamed responses, and resume the conversation after webview recreation or tab/view switching.

**ID:** `vscode_chat_panel`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| instance_id | `string` | ✅ | Selected DreamGraph instance whose chat history and backend context are active. |
| messages | `array<object>` | ✅ | Ordered chat transcript owned by the extension host and rendered in the webview. |
| connection_state | `string` | ❌ | Backend/daemon availability state used to render degraded UX. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| user_message | `string` | on_submit | Submitted prompt from the user to the extension host/backend. |
| panel_ready | `object` | on_load | Signal that the webview is ready to receive hydrated state from the extension host. |
| clear_chat | `void` | on_click | User intent to clear persisted conversation history. |

## Interactions

- **submit_message** — Send a user message to the extension host for processing.
- **resume_history** — Rehydrate prior messages when the panel is restored or revealed again.
- **clear_history** — Remove the persisted transcript for the active instance.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `WebviewPanel` | extensions/vscode/src/chat-panel.ts | Authoritative transcript state lives in the extension host and is rehydrated into the webview. |

**Used by features:** dreamgraph_extensions_vscode_src_types

**Tags:** vscode, chat, persistence, webview
