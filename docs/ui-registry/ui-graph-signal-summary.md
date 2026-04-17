# Graph Signal Summary

> Surface proactive graph-grounded context for the current file by summarizing related features, tensions, insights, and ADRs, then offering a path into the chat workflow for deeper analysis through a lightweight, interruptive feedback surface.

**ID:** `ui_graph_signal_summary`  
**Category:** feedback  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| graph_signal | `object` | ✅ | Aggregated file-scoped graph context including summary text, related features, tensions, insights, and ADRs. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| open_chat | `void` | on_click | User chooses to open the chat panel from the graph signal prompt. |
| dismiss | `void` | on_click | User dismisses the graph signal summary without further action. |

## Interactions

- **review_graph_context** — Read the summary and supporting related entities for the current file.
- **open_chat** — Jump directly into the chat panel for deeper graph-guided assistance.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `InformationMessage + backing provider` | extensions/vscode/src/commands.ts | Uses GraphSignalProvider state to construct a concise graph context message and optional follow-up action. |

**Used by features:** feature_vscode_extension, feature_ui_registry

**Tags:** vscode, graph-context, feedback, adr, tension, visual-meta-v3
