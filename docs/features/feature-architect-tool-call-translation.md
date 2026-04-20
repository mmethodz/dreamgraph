# Architect Tool Call Translation

> Provides provider-specific and normalized tool-calling support in the architect LLM layer, including callWithTools orchestration, Anthropic/OpenAI tool schema submission, tool_use parsing, finish/stop-reason normalization, and raw message translation between Anthropic-style and OpenAI-compatible formats. RCA evidence shows this infrastructure already existed before the failure but was never wired into the chat panel execution loop.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/architect-llm.ts, plans/RCA_AGENTIC_LOOP.md  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_agentic_tool_execution_loop | feature | related_to | moderate |  |
| feature_vscode_extension | feature | related_to | moderate |  |

**Tags:** llm, anthropic, openai, tool-calling, translation, rca

