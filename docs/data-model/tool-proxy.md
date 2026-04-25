# Tool Proxy

> Acts as an intermediary for tool requests and responses, managing the communication between the DreamGraph application and external tools.

**Table:** `tool_proxy`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| toolName | string | The name of the tool being proxied. |
| requestSchema | object | The schema for the requests sent to the tool. |

