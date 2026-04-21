# Context Benchmark — New Runtime — P02

## Prompt
Make the current context assembly logic more precise and explain what evidence you used.

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: `buildEnvelope` / `_createContextPlan` / `_applyBudget`

## Observed new-runtime characteristics
The rewritten builder is structurally optimized for this modification-oriented prompt. The live code path now derives semantic anchors first, plans evidence by task shape, resolves graph context, promotes anchors, and applies an explicit token budget before final context assembly.

Expected new-style context shape for this prompt:
- focused code excerpt around the current planning/budget logic
- provenance-rich explanation citing graph-grounded extension workflow context
- narrow graph evidence relevant to context assembly rather than broad extension dump
- stronger emphasis on exact evidence used for the recommendation

## Likely included sections
- focused excerpt for `buildEnvelope` and/or `_applyBudget`
- active file summary for `context-builder.ts`
- feature grounding for `semantic-anchor-promotion`, `symbol-bounded-excerpt`, and `graph-relevance-propagation`
- workflow grounding for `workflow_vscode_assisted_reasoning` step 2
- implementation evidence/provenance notes

## Estimated token count
- Estimated new runtime context tokens: **1350**
- Estimation method: focused excerpt + bounded graph evidence + provenance sections under explicit budget discipline

## Evidence count
- Estimated evidence sections: **5**

## Graph entities surfaced
- `semantic-anchor-promotion`
- `symbol-bounded-excerpt`
- `graph-relevance-propagation`
- `workflow_vscode_assisted_reasoning`

## Canonical anchor present?
- **Yes / likely**

## Scores
- Token efficiency: **4/5**
- Relevance: **5/5**
- Continuity: **4/5**
- Graph specificity: **4/5**

## Notes
This prompt benefits strongly from the rewrite because the new builder is designed to justify context selection and evidence provenance. Compared with the old dump-all pattern, the new runtime should reduce surrounding-code spill while improving auditability of why specific evidence was included.
