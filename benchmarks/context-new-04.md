# Context Benchmark — New Runtime — P04

## Prompt
How does this code participate in the VS Code assisted reasoning workflow?

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: `buildEnvelope`

## Observed new-runtime characteristics
This prompt aligns directly with graph workflow retrieval. The new runtime should connect the local code to `workflow_vscode_assisted_reasoning`, especially step 2: building or retrieving relevant DreamGraph context for the current editing situation.

Expected new-style context shape for this prompt:
- narrow code excerpt showing envelope construction and graph-context resolution
- workflow grounding with the step that this file implements
- extension-boundary explanation tying `context-builder.ts` to `chat-panel.ts` and extension activation surfaces

## Likely included sections
- focused excerpt around `buildEnvelope`
- workflow entity: `workflow_vscode_assisted_reasoning`
- feature context: `feature_vscode_extension`
- brief dependency mention of `chat-panel.ts` / daemon communication

## Estimated token count
- Estimated new runtime context tokens: **1100**
- Estimation method: focused code excerpt plus one workflow entity and small amount of feature boundary context

## Evidence count
- Estimated evidence sections: **4**

## Graph entities surfaced
- `workflow_vscode_assisted_reasoning`
- `feature_vscode_extension`
- possibly `semantic-anchor-promotion`

## Canonical anchor present?
- **Yes / likely**

## Scores
- Token efficiency: **4/5**
- Relevance: **5/5**
- Continuity: **4/5**
- Graph specificity: **5/5**

## Notes
The rewrite should outperform the old runtime here because the workflow relationship is now more likely to be surfaced intentionally rather than inferred from a broad extension dump. This is a quality win more than a raw cost win.
