# Context Inspector Output

> Expose the constructed DreamGraph context envelope, reasoning packet instrumentation, and instance-status diagnostics in output channels so developers can inspect what context was assembled and why.

**ID:** `context_inspector_output`  
**Category:** data_display  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| context_envelope | `object` | ❌ | Resolved EditorContextEnvelope including active file, visible files, changed files, environment context, and graph context. |
| reasoning_packet | `object` | ❌ | Structured reasoning packet with anchors, evidence selection, omitted evidence, and token usage instrumentation. |
| status_event | `object` | ❌ | Instance and timeout diagnostic events emitted by the extension. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| append_context_log | `void` | on_context_built | Writes context-boundary and envelope details to the DreamGraph Context output channel. |
| append_reasoning_packet_log | `void` | on_reasoning_packet | Writes evidence and token-budget instrumentation to the DreamGraph Context output channel. |
| append_status_log | `void` | on_status_event | Writes instance status and timeout diagnostics to output channels. |

## Interactions

- **inspect_context_envelope** — Read the assembled context envelope for the current request.
- **inspect_reasoning_packet** — Review included and omitted evidence plus token-budget instrumentation.
- **inspect_status_diagnostics** — Review instance status and timeout diagnostics in output channels.

## Visual Semantics

- **Role:** inspector
- **Emphasis:** secondary
- **Density:** compact
- **Chrome:** embedded

### State Styling

- **context_loaded** — Append structured sections with timestamps and semantic labels.
- **partial_context** — Show explicit missing-context markers while preserving the remaining diagnostic output.

## Layout Semantics

- **Pattern:** inspector
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll

### Layout Hierarchy

- **context_channel** — primary
- **status_channel** — secondary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `OutputChannel` | extensions/vscode/src/context-inspector.ts | Maintains DreamGraph Context and DreamGraph: Instance Status output channels for transparency and debugging of context assembly and runtime status. |

**Used by features:** feature_vscode_extension

**Tags:** vscode, output-channel, debugging, context, instrumentation, status
