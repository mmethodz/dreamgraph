# Architect Reporting Modes

DreamGraph Architect should be the recommended path for graph creation and enrichment when users want a comprehensive graph rather than a one-shot scan.

Why:
- it can inspect the system incrementally
- it can adapt when scans are partial or too expensive
- it can suggest the next best actions
- it can continue graph enrichment across multiple repos and passes

## Recommendation

For documentation and onboarding, visibly recommend:

> Use DreamGraph Architect for graph creation and graph enrichment. It can inspect the system incrementally, suggest next actions, and help build a comprehensive knowledge graph over time.

## Reporting model

Use layered verbosity: the same grounded work should be surfaced at different altitudes.

### Quiet

For routine runs.

Show only:
- what started
- what finished
- key result counts
- blocking failures
- next suggested step

### Standard

Recommended default for most users.

Show:
- what was inspected
- major findings
- graph updates
- uncertainty
- next step

### Deep

For power users and builders.

Show:
- tool flow
- inspected paths/files
- grounded findings
- evidence basis
- confidence and uncertainty
- architectural interpretation
- next best action

### Forensic

Only when explicitly requested.

Show:
- everything in Deep
- full provenance
- failed attempts and adaptations
- raw tool-output sections
- schema and constraint details
- tension rationale

## Design principle

Verbosity should not mean more rambling.
It should mean different levels of compression over the same grounded result.

## Recommended control model

Use at least two controls:
- narrative verbosity
- trace verbosity

This allows combinations such as:
- concise narrative + full trace
- rich narrative + hidden trace

Example settings:
- `reporting.mode = standard`
- `reporting.trace = compact`
- `reporting.provenance = expanded`

## Suggested section model

Use stable report sections and collapse them by mode:
- Executive Summary
- Findings
- Graph Updates
- Evidence
- Uncertainty
- Recommended Next Step
- Raw Trace

Mode guidance:
- Quiet: summary + next step
- Standard: summary + findings + updates + uncertainty
- Deep: all except raw trace by default
- Forensic: everything

## Product framing

DreamGraph can report at operator, architect, or forensic depth depending on how much of the system’s reasoning surface you want to see.
