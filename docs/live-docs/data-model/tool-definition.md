# Tool Definition

> Describes a tool that can be used within the DreamGraph system, including its input schema and description. Tool definitions are essential for integrating external capabilities.

**Table:** `tool_definition`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| name | string | Name of the tool. |
| description | string | Detailed description of the tool's functionality. |
| inputSchema | object | Schema defining the expected input for the tool. |

