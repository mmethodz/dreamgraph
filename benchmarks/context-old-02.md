# Context Assembly Benchmark — Old Runtime — P02

## Prompt
> Make the current context assembly logic more precise and explain what evidence you used.

## Active anchor
- File: `extensions/vscode/src/context-builder.ts`
- Local focus: `ContextBuilder.buildEnvelope(...)` and nearby planning/budget logic
- Selection present: no

## Old-runtime observed context pattern
For a modification-oriented prompt, the old runtime is likely to include a fairly broad excerpt from the active file, plus adjacent orchestration code to compensate for uncertainty. Evidence provenance is possible, but the context itself is less tightly curated than in the rewritten builder.

## Included sections
- Active file metadata
- Cursor/current-symbol summary
- Broad excerpt from `context-builder.ts`
- Potential related panel/orchestration references from `chat-panel.ts`
- Limited graph hints where available

## Estimated token count
- **2500**

## Evidence count
- **4** major evidence blocks

## Graph entities surfaced
- broad VS Code extension / context assembly references
- possible mention of assisted reasoning integration, but not strongly canonicalized

## Canonical anchor present?
- **No**

## Follow-up continuity quality (1-5)
- **2 / 5**

## Relevance quality (1-5)
- **3 / 5**

## Notes
The old runtime likely provides enough local code to support a targeted change, but with extra nearby implementation context. Evidence explanation is possible, though not as sharply separated into focused provenance blocks as in the new runtime.
