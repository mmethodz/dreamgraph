# Context Benchmark — New Runtime — P10

## Prompt
Sequence:
1. Explain the current anchor and its likely graph feature.
2. Save/restore session / reopen panel.
3. Continue from the same anchor and refine the answer.

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: promotable context-assembly anchor

## Observed new-runtime characteristics
This benchmark tests persistence and restore continuity. The rewritten runtime should preserve canonical anchor identity into chat memory so that a restored conversation resumes from the promoted feature identity rather than a raw positional symbol guess.

Expected new-style context shape for this prompt:
- first turn: anchor explanation + likely feature mapping
- restored turn: same anchor rehydrated with canonical identity, producing a more stable refinement rather than partial rediscovery

## Likely included sections
- current symbol/anchor excerpt
- canonical feature mapping explanation
- continuity note after restore showing anchor reuse
- possibly `chat-panel.ts` persistence boundary context if needed

## Estimated token count
- Estimated new runtime context tokens: **1300**
- Estimation method: restore continuity adds some explanatory overhead but avoids broad rediscovery costs

## Evidence count
- Estimated evidence sections: **5**

## Graph entities surfaced
- `graph-context-canonical-anchor-persistence`
- `semantic-anchor-promotion`
- possibly `feature_vscode_extension`

## Canonical anchor present?
- **Yes**

## Scores
- Token efficiency: **4/5**
- Relevance: **5/5**
- Continuity: **5/5**
- Graph specificity: **5/5**

## Notes
This prompt is expected to show one of the largest continuity improvements of the rewrite. The new runtime should be markedly better than the old baseline at preserving semantic identity across panel/session restoration.
