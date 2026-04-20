# Dashboard Surfaces

> Canonical feature for server-hosted and VS Code-embedded DreamGraph dashboard monitoring surfaces. Preferred authoritative owner for dashboard UI semantics under ADR-010. Legacy aliases dashboard, dashboard_server, and server_dashboard remain transitional and should not be used for new ownership links.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** src/server/dashboard.ts, extensions/vscode/src/dashboard-view.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_ui_registry | feature | related_to | moderate |  |
| feature_vscode_extension | feature | related_to | moderate |  |
| feature_cognitive_scheduler | feature | related_to | moderate |  |
| feature_mcp_server_runtime | feature | related_to | moderate |  |
| feature_http_api_routes | feature | related_to | moderate |  |

**Tags:** dashboard, monitoring, ui, canonical

