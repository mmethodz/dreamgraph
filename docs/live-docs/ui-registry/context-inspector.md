# Context Inspector

> Expose the exact context layers, token-budget tradeoffs, and grounding inputs used to answer a request, so users can understand why DreamGraph responded the way it did.

**ID:** `context_inspector`  
**Category:** data_display  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| contextLayers | `array<object>` | ✅ | Ordered list of context layers considered for injection |
| tokenBudget | `object` | ❌ | Budget allocation and truncation summary for the current request |
| omissions | `array<object>` | ❌ | Context items omitted due to budget or availability constraints |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| layerSelected | `string` | on_click | Identifier of a selected context layer |

## Interactions

- **inspect_layer** — View an included context layer in detail
- **review_omissions** — Understand which context was excluded and why
- **compare_budget** — See how token budget was allocated across layers

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `VS Code Webview Context Inspector` | extensions/vscode/src/context-inspector.ts | Dedicated transparency surface for context composition. |

**Tags:** vscode, context, transparency, rag
