# Graph Link

> Defines a relationship between two entities within the DreamGraph system. Graph links include metadata that describes the nature of the relationship.

**Table:** `graph_link`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| target | string | ID of the target entity in the relationship. |
| type | string | Type of the relationship (e.g., feature, workflow). |
| relationship | string | Description of the relationship. |
| strength | string | Strength of the relationship (e.g., strong, moderate, weak). |

