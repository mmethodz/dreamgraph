# Context Benchmark — New Runtime — P03

## Prompt
What feature does this code most likely belong to?

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: `buildEnvelope` / anchor-promotion path

## Observed new-runtime characteristics
The rewritten runtime is explicitly better at feature ownership questions because it promotes symbol-level anchors toward canonical graph entities after graph context resolution. That means this prompt should surface feature identity with less ambiguity than the old runtime.

Expected new-style context shape for this prompt:
- symbol-aware excerpt centered on context-builder behavior
- feature candidates ranked by semantic proximity to anchor and file path
- likely canonical mapping to context-assembly feature entities instead of generic VS Code extension ownership only

## Likely included sections
- focused excerpt from `context-builder.ts`
- feature match evidence for `semantic-anchor-promotion`
- supporting context for `symbol-bounded-excerpt` or `graph-relevance-propagation`
- brief ownership explanation connecting local code to the extension workflow

## Estimated token count
- Estimated new runtime context tokens: **950**
- Estimation method: feature-ownership question with narrow code excerpt and selective graph context only

## Evidence count
- Estimated evidence sections: **4**

## Graph entities surfaced
- `semantic-anchor-promotion`
- `symbol-bounded-excerpt`
- `graph-relevance-propagation`
- possibly `feature_vscode_extension` as boundary context

## Canonical anchor present?
- **Yes**

## Scores
- Token efficiency: **5/5**
- Relevance: **5/5**
- Continuity: **4/5**
- Graph specificity: **5/5**

## Notes
This is one of the strongest benchmark cases for the rewrite. The old runtime was more likely to answer at the level of "VS Code extension integration" broadly; the new runtime should be able to point to more specific context-assembly features with higher confidence and lower token cost.
