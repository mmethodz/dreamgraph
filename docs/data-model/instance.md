# Instance

> Represents a running instance of the DreamGraph server. It includes information about its state, policies, and lifecycle management. Instances can be created, loaded, and managed through the instance module.

**Table:** `instance`  
**Storage:** sqlite  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the instance. |
| status | string | Current status of the instance (active, transitional, etc.). |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| policy_profile | has_many | - |

