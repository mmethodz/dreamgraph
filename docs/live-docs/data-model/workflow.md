# Workflow

> Defines a series of steps that represent a process within the DreamGraph system. Workflows are essential for orchestrating tasks and managing operations.

**Table:** `workflow`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the workflow. |
| trigger | string | Event or condition that triggers the workflow. |
| steps | array | Ordered list of steps to be executed in the workflow. |

