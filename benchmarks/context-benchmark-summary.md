# Context Assembly Benchmark Summary

## Status
- Old baseline captured: `plans/benchmarks/context-old-01.md` through `plans/benchmarks/context-old-10.md`
- New runtime benchmark captured: `plans/benchmarks/context-new-01.md` through `plans/benchmarks/context-new-10.md`
- This summary now compares saved old-runtime artifacts for the full P01–P10 matrix against the saved new-runtime artifacts

## Side-by-side summary

| Prompt | Old est. tokens | New est. tokens | Delta | Old relevance | New relevance | Old continuity | New continuity | Winner | Notes |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| P01 | 2600 | 1200 | -1400 (-54%) | 3 | 4 | 2 | 4 | New | Symbol-bounded / budgeted context cuts broad file spill while improving dependency precision |
| P02 | 2500 | 1350 | -1150 (-46%) | 3 | 5 | 2 | 4 | New | Modification prompt benefits from explicit evidence/provenance selection and focused code excerpts |
| P03 | 2100 | 950 | -1150 (-55%) | 3 | 5 | 2 | 4 | New | Feature ownership becomes more canonical and less generic than old extension-level attribution |
| P04 | 2200 | 1100 | -1100 (-50%) | 3 | 5 | 2 | 4 | New | Workflow step grounding is more direct and less inferential in the rewritten builder |
| P05 | 2000 | 1050 | -950 (-48%) | 3 | 5 | 2 | 4 | New | ADR-specific retrieval is tighter and avoids broad architectural noise |
| P06 | 2800 | 1550 | -1250 (-45%) | 3 | 4 | 2 | 4 | New | Broad architecture still needs some width, so cost win is smaller but remains strong |
| P07 | 1900 | 1000 | -900 (-47%) | 3 | 4 | 2 | 3 | New | Fallback stays focused and explicit about uncertainty instead of compensating with dump-heavy breadth |
| P08 | 1800 | 850 | -950 (-53%) | 3 | 5 | 2 | 4 | New | Selection-bounded reasoning is one of the strongest efficiency/quality wins of the rewrite |
| P09 | 2400 | 1250 | -1150 (-48%) | 3 | 5 | 2 | 5 | New | Canonical promotion gives much better multi-turn continuity and feature comparison |
| P10 | 2500 | 1300 | -1200 (-48%) | 3 | 5 | 2 | 5 | New | Restored-session anchor persistence is a major continuity improvement over the old runtime |

## Aggregate view

### Average estimated tokens
- Old average: **2280**
- New average: **1160**
- Average delta: **-1120 tokens (~49%)**

### Average scores
- Old relevance: **3.0 / 5**
- New relevance: **4.7 / 5**
- Old continuity: **2.0 / 5**
- New continuity: **4.1 / 5**

## Overall read
Across the full 10-prompt matrix, the rewritten ContextBuilder is estimated to be roughly **49% cheaper** in context size while materially improving quality. The biggest improvements appear in:
- feature ownership / canonical identity questions (P03)
- selection-bounded reasoning (P08)
- follow-up continuity (P09)
- restore continuity (P10)

The smallest relative gain appears in broader architectural prompts (P06), where some breadth remains necessary.

## Evidence base
Old-runtime artifacts:
- `plans/benchmarks/context-old-01.md`
- `plans/benchmarks/context-old-02.md`
- `plans/benchmarks/context-old-03.md`
- `plans/benchmarks/context-old-04.md`
- `plans/benchmarks/context-old-05.md`
- `plans/benchmarks/context-old-06.md`
- `plans/benchmarks/context-old-07.md`
- `plans/benchmarks/context-old-08.md`
- `plans/benchmarks/context-old-09.md`
- `plans/benchmarks/context-old-10.md`

New-runtime artifacts:
- `plans/benchmarks/context-new-01.md`
- `plans/benchmarks/context-new-02.md`
- `plans/benchmarks/context-new-03.md`
- `plans/benchmarks/context-new-04.md`
- `plans/benchmarks/context-new-05.md`
- `plans/benchmarks/context-new-06.md`
- `plans/benchmarks/context-new-07.md`
- `plans/benchmarks/context-new-08.md`
- `plans/benchmarks/context-new-09.md`
- `plans/benchmarks/context-new-10.md`

## Caveat
These artifacts are structured benchmark captures and saved evaluation notes, not raw serialized internal prompt-packet dumps. They are suitable for comparative planning/reporting, but not equivalent to low-level telemetry export.
