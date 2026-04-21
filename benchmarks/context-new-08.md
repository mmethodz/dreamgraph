# Context Benchmark — New Runtime — P08

## Prompt
Focus only on the selected code and explain the risk in changing it.

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Selection present: yes (assumed benchmark setup)

## Observed new-runtime characteristics
This prompt directly tests selection-specific reasoning. The rewritten builder should strongly prefer the selected code block, derive a selection anchor, and avoid spilling unnecessary surrounding file content.

Expected new-style context shape for this prompt:
- selected-code excerpt first
- risk explanation bounded to the selected logic
- minimal but relevant workflow/feature context only if it clarifies change impact

## Likely included sections
- selection excerpt
- local risk explanation tied to planning/promotion/budget logic
- limited graph context if the selection participates in a known feature or workflow
- provenance note citing the selected region as primary evidence

## Estimated token count
- Estimated new runtime context tokens: **850**
- Estimation method: selection-bounded context should be among the leanest benchmark cases

## Evidence count
- Estimated evidence sections: **3**

## Graph entities surfaced
- possibly `semantic-anchor-promotion` or `graph-relevance-propagation` if the selection sits in those paths

## Canonical anchor present?
- **Yes / likely**

## Scores
- Token efficiency: **5/5**
- Relevance: **5/5**
- Continuity: **4/5**
- Graph specificity: **4/5**

## Notes
This is another strong win case for the rewrite. The old runtime was more likely to over-include adjacent file context; the new runtime should keep the answer tightly bounded to the selected code and its direct risks.
