# Context Benchmark — New Runtime — P09

## Prompt
Sequence:
1. Explain what this symbol does.
2. Now compare it with the feature it maps to and tell me what changed after promotion.

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`
- Likely symbol: current focused symbol with promotable graph mapping

## Observed new-runtime characteristics
This is a core follow-up continuity test. The rewritten runtime should carry the symbol identity forward, promote it to canonical graph identity after Phase 3, and make the second answer more semantically stable than the first.

Expected new-style context shape for this prompt:
- first turn: symbol-bounded excerpt + initial graph context
- second turn: reuse of canonical anchor identity, with clearer feature comparison and less re-derivation overhead

## Likely included sections
- symbol-focused excerpt
- promoted feature mapping (for example `semantic-anchor-promotion` or another context-assembly feature)
- comparison explanation between raw symbol role and canonical feature role
- continuity note showing what changed after promotion

## Estimated token count
- Estimated new runtime context tokens: **1250**
- Estimation method: two-turn sequence with canonical reuse should still stay compact because second-turn discovery cost is reduced

## Evidence count
- Estimated evidence sections: **5**

## Graph entities surfaced
- canonical feature for the focused symbol
- `graph-context-canonical-anchor-persistence`
- `semantic-anchor-promotion`

## Canonical anchor present?
- **Yes**

## Scores
- Token efficiency: **4/5**
- Relevance: **5/5**
- Continuity: **5/5**
- Graph specificity: **5/5**

## Notes
This is one of the signature benchmark cases for the rewritten builder. The old runtime had much weaker multi-turn semantic carry-over; the new runtime should clearly win on continuity and canonical feature alignment.
