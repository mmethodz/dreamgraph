# Agentic Tool Execution Loop

> Orchestrates iterative tool-enabled conversations in the VS Code extension chat panel. It collects MCP and local tools, sends tool schemas to the LLM API through callWithTools, detects structured tool_use responses, dispatches executeLocalTool or mcpClient.callTool, appends provider-neutral tool_result messages, and continues until a final answer is produced. Root-cause analysis documents that a prior placeholder used stream() only and severed the execution pipeline, causing narrated but non-executed tool calls.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/chat-panel.ts, extensions/vscode/src/architect-llm.ts, extensions/vscode/src/local-tools.ts, extensions/vscode/src/mcp-client.ts, plans/RCA_AGENTIC_LOOP.md  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_vscode_extension | feature | related_to | moderate |  |
| feature_architect_tool_call_translation | feature | related_to | moderate |  |
| feature_mcp_server_runtime | feature | related_to | moderate |  |
| feature_discipline_session_framework | feature | related_to | moderate |  |

**Tags:** vscode, agentic, tool-execution, orchestration, llm, mcp, rca

