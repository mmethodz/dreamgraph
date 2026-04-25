# Graph Context Canonical Anchor Persistence

> Persists promoted canonical anchor identity into saved chat message anchors for later turns in the VS Code extension. When buildEnvelope resolves a canonicalId during Phase 3, chat persistence refreshes the most recent same-instance user anchor before writing ChatMemory so restored conversations start from canonical feature identity instead of raw symbol-only anchors.

**Repository:**   
**Domain:** context-assembly  
**Status:** active  
**Source files:** extensions/vscode/src/chat-panel.ts, extensions/vscode/src/chat-memory.ts, extensions/vscode/src/context-builder.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| semantic-anchor-promotion | feature | related_to | moderate |  |
| graph-relevance-propagation | feature | related_to | moderate |  |
| feature_vscode_extension | feature | related_to | moderate |  |

**Tags:** vscode, chat-memory, anchor-persistence, canonical-id, future-turns

