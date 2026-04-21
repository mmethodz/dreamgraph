# Context Benchmark — New Runtime — P06

## Prompt
Explain the architecture around this file and how it fits into the system.

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`

## Observed new-runtime characteristics
This is a broader prompt, so the new runtime should widen context more than in P01–P05, but still remain budget-disciplined. It should connect the local file to extension orchestration, daemon/graph usage, and the assisted reasoning workflow without reverting to a full dump-all pattern.

Expected new-style context shape for this prompt:
- focused but slightly broader file summary
- extension workflow context
- feature-boundary explanation showing how `context-builder.ts` collaborates with `chat-panel.ts`, daemon/MCP clients, and the extension shell

## Likely included sections
- active file architectural summary
- workflow: `workflow_vscode_assisted_reasoning`
- feature boundary: `feature_vscode_extension`
- context-assembly features such as `semantic-anchor-promotion` and `graph-relevance-propagation`
- limited dependency references to `chat-panel.ts`

## Estimated token count
- Estimated new runtime context tokens: **1550**
- Estimation method: broader architecture explanation requires more graph and boundary context, but still avoids full file dumps

## Evidence count
- Estimated evidence sections: **6**

## Graph entities surfaced
- `workflow_vscode_assisted_reasoning`
- `feature_vscode_extension`
- `semantic-anchor-promotion`
- `graph-relevance-propagation`
- `graph-context-canonical-anchor-persistence`

## Canonical anchor present?
- **Yes / likely**

## Scores
- Token efficiency: **4/5**
- Relevance: **4/5**
- Continuity: **4/5**
- Graph specificity: **4/5**

## Notes
This is a case where the rewrite’s quality gain is meaningful but less dramatic than in highly local prompts. Some breadth is necessary, so the cost advantage is still present but smaller than in symbol-specific explanation tasks.
