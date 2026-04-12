---
title: "VS Code Extension Integration"
---

# VS Code Extension Integration

> Integrates DreamGraph into VS Code through chat, dashboard, status, daemon communication, and context-building surfaces that bring architectural cognition into the editor workflow.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/extension.ts, extensions/vscode/src/chat-panel.ts, extensions/vscode/src/status-bar.ts, extensions/vscode/src/dashboard-view.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_ui_registry | feature | related_to | moderate |  |
| feature_dashboard_server | feature | related_to | moderate |  |
| ui_chat_panel | feature | related_to | moderate |  |
| ui_status_bar | feature | related_to | moderate |  |

**Tags:** vscode, extension, editor, ui

