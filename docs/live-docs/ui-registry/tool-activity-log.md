# Tool Activity Log

> Show the sequence of tools DreamGraph invoked for a request, including purpose and outcome, to improve trust and debuggability.

**ID:** `tool_activity_log`  
**Category:** data_display  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| toolCalls | `array<object>` | ✅ | Ordered tool invocation records with arguments, rationale, and results |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| toolCallSelected | `object` | on_click | Selected tool call record for deeper inspection |

## Interactions

- **inspect_tool_call** — Open a specific tool invocation and its result
- **review_failures** — Spot failed or blocked tool calls in the request flow

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `VS Code Webview Tool Activity Panel` | extensions/vscode/src/chat-panel.ts | Can be embedded alongside or below the main chat transcript. |

**Tags:** vscode, tools, auditability, transparency
