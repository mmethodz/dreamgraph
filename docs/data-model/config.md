# Configuration

> Holds configuration settings for the DreamGraph server, including transport modes and port settings. This data is essential for initializing the server with the correct parameters.

**Table:** `config`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| transport | string | The transport mode for the server, either 'stdio' or 'http'. |
| port | number | The port number for the HTTP transport mode. |

