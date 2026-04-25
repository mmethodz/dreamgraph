# Discipline Session

> Task session entity representing a governed engineering effort with phase state, scope, tool usage history, artifacts, deltas, and plans.

**Table:** ``  
**Storage:** unknown  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | unknown |  |
| type | unknown |  |
| description | unknown |  |
| target_scope | unknown |  |
| phase | unknown |  |
| requires_ground_truth | unknown |  |
| artifacts | unknown |  |
| violations | unknown |  |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| contains delta entries | references | - |
| contains implementation plans | references | - |
| constrains tool use | references | - |

