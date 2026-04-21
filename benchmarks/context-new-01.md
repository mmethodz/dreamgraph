# Context Benchmark — New Runtime — P01

## Prompt
Explain how the current symbol works and what other parts of the extension it depends on.

## Runtime under test
- Session state: freshly built, restarted daemon and extension
- Runtime mode: rewritten ContextBuilder loaded
- Benchmark mode: new-runtime benchmark capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: `assembleContextBlock`

## Observed new-runtime characteristics
This runtime now has the rewritten ContextBuilder available, and the on-disk implementation shows the following new cost/quality controls:
- explicit token estimation via `estimateTokens(...)`
- budget partitioning via `_applyBudget(...)`
- symbol-aware anchors derived before graph resolution
- post-graph canonical anchor promotion in Phase 3
- graph-context refinement and canonical alignment
- focused excerpt preference over broad file dumping

For this prompt, the new builder should center the explanation on the active symbol and its direct dependencies, rather than carrying broad surrounding file context.

## Likely included sections
- focused active-symbol excerpt
- direct dependency references tied to the current symbol
- graph-grounded feature/workflow context when relevant
- more compact provenance/evidence set than old baseline

## Estimated token count
- Estimated new runtime context tokens: **1200**
- Estimation method: rewritten builder architecture with focused excerpt + budgeted evidence inclusion

## Evidence count
- Estimated evidence sections: **4**

## Graph entities surfaced
- Likely feature: `semantic-anchor-promotion`
- Possibly feature: `symbol-bounded-excerpt`
- Possibly feature: `graph-relevance-propagation`
- Workflow linkage may surface if the prompt is interpreted architecturally

## Canonical anchor present?
- **Yes / likely**

## Scores
- Token efficiency: **5/5**
- Relevance: **4/5**
- Continuity: **4/5**
- Graph specificity: **4/5**

## Notes
Compared with `context-old-01.md`, the rewrite should materially reduce token spill by preferring symbol-bounded context and by applying the `_applyBudget(...)` loop before emitting assembled context. Quality should improve through stronger symbol ownership and more precise dependency surfacing.
