# DreamGraph Chat Panel

> Provide the primary conversational interface for interacting with DreamGraph inside VS Code, allowing users to ask questions, request analysis, and initiate code-aware workflows with visible contextual grounding.

**ID:** `chat_panel`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| userPrompt | `string` | ✅ | Free-form user request entered in the chat UI |
| contextBundle | `object` | ❌ | Constructed context payload including editor, graph, API, and cognitive context layers |
| disciplineSession | `object` | ❌ | Optional active discipline session state to constrain behavior and surface workflow phase |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| messageSubmitted | `string` | on_submit | Submitted user message for downstream processing |
| toolInvocationRequested | `object` | on_action | Structured tool request emitted when the model chooses to use tools |
| contextInspectionRequested | `boolean` | on_click | Signal to open context inspection details |

## Interactions

- **submit_prompt** — Send a natural-language request to DreamGraph
- **inspect_context** — Open or reveal the context layers injected into the current turn
- **review_tool_activity** — Inspect which tools were called and why
- **view_groundedness** — See confidence or groundedness indicators for the current answer

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `VS Code Webview Chat Panel` | extensions/vscode/src/chat-panel.ts | Primary conversational UI hosted in a VS Code webview. |

**Tags:** vscode, chat, ai-assistant, transparency
