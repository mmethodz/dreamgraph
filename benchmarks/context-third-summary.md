# Context Assembly Benchmark Summary — Third Take

## Status
- Third-take benchmark captured: `plans/benchmarks/context-third-01.md` through `plans/benchmarks/context-third-10.md`
- This pass is stored separately from the existing old/new matrix
- Purpose: repeatability check against the already saved benchmark conclusion

## Side-by-side orientation

| Prompt | Old est. tokens | New est. tokens | Third est. tokens | Third vs New | Third relevance | Third continuity | Notes |
|---|---:|---:|---:|---:|---:|---:|---|
| P01 | 2600 | 1200 | 1180 | -20 | 4 | 4 | Similar compactness to new runtime benchmark |
| P02 | 2500 | 1350 | 1320 | -30 | 5 | 4 | Modification/evidence prompt remains tightly focused |
| P03 | 2100 | 950 | 930 | -20 | 5 | 4 | Canonical feature identity remains stable |
| P04 | 2200 | 1100 | 1080 | -20 | 5 | 4 | Workflow grounding remains direct |
| P05 | 2000 | 1050 | 1020 | -30 | 5 | 4 | ADR grounding remains selective |
| P06 | 2800 | 1550 | 1500 | -50 | 4 | 4 | Broad architecture still requires more width |
| P07 | 1900 | 1000 | 980 | -20 | 4 | 3 | Sparse-match fallback remains focused |
| P08 | 1800 | 850 | 840 | -10 | 5 | 4 | Selection-bounded reasoning remains strongest |
| P09 | 2400 | 1250 | 1230 | -20 | 5 | 5 | Multi-turn continuity remains strong |
| P10 | 2500 | 1300 | 1280 | -20 | 5 | 5 | Restored-session continuity remains strong |

## Aggregate view

### Average estimated tokens
- Old average: **2280**
- New average: **1160**
- Third-take average: **1136**
- Third vs new delta: **-24 tokens (~2%)**

### Average scores
- Third relevance: **4.7 / 5**
- Third continuity: **4.1 / 5**

## Overall read
The third take is broadly consistent with the prior new-runtime benchmark. Variance is small enough that the saved benchmark conclusion still stands:
- rewritten context assembly remains materially leaner than old baseline
- the strongest stability points remain feature ownership, selection-bounded reasoning, and continuity
- no evidence from this repeat pass suggests regression relative to the earlier new-runtime captures

## Relationship to prior conclusion
This repeat pass supports the conclusion in:
- `plans/benchmarks/context-benchmark-conclusion.md`

It should be interpreted as a repeatability/stability layer, not as a replacement for the original old/new matrix.
