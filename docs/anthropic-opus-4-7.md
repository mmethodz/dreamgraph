# Anthropic Architect Configuration and Claude Opus 4.7 Migration

This document describes how DreamGraph's VS Code Architect integrates with Anthropic models, with special guidance for **Claude Opus 4.7**.

## Current DreamGraph defaults

DreamGraph currently keeps **`claude-opus-4-6`** as the default Anthropic Architect model while exposing **`claude-opus-4-7`** as a first-class selectable option in the model picker and settings.

Why:

- it preserves the currently established default behavior
- it allows immediate Opus 4.7 adoption without requiring `Custom...`
- it gives a compatibility margin while Anthropic-specific request shaping evolves

## Relevant VS Code settings

DreamGraph exposes these extension settings:

- `dreamgraph.architect.provider`
- `dreamgraph.architect.model`
- `dreamgraph.architect.anthropic.effort`
- `dreamgraph.architect.anthropic.adaptiveThinking`
- `dreamgraph.architect.anthropic.showThinkingSummary`

Recommended starting values:

| Model | Recommended effort | Adaptive thinking | Thinking summary |
|---|---|---:|---:|
| `claude-opus-4-6` | `high` | off or conservative | optional |
| `claude-opus-4-7` | `xhigh` for coding/agentic work | on | on |

## Implemented DreamGraph behavior

Current Architect behavior for Anthropic requests:

- **Opus 4.6** remains the default UI selection.
- **Opus 4.7** is directly selectable.
- If effort is configured as `xhigh` while using **Opus 4.6**, DreamGraph clamps it to `high` for compatibility.
- For **Opus 4.7**, DreamGraph can send adaptive thinking and optionally summarized thinking visibility.

## Claude Opus 4.7 API migration notes

Anthropic changed several Messages API behaviors for Opus 4.7.

### 1. Extended thinking budgets are removed

Old pattern:

```python
client.messages.create(
    model="claude-opus-4-6",
    max_tokens=64000,
    thinking={"type": "enabled", "budget_tokens": 32000},
    messages=[{"role": "user", "content": "..."}],
)
```

New pattern:

```python
client.messages.create(
    model="claude-opus-4-7",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={"effort": "high"},
    messages=[{"role": "user", "content": "..."}],
)
```

For DreamGraph this means:

- do not send `thinking: { type: "enabled", budget_tokens: N }` to Opus 4.7
- use adaptive thinking instead
- control depth primarily through `output_config.effort`

### 2. Effort matters more on Opus 4.7

Anthropic guidance indicates:

- `xhigh` is the recommended default for coding and agentic use cases
- `high` is a strong minimum for intelligence-sensitive work
- `medium` and `low` should be treated as deliberate cost/latency trade-offs
- `max` may improve some difficult tasks but can increase token use and overthinking risk

Practical DreamGraph guidance:

- use `xhigh` for graph-grounded coding, architecture analysis, and multi-step tool orchestration on Opus 4.7
- keep `high` as the stable default extension setting for now unless you intentionally optimize for Opus 4.7-first behavior
- if you later switch the UI default model to Opus 4.7, reconsider making `xhigh` the default effort at the same time

### 3. Thinking summaries are no longer implicit

On Opus 4.7, thinking content is omitted by default unless explicitly requested.

If your product benefits from visible reasoning progress during long-running traces, opt in:

```python
thinking = {
    "type": "adaptive",
    "display": "summarized",
}
```

For DreamGraph this maps to:

- `dreamgraph.architect.anthropic.showThinkingSummary = true`

This is especially relevant for chat UX because otherwise long reasoning phases may appear as a silent pause.

### 4. Sampling knobs should be omitted

Anthropic documents that non-default `temperature`, `top_p`, and `top_k` values can cause 400 errors on Opus 4.7.

DreamGraph guidance:

- omit non-default sampling parameters for Opus 4.7 requests
- steer behavior with prompting, effort, and task shaping instead

### 5. Token budgeting should be re-baselined

Opus 4.7 uses a newer tokenizer and may consume more tokens than Opus 4.6 for the same text.

Implications for DreamGraph:

- re-check `max_tokens` assumptions for long Architect interactions
- re-test any token estimation logic
- leave extra headroom for graph-grounded tool traces, especially at `xhigh` or `max`

Anthropic recommends starting around **64k max output tokens** for `xhigh` or `max` effort configurations.

### 6. High-resolution image support changes cost and behavior

Opus 4.7 supports higher-resolution images automatically:

- up to **2576 px / 3.75 MP**
- previous practical cap was **1568 px / 1.15 MP**

Implications:

- better screenshot, artifact, and document understanding
- simpler coordinate handling because coordinates are 1:1 with actual pixels
- potentially much higher token usage for image-heavy prompts

Recommendation:

- downsample images before sending when the extra fidelity is unnecessary
- re-budget image-heavy Architect workflows

## Task budgets

Anthropic introduced **task budgets** for Opus 4.7 as a beta feature.

These are advisory budgets across the full agentic loop, including:

- thinking
- tool calls
- tool results
- final output

DreamGraph does **not** need to enable this by default.

Recommended posture:

- do not default task budgets on for open-ended architecture and coding work
- consider them later for constrained, budget-sensitive workflows
- treat them separately from `max_tokens`, which remains a hard cap

## Suggested migration checklist for DreamGraph users

- Update model name from `claude-opus-4-6` to `claude-opus-4-7` when ready.
- Remove non-default `temperature`, `top_p`, and `top_k` from Opus 4.7 request payloads.
- Replace old extended thinking budgets with adaptive thinking plus effort.
- Explicitly enable summarized thinking if your UX depends on visible progress.
- Re-test token usage, latency, and cost.
- Re-tune `max_tokens` for long-running Architect tasks.
- Re-budget image-heavy workloads because high-resolution vision can use materially more tokens.
- Review prompts for Opus 4.7's more literal instruction following and different verbosity calibration.

## Prompting considerations

Anthropic's migration guidance suggests Opus 4.7 is:

- more literal
- more direct in tone
- less likely to overuse tools by default
- more sensitive to effort level

That means DreamGraph operators should:

- be more explicit in tool-use and output-shape instructions
- prefer positive examples over vague warnings
- tune prompts for desired verbosity rather than assuming a stable baseline
- raise effort instead of trying to prompt around under-thinking on complex tasks

## External reference

Anthropic migration guide:

- https://platform.claude.com/docs/en/about-claude/models/migration-guide#migrating-to-claude-opus-4-7
