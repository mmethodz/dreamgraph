---
title: "VS Code Chat History Store"
---

# VS Code Chat History Store

> Persist and restore per-instance chat conversation history for the VS Code chat panel so UI state survives webview disposal, tab switches, and instance changes.

**ID:** `vscode_chat_history_store`  
**Category:** feedback  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| instanceId | `string` | ✅ | DreamGraph instance identifier used to partition chat history. |
| messages | `array<object>` | ✅ | Ordered chat message history to persist. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| restoredMessages | `array<object>` | on_restore | Previously persisted messages rehydrated into the chat panel. |
| cleared | `boolean` | on_clear | Signals that persisted history was removed for the current instance. |

## Interactions

- **persist** — Save current chat transcript to extension-host storage.
- **restore** — Load stored transcript when the chat view is created or shown.
- **clear** — Delete persisted transcript for the active instance.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `ChatMemory` | extensions/vscode/src/chat-memory.ts | Uses ExtensionContext.globalState with per-instance storage keys. |

**Used by features:** dreamgraph_extensions_vscode

**Tags:** vscode, chat, persistence, state
