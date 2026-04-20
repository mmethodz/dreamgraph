# Cognitive Output Rendering Plan

> Plan and implementation tracking for VS Code cognitive output rendering, including safe markdown, entity links, semantic cards, verification markers, tool trace, provenance, and Slice 5 action/polish behaviors. Slice 5 has been audited with hover actions, explicit-click action gating, resource limits, instance-scoped restore filtering, context footer, and implicit entity notice/runtime coverage verified by build and tests.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** plans/TDD_COGNITIVE_OUTPUT_V2.md, extensions/vscode/src/chat-panel.ts, extensions/vscode/src/webview/styles.ts, extensions/vscode/src/test/slice5-runtime.test.ts, extensions/vscode/src/test/slice5-audit.test.ts, extensions/vscode/src/test/slice5-next-pass.test.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_vscode_extension | feature | related_to | moderate |  |
| feature_agentic_tool_execution_loop | feature | related_to | moderate |  |

**Tags:** vscode, webview, cognitive-output, slice-5, audited

