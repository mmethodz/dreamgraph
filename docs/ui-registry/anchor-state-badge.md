# Anchor State Badge

> Communicates the lifecycle migration state of a semantic anchor to the operator in the chat context footer. Makes the quality and confidence of the active work context legible at a glance — without requiring the operator to open the graph or inspect internal metadata. The badge is the visual surface of the anchor promotion/migration pipeline.

**ID:** `anchor_state_badge`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| migrationStatus | `string` | ✅ | Lifecycle state of the semantic anchor. One of: promoted | rebound | drifted | archived | native | canonical. Drives CSS class selection and display text. |
| canonicalId | `string` | ❌ | Graph entity ID the anchor was promoted or rebound to, e.g. 'semantic-anchor-promotion'. Used as the badge label suffix. |
| canonicalKind | `string` | ❌ | Kind of the canonical graph entity: feature | workflow | adr | ui | data_model. Prefixes the label as 'kind:id'. |
| symbolPath | `string` | ❌ | Fallback label when canonicalId is absent, e.g. 'ContextBuilder._promoteAnchor'. Used for native/drifted states without a graph match. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| none | `void` | n/a | Display-only element. Emits no events and triggers no actions. |

## Interactions

- **hover** — Tooltip reads 'Semantic anchor migration state'. No click action.

## Visual Semantics

- **Role:** badge
- **Density:** compact
- **Chrome:** minimal

### State Styling

- **promoted** — Teal/success tint — color #4ec9b0, semi-transparent background and border via color-mix. Graph identity confirmed.
- **rebound** — Blue/info tint — color #3794ff, semi-transparent background and border via color-mix. Symbol moved but still trackable.
- **drifted** — Amber/warning tint — color #d18616, semi-transparent background and border via color-mix. Approximate match only, confidence degraded.
- **archived** — Muted descriptionForeground with line-through decoration, 0.75 opacity. No graph match found, anchor identity lost.
- **native** — Subtle descriptionForeground, transparent background, faint border, 0.85 opacity. Normal in-session anchor, not yet graph-promoted.
- **canonical** — Identical to native. Anchor already has a canonicalId from live derivation — no migration occurred.

## Layout Semantics

- **Pattern:** flow
- **Alignment:** leading
- **Sizing behavior:** content_sized
- **Responsive behavior:** wrap

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `span.anchor-state-badge.anchor-state-{status}` | extensions/vscode/src/chat-panel.ts | Rendered inside renderContextFooter() in the webview JS template literal (line ~2100). Sentinel-based: host encodes [anchor-status:STATE:LABEL] at end of contextFooter string; webview parses with sentinelRe regex and builds the badge DOM node. Parent container is .message-context-footer (display:flex). |

**Used by features:** feature_chat_panel, symbol-bounded-excerpt, semantic-anchor-promotion

**Tags:** anchor, semantic-anchor, context-footer, migration, chat-panel, webview
