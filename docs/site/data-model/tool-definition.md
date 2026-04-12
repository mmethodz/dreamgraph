---
title: "Tool Definition"
---

# Tool Definition

> Defines the schema for tools that can be invoked by the LLM. This includes the name, description, and input schema for each tool, allowing for dynamic tool selection during LLM interactions.

**Table:** `tool_definition`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Name of the tool. |
| inputSchema | object | Schema defining the input parameters for the tool. |

