# Context Assembly Benchmark — Old Runtime — P08

## Prompt
> Focus only on the selected code and explain the risk in changing it.

## Active anchor
- File: `extensions/vscode/src/context-builder.ts`
- Local focus: selected snippet within `buildEnvelope(...)`
- Selection present: yes

## Old-runtime observed context pattern
Even with a selection, the old runtime is likely to include more surrounding symbol/file context than strictly necessary. It recognizes the selection, but selection-boundedness is weaker than in the rewritten builder.

## Included sections
- Active file metadata
- Selection text / selected-region summary
- Additional surrounding code excerpt beyond the selection
- Possible related extension references

## Estimated token count
- **1800**

## Evidence count
- **4** major evidence blocks

## Graph entities surfaced
- minimal or generic extension-level linkage

## Canonical anchor present?
- **No**

## Follow-up continuity quality (1-5)
- **2 / 5**

## Relevance quality (1-5)
- **3 / 5**

## Notes
Selection-specific reasoning is possible, but the old runtime does not enforce as sharp a boundary around the selected code, so irrelevant nearby context is more likely to leak in.
