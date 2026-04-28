# Policy Profile

> Defines a set of policies that govern the behavior of an instance. Policy profiles can be validated and switched dynamically based on the instance's requirements.

**Table:** `policy_profile`  
**Storage:** sqlite  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the policy profile. |
| name | string | Human-readable name for the policy profile. |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| instance | belongs_to | - |

