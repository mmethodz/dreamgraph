# Symbol-Bounded Code Excerpt

> Focused code excerpts in the context envelope are bounded by the language server's symbol range (vscode.DocumentSymbol.range) when available, rather than a fixed ±20-line cursor window. Stored as symbolRange on SemanticAnchor. Falls back to cursor-radius window for heuristic anchors.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/context-builder.ts, extensions/vscode/src/types.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| semantic-anchor-promotion | feature | related_to | moderate |  |
| context-builder-rebuild | feature | related_to | moderate |  |

**Tags:** anchor, context-builder, precision, symbol-provider

