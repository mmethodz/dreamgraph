# VS Code Assisted Reasoning

**Trigger:**   

## Flowchart

```mermaid
flowchart TD
    S1["Activate the VS Code extension and establish daemon communication."]
    S2["Build or retrieve relevant DreamGraph context for the current editing situation."]
    S1 --> S2
    S3["Render conversational or dashboard surfaces inside VS Code."]
    S2 --> S3
    S4["Let the user ask questions, inspect context, and monitor DreamGraph state from the editor."]
    S3 --> S4
    S5["Reflect daemon health and status through lightweight UI signals such as the status bar."]
    S4 --> S5
    S6["When a local run_command tool execution times out, automatically retry once with a longer timeout before escalating to the user."]
    S5 --> S6
```

## Steps

### 1. Activate the VS Code extension and establish daemon communication.

### 2. Build or retrieve relevant DreamGraph context for the current editing situation.

### 3. Render conversational or dashboard surfaces inside VS Code.

### 4. Let the user ask questions, inspect context, and monitor DreamGraph state from the editor.

### 5. Reflect daemon health and status through lightweight UI signals such as the status bar.

### 6. When a local run_command tool execution times out, automatically retry once with a longer timeout before escalating to the user.

