# Anthropic Pacing Discipline

> Canonical provider-pacing feature for architect chat execution. Adds bounded retry and spacing behavior around Anthropic/rate-limit scenarios so iterative tool loops back off instead of hammering the provider.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/chat-panel.ts, extensions/vscode/src/architect-llm.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_architect_tool_call_translation | feature | related_to | moderate |  |
| feature_agentic_tool_execution_loop | feature | related_to | moderate |  |
| feature_vscode_extension | feature | related_to | moderate |  |

**Tags:** anthropic, rate-limit, retry, pacing, architect

