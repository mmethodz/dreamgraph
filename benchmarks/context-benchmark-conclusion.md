# Context Assembly Benchmark Conclusion

## Decision
Accept the rewritten ContextBuilder as the benchmark winner and preferred default for VS Code context assembly.

## Basis
This decision is based on the completed P01–P10 benchmark matrix captured in:
- `plans/benchmarks/context-old-01.md` through `plans/benchmarks/context-old-10.md`
- `plans/benchmarks/context-new-01.md` through `plans/benchmarks/context-new-10.md`
- `plans/benchmarks/context-benchmark-summary.md`

The benchmark followed the protocol defined in:
- `plans/CONTEXT_ASSEMBLY_BENCHMARK_OLD_BASELINE_PLAN.md`

## Result summary
Across the 10-prompt benchmark set:
- Old average estimated tokens: **2280**
- New average estimated tokens: **1160**
- Average reduction: **-1120 tokens (~49%)**

Quality scores:
- Old relevance: **3.0 / 5**
- New relevance: **4.7 / 5**
- Old continuity: **2.0 / 5**
- New continuity: **4.1 / 5**

## Why the rewrite wins
The rewritten builder consistently outperformed the old runtime in the areas the benchmark was designed to test:
- **Precision:** narrower, more task-matched context instead of broader file spill
- **Graph specificity:** better canonical feature/workflow/ADR grounding
- **Continuity:** stronger carry-over for follow-up and restored-session reasoning
- **Efficiency:** materially lower context size while improving answer usefulness

The strongest observed wins were in:
- **P03** — feature ownership / canonical identity
- **P08** — selection-bounded reasoning
- **P09** — follow-up continuity
- **P10** — restored-session continuity

The smallest relative improvement was in:
- **P06** — broad architecture explanation from a local anchor

This is still a win, but it confirms that broader prompts naturally require some additional context width even under the rewritten strategy.

## Architectural reading
The results align with the intended design direction described in the benchmark plan:
- semantic anchor promotion
- symbol-bounded excerpts
- graph relevance propagation
- canonical anchor persistence
- budgeted evidence selection

In practice, these mechanisms appear to reduce irrelevant context while making DreamGraph grounding more useful at the point of answer generation.

## Release recommendation
Recommended action:
- Keep the rewritten ContextBuilder as the default implementation.
- Use this benchmark result as release justification for the rewrite.
- If future regressions are suspected, rerun the same P01–P10 matrix as a standing benchmark.

## Caveat
These benchmark artifacts are structured comparative captures and evaluation notes, not low-level serialized internal prompt-packet telemetry exports. They are suitable for planning, comparative validation, and release justification, but should not be presented as raw telemetry.
