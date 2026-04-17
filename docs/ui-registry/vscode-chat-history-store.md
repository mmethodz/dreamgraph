# VS Code Chat History Store

> Persist and restore per-instance chat conversation history for the VS Code chat panel so transcript state survives webview disposal, tab switches, and instance changes without leaking across DreamGraph instances.

**ID:** `vscode_chat_history_store`  
**Category:** feedback  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| instance_id | `string` | ✅ | DreamGraph instance identifier used to partition persisted transcript storage keys. |
| messages | `array<object>` | ✅ | Ordered assistant/user/system messages for the active instance. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| restored_messages | `array<object>` | on_restore | Previously persisted messages rehydrated for the active instance. |
| cleared | `boolean` | on_clear | Signals that persisted history was deleted for the active instance. |

## Interactions

- **persist_transcript** — Save current chat transcript to VS Code globalState under an instance-specific key.
- **restore_transcript** — Load stored transcript when the chat panel is created or revealed.
- **clear_transcript** — Delete persisted transcript for the current instance.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `ExtensionContext.globalState store` | extensions/vscode/src/chat-memory.ts | Storage keys are namespaced by dreamgraph.chat.<instanceId>; defaults to 'default' only when instance id is empty. |

**Used by features:** dreamgraph_extensions_vscode, feature_vscode_extension, feature_cognitive_output_rendering_plan, feature_ui_registry

**Tags:** vscode, chat, persistence, instance-scoped, state, visual-meta-v3
