# Configuration

> Holds configuration settings for the DreamGraph server, including transport modes and default ports. It is used to initialize the server with the correct parameters based on user input.

**Table:** `configuration`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| transport | string | The transport mode for the server, either 'stdio' or 'http'. |
| port | number | The port number for HTTP mode. |

