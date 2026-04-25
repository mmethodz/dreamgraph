# State Machine

> Manages the various states of the DreamGraph application, allowing transitions between states based on defined rules. It is crucial for maintaining application flow and logic.

**Table:** `state_machine`  
**Storage:** memory  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| currentState | string | The current state of the application. |
| transitions | array | The possible transitions from the current state. |

