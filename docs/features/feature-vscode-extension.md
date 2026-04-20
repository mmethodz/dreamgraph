# VS Code Extension Integration

> Canonical feature for DreamGraph editor integration in VS Code. Preferred authoritative owner for extension UI semantics under ADR-010. Legacy aliases vscode_extension and extensions_vscode remain transitional and should not be used for new ownership links.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/extension.ts, extensions/vscode/src/chat-panel.ts, extensions/vscode/src/status-bar.ts, extensions/vscode/src/context-inspector.ts, extensions/vscode/src/changed-files-view.ts, extensions/vscode/src/commands.ts, extensions/vscode/src/dashboard-view.ts, extensions/vscode/src/task-reporter.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_ui_registry | feature | related_to | moderate |  |
| feature_dashboard_server | feature | related_to | moderate |  |
| feature_agentic_tool_execution_loop | feature | related_to | moderate |  |
| feature_architect_tool_call_translation | feature | related_to | moderate |  |
| feature_cognitive_output_rendering_plan | feature | related_to | moderate |  |

**Tags:** vscode, extension, ui, canonical

