# Context Assembly Benchmark — Old Runtime — P09

## Prompt sequence
1. > Explain what this symbol does.
2. > Now compare it with the feature it maps to and tell me what changed after promotion.

## Active anchor
- File: `extensions/vscode/src/context-builder.ts`
- Local focus: current symbol in the context assembly path
- Selection present: no

## Old-runtime observed context pattern
The old runtime can usually preserve enough conversational locality to answer the follow-up, but semantic continuity is weaker. If the first turn did not establish a strong canonical feature identity, the second turn has to infer or restate that mapping rather than smoothly reusing a promoted anchor.

## Included sections
- First-turn symbol/file context
- Second-turn follow-up with repeated local context
- Broad feature attribution hints
- Limited continuity carry-over

## Estimated token count
- **2400**

## Evidence count
- **4** major evidence blocks

## Graph entities surfaced
- likely broad feature mapping rather than a stable canonical identity reused across turns

## Canonical anchor present?
- **No**

## Follow-up continuity quality (1-5)
- **2 / 5**

## Relevance quality (1-5)
- **3 / 5**

## Notes
Multi-turn continuity exists, but the old runtime often re-derives context rather than reusing a clearly promoted canonical anchor.
