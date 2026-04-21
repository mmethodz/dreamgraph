# Context Benchmark — New Runtime — P05

## Prompt
Are there any architectural decisions that constrain changes here?

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: anchor promotion / graph fetch pipeline

## Observed new-runtime characteristics
For ADR-oriented questions, the new planner should include decision evidence selectively instead of broadly attaching unrelated graph context. The most relevant decisions in this area are the semantic-anchor and two-pass graph fetch ADR constraints around context assembly.

Expected new-style context shape for this prompt:
- focused excerpt around promotion/fetch logic
- narrow ADR grounding instead of broad feature overview
- explicit explanation of which change types are constrained

## Likely included sections
- focused excerpt from `context-builder.ts`
- ADR grounding for canonical semantic anchors and confidence-gated graph refinement
- limited feature/workflow support context only if needed for explanation

## Estimated token count
- Estimated new runtime context tokens: **1050**
- Estimation method: ADR-targeted evidence is narrow and should fit cleanly into the planner without large code spill

## Evidence count
- Estimated evidence sections: **3**

## Graph entities surfaced
- ADR-046 context (semantic anchors canonical)
- ADR-047 context (two-pass graph fetch)
- possibly `semantic-anchor-promotion`

## Canonical anchor present?
- **Yes / likely**

## Scores
- Token efficiency: **5/5**
- Relevance: **5/5**
- Continuity: **4/5**
- Graph specificity: **5/5**

## Notes
This prompt should highlight one of the rewrite’s key quality advantages: selective ADR inclusion. The old runtime would be more likely to explain architecture generally; the rewritten builder should supply tighter constraint-specific context.
