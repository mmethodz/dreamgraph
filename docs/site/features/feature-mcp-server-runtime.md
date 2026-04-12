---
title: "MCP Server Runtime"
---

# MCP Server Runtime

> Bootstraps and runs the DreamGraph daemon as an MCP server over stdio or HTTP transport, wiring resources, tools, cognitive subsystems, and optional dashboard surfaces into a single runtime.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** src/index.ts, src/server/server.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_tool_registry | feature | related_to | moderate |  |
| feature_resource_registry | feature | related_to | moderate |  |
| feature_cognitive_engine | feature | related_to | moderate |  |
| feature_discipline_session_framework | feature | related_to | moderate |  |
| feature_http_api_routes | feature | related_to | moderate |  |
| feature_dashboard_server | feature | related_to | moderate |  |

**Tags:** runtime, mcp, transport, entrypoint

