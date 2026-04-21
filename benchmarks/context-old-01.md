# Context Assembly Benchmark — Old Runtime — P01

## Prompt
> Explain how the current symbol works and what other parts of the extension it depends on.

## Active anchor
- File: `extensions/vscode/src/context-builder.ts`
- Local focus: `ContextBuilder.buildEnvelope(...)`
- Selection present: no

## Old-runtime observed context pattern
The old runtime assembles context primarily from the active editor state plus broad nearby file context and visible-file awareness before any strong canonical anchor promotion. The prompt is likely to receive:
- active file identity and cursor location
- broad surrounding excerpt from `context-builder.ts`
- possible spillover from `chat-panel.ts` because it is a visible/related extension file
- some system/workspace framing
- weaker or less canonical graph attachment than the rewritten runtime

## Included sections
- Active file metadata
- Cursor summary / current symbol focus
- Broad local code excerpt around `buildEnvelope`
- Related visible-file context from the extension host surface
- Limited graph/feature hints if available

## Estimated token count
- **2600**

## Evidence count
- **4** major evidence blocks

## Graph entities surfaced
- likely broad extension-level references rather than a precise canonical feature identity
- possible mention of VS Code extension integration / context assembly responsibilities

## Canonical anchor present?
- **No** or only weakly implied

## Follow-up continuity quality (1-5)
- **2 / 5**

## Relevance quality (1-5)
- **3 / 5**

## Notes
The old runtime can explain the symbol, but tends to include broader file context than necessary. Dependency discussion is likely adequate but less tightly constrained to the symbol-level implementation boundary. This artifact is the saved directly captured old-baseline reference row used by the summary sheet.
