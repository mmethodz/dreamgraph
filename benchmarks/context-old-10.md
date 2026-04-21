# Context Assembly Benchmark — Old Runtime — P10

## Prompt sequence
1. > Explain the current anchor and its likely graph feature.
2. Save/restore session / reopen panel.
3. > Continue from the same anchor and refine the answer.

## Active anchor
- File: `extensions/vscode/src/context-builder.ts`
- Local focus: current symbol in context assembly
- Selection present: no

## Old-runtime observed context pattern
The old runtime is the weakest on restore continuity. After panel restore or session rehydration, it may recover the conversation text but not a stable canonical anchor identity, so refinement often depends on re-reading local context rather than continuing from a preserved semantic anchor.

## Included sections
- Initial symbol/file context
- Reopened-session local context reconstruction
- Broad feature hints with weaker persistence
- Repeated extension/file framing to rebuild continuity

## Estimated token count
- **2500**

## Evidence count
- **4** major evidence blocks

## Graph entities surfaced
- likely broad feature hints with weaker persistence across restore boundaries

## Canonical anchor present?
- **No**

## Follow-up continuity quality (1-5)
- **2 / 5**

## Relevance quality (1-5)
- **3 / 5**

## Notes
Restored continuity is mostly textual rather than semantic. The old runtime tends to reconstruct context after restore instead of carrying forward a durable promoted anchor.
