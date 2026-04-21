# VS Code Autonomy Continuation Loop

> Auto-generated primary workflow doc. Canonical structured source: data/workflows.json.

> After each architect pass, the extension extracts the structured pass envelope, derives recommended actions, analyzes continuation safety against autonomy mode and pass budget, updates visible autonomy status, and may self-continue with a synthesized next prompt until the goal is reached, risk rises, or the budget is exhausted.

**Trigger:** assistant pass completion in the VS Code architect chat panel  
**Source files:** extensions/vscode/src/chat-panel.ts, extensions/vscode/src/autonomy-loop.ts, extensions/vscode/src/autonomy-structured.ts, extensions/vscode/src/autonomy.ts, extensions/vscode/src/reporting.ts  

## Flowchart

```mermaid
flowchart TD
    S1["Detect requested/configured autonomy mode and pass budget"]
    S2["Inject reporting/autonomy instruction blocks into the architect system prompt"]
    S1 --> S2
    S3["Extract structured pass envelope and recommended next actions from the response"]
    S2 --> S3
    S4["Analyze progress, uncertainty, and scope to decide continuation"]
    S3 --> S4
    S5["Broadcast autonomy status and actions to the webview"]
    S4 --> S5
    S6["If allowed, synthesize the next prompt and run another bounded pass"]
    S5 --> S6
```

## Steps

### 1. Detect requested/configured autonomy mode and pass budget

Read the current autonomy settings so continuation decisions stay within configured limits.

### 2. Inject reporting/autonomy instruction blocks into the architect system prompt

Ensure the assistant response format includes the structured continuation envelope needed by the extension.

### 3. Extract structured pass envelope and recommended next actions from the response

Parse the assistant output to recover progress, uncertainty, and action recommendations.

### 4. Analyze progress, uncertainty, and scope to decide continuation

Determine whether the session should continue automatically or stop based on policy and current state.

### 5. Broadcast autonomy status and actions to the webview

Update the visible UI so the user can see the autonomy state and proposed next steps.

### 6. If allowed, synthesize the next prompt and run another bounded pass

Perform another controlled assistant turn only when autonomy mode and safety checks permit it.

