# DreamGraph v7.1 — Planning Notes

## Multi-Modal Input Prompt

**Priority:** HIGH  
**Target:** v7.1  

### Problem

DreamGraph currently accepts only text-based input through MCP tool parameters. For UI registry workflows — where visual context is essential — this is a significant limitation. An agent describing a screenshot in words loses spatial layout, color relationships, component hierarchy, and visual intent that a single image would convey immediately.

### Scope

Add multi-modal input support so DreamGraph tools can accept images (screenshots, wireframes, design mockups) alongside text prompts. Primary consumers:

1. **`register_ui_element`** — Accept a screenshot/mockup of the element being registered. Extract visual properties (layout, hierarchy, interaction affordances) to enrich the semantic definition automatically.

2. **`query_ui_elements`** — "Find elements that look like this" — visual similarity search against registered element screenshots.

3. **`generate_ui_migration_plan`** — Accept source platform screenshots to improve gap analysis accuracy. Visual diff between source and target.

4. **Dream cycle integration** — Feed UI screenshots into dream strategies so the cognitive engine can reason about visual patterns, not just textual descriptions.

### Technical Considerations

- MCP SDK supports binary content via `BlobResourceContents` — investigate whether tool parameters can accept base64-encoded images or if a resource-based approach is needed.
- LLM vision APIs (OpenAI `gpt-4o`, Anthropic `claude-3.5-sonnet`) accept images natively — the `llm.ts` provider abstraction needs an image parameter path.
- Storage: images in `data/` as referenced blobs, or inline base64 in JSON (size tradeoff).
- Consider a `describe_image` utility tool that converts an image to a structured description, usable by any other tool.

### Deferred Items from v7.0 Self-Assessment

These items were identified during the v7.0 pre-release self-assessment and deferred from the v7.0.0 release:

| Item | Severity | Notes |
|------|----------|-------|
| Per-entity delete tool | MEDIUM | Add `delete_entity` MCP tool for granular removal of individual dream edges, nodes, candidates, validated edges, and fact graph entities |
| Tension triage tool | MEDIUM | New `triage_tensions` tool — group by domain/urgency, batch resolve/defer/archive, severity classification |
| Validation rate tuning | LOW | Monitor over 50+ cycles; tune `PromotionConfig` thresholds if rate stays below 15% |
| Discipline tool exception safety | HIGH | 7/9 discipline tools lack try/catch — wrap in `safeExecute` |
