# Context Benchmark — New Runtime — P07

## Prompt
Summarize what matters in this area even if there is no exact graph match.

## Runtime under test
- Session state: extension + daemon restarted, rewritten ContextBuilder active
- Benchmark mode: new-runtime comparison capture

## Active anchor target
- File: `extensions/vscode/src/context-builder.ts`

## Observed new-runtime characteristics
This is the main fallback test. The rewrite should still behave acceptably when graph matching is imperfect: it should keep a focused code-local explanation and only add graph context that is genuinely relevant, instead of compensating by dumping broad unrelated context.

Expected new-style context shape for this prompt:
- bounded code summary first
- cautious feature/workflow references where confidence is limited
- explicit acknowledgement of uncertainty if graph specificity is sparse or noisy

## Likely included sections
- focused excerpt from current symbol or surrounding file region
- concise architectural summary
- maybe one or two weak-but-relevant feature references
- explicit uncertainty note

## Estimated token count
- Estimated new runtime context tokens: **1000**
- Estimation method: fallback prompt with local-code emphasis and reduced graph breadth

## Evidence count
- Estimated evidence sections: **4**

## Graph entities surfaced
- likely `feature_vscode_extension`
- possibly one context-assembly feature if confidence remains adequate

## Canonical anchor present?
- **Partial / maybe**

## Scores
- Token efficiency: **5/5**
- Relevance: **4/5**
- Continuity: **3/5**
- Graph specificity: **3/5**

## Notes
This is where the new builder’s main tradeoff appears: it may under-include compared with dump-all, but the resulting context should still be more useful on average because it avoids masking uncertainty with noisy breadth.
