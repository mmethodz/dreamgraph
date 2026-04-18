# Graph Operations: Enrich and Curate

DreamGraph graph work naturally separates into two operator goals:

- **Enrich** — expand graph coverage
- **Curate** — improve graph signal quality

This distinction should be visible in product language, documentation, and future command design.

## Recommended practice

For graph creation and multi-pass knowledge capture, use **DreamGraph Architect**.

Why:
- it can continue when scans are partial or expensive
- it can suggest the next best enrichment step
- it can build a comprehensive graph incrementally across repos
- it can adapt between structural evidence and deeper semantic extraction

Recommended wording:

> Use DreamGraph Architect for graph creation and graph enrichment. It can inspect the system incrementally, suggest next actions, and help build a comprehensive knowledge graph over time.

## Enrich

**Enrich grows the graph.**

Use enrich when the main problem is missing coverage.

Typical enrich actions:
- scan new repos
- discover features, workflows, data model entities, capabilities
- add cross-repo references
- attach source anchors
- continue partial scan fallback with targeted enrichment

Typical outcomes:
- more known entities
- broader workflow coverage
- stronger cross-repo/system modeling

## Curate

**Curate sharpens the graph.**

Use curate when the main problem is graph noise, duplication, ambiguity, or drift.

Typical curate actions:
- supersede duplicates
- deprecate stale or junk entities
- merge aliases
- rank canonical entities
- archive weak ADRs
- collapse noisy hubs
- reduce contradictory or low-value relationships

Typical outcomes:
- higher trust in the graph
- lower noise in explanations
- clearer canonical ownership and boundaries
- better long-term graph maintainability

## Command direction

Recommended first-class product commands:

- `dg enrich`
- `dg curate`

Initial framing:

### `dg enrich`
Expand graph coverage by discovering and linking missing features, workflows, repositories, and data model elements.

### `dg curate`
Improve graph quality by consolidating duplicates, promoting canonical entities, deprecating stale knowledge, and reducing noise.

## Suggested rollout

### Phase 1 — documentation and recommendation
- document enrich vs curate as separate user intents
- recommend Architect for graph creation and multi-pass enrichment
- let Architect suggest the next best action: enrich or curate

### Phase 2 — CLI aliases or commands
- add `dg enrich` as a graph coverage operation
- add `dg curate` as a graph quality operation
- keep `dg scan` as the lower-level mechanical scan entry point

### Phase 3 — structured curation workflows
Potential future options:
- `dg enrich --repos`
- `dg enrich --workflows`
- `dg curate --dedupe`
- `dg curate --adrs`
- `dg curate --relationships`

## UX guidance

Default behavior should differ by operation:

- **enrich**: optimize for breadth and next-step suggestions
- **curate**: optimize for trust, canonicalization, and safe change review

For curation, prefer:
- safe automatic changes where confidence is high
- staged suggestions for destructive merges or archival actions
- explicit summary of what changed and why

## Product framing

A concise framing that works well:

> Enrich grows the graph. Curate sharpens it.
