---
title: "State Machine"
---

# State Machine

> Defines the state transitions and behavior for instances within the DreamGraph system. State machines are essential for managing the lifecycle and operational states of instances.

**Table:** `state_machine`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| currentState | string | The current state of the instance. |
| transitions | array | Possible transitions from the current state. |

