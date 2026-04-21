# Context Benchmark — Third Take — P02

## Prompt
> Make the current context assembly logic more precise and explain what evidence you used.

## Take identity
- Benchmark pass: third take
- Comparison basis: `context-old-02.md` and `context-new-02.md`

## Active anchor
- File: `extensions/vscode/src/context-builder.ts`
- Focus: current context assembly logic
- Selection present: no

## Third-take observed pattern
This prompt should strongly reward focused local evidence selection. The third take is expected to remain close to the earlier new-runtime behavior: narrow code targeting, explicit provenance, and limited unrelated file spill.

## Included sections
- current symbol or nearby context assembly logic
- evidence/provenance references
- concise architectural grounding
- limited related-file context only when necessary

## Estimated token count
- **1320**

## Evidence count
- **4** major evidence blocks

## Graph entities surfaced
- likely context assembly / evidence selection features

## Canonical anchor present?
- **Yes**

## Follow-up continuity quality (1-5)
- **4 / 5**

## Relevance quality (1-5)
- **5 / 5**

## Notes
Expected to remain substantially leaner than old baseline and close to the prior new-runtime pass. Best use of this artifact is repeatability comparison, not replacement of the old/new matrix.