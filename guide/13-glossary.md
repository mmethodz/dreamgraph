# 13. Glossary

Plain-language definitions of every DreamGraph-specific term in this guide.

---

**ADR (Architecture Decision Record).** A recorded choice with rationale. Stored in `adr_log.json`. Can be `proposed`, `accepted`, `deprecated`, or `superseded`. Linked to entities and tagged for searchability.

**Architect.** The chat panel inside the VS Code extension. An AI agent wired to every DreamGraph MCP tool plus a set of VS Code-local tools.

**AWAKE.** The default cognitive state. Graph is stable and queryable.

**Candidate edge.** A speculative edge proposed by a dream cycle. Lives in `candidate_edges.json`. Either gets promoted to `validated_edges.json`, kept as latent, or rejected.

**Cognitive engine.** The loop that generates dreams, scores them, and updates the graph. Operates as a five-state machine (AWAKE / REM / NORMALIZING / NIGHTMARE / LUCID).

**Confidence.** A 0-to-1 score the engine attaches to a dream. One of five gates the truth filter checks before promotion.

**Contradiction (score).** Measure of how much a dream conflicts with existing validated edges. Promotion requires contradiction ≤ 0.3.

**Curate (`dg curate`).** Quality pass that trims duplicates and merges near-equivalent entities. Also: the user activity of promoting/rejecting candidates and resolving tensions.

**Daemon.** The long-running DreamGraph process. One per instance. Exposes MCP tools over stdio or HTTP.

**Dashboard.** The read-only summary view in the VS Code extension. Counts, state, recent events.

**Data model.** The graph layer that tracks entities, fields, and relationships in your system. Stored in `data_model.json`.

**Decay.** Per-cycle reduction of TTL and confidence on unreinforced dreams. Dreams expire at TTL=0 or confidence<0.35.

**Dream.** A speculative graph element (usually an edge, sometimes a node or tension) generated during a cycle.

**Dream cycle.** One pass of the cognitive loop: generate dreams → normalize → write outcomes → decay → return.

**Dream graph.** The speculative-only graph, separate from the validated fact graph. Stored in `dream_graph.json`.

**Dreamer.** The role/LLM responsible for generating dreams. Configured separately from the Normalizer; benefits from higher temperature.

**Etag.** Versioning marker for graph snapshots. The Explorer uses etags so you can't act on stale data — mutations against an old etag get a 409 Conflict.

**Evidence (count and score).** How many independent sources support a dream. Promotion requires evidence_count ≥ 2 and evidence score ≥ 0.40.

**Explorer.** The interactive graph view. Available in the VS Code extension and at `http://localhost:<port>/explorer/`.

**Fact graph.** The trusted, validated knowledge layer. Sum of features, workflows, data model, UI registry, ADRs, and validated edges.

**Federation.** Cross-instance pattern sharing via `export_dream_archetypes` / `import_dream_archetypes`.

**Feature.** A unit of "what the codebase does." Stored in `features.json`. Has source files, descriptions, capability links.

**Fork (`dg fork`).** Copy an instance to a new UUID. Useful for experimentation.

**Instance.** One DreamGraph brain. Owns a graph, a config, a daemon process, and one or more attached repos. Lives at `~/.dreamgraph/<uuid>/`.

**Latent.** A candidate edge that wasn't strong enough to validate but plausible enough to keep around. Default healthy state for most candidates.

**Lucid (state).** Human-driven exploration mode. You ask "what if?", the engine generates speculative edges interactively.

**MCP (Model Context Protocol).** The protocol DreamGraph uses to expose tools to AI agents. Both stdio and HTTP transports supported.

**Mutation.** A graph-changing action initiated by a user or agent (promote candidate, reject, resolve tension, record ADR, etc.). Always requires a one-line reason and is logged.

**Nightmare cycle.** Adversarial security scan. Runs five strategies (privilege escalation, data leak path, injection surface, missing validation, broken access control). High/critical findings become tensions.

**Normalize / Normalizer.** The role/LLM that scores dreams and decides their fate (validated / latent / rejected). Configured separately from the Dreamer; benefits from low temperature.

**Plausibility.** A 0-to-1 score for whether a dream's entities exist and the relationship makes structural sense. Promotion requires ≥ 0.45.

**Policy profile.** Cognitive engine appetite preset: `strict`, `balanced` (default), or `creative`. Set at `dg init` or via `instance.json`.

**Promotion.** Moving a candidate edge from speculation into the validated fact graph.

**Reinforcement memory.** State that survives 30 cycles past a dream's death. If the same dream re-emerges, it inherits accumulated reinforcement and skips the slow start.

**REM.** The dream-generation phase of the cognitive cycle. Strategies run here.

**Scan (`dg scan`).** Initial walk of an attached repo to seed the graph with features, source files, API surface, data-model hints, and UI elements.

**Snapshot.** A coherent point-in-time read of the graph, identified by an etag. The Explorer fetches snapshots; mutations are checked against the snapshot's etag.

**Stale candidate.** A candidate whose underlying dream node/edge has been pruned. Hidden from the actionable list (with a count shown). Cannot be promoted/rejected meaningfully.

**Strategy.** A named dream-generation algorithm. Examples: `gap_detection`, `tension_directed`, `llm_dream`, `cross_domain`, `missing_abstraction`. `all` runs the full set with adaptive budgeting.

**Tension.** A durable record that something is unresolved (a contradiction, a missing abstraction, ambiguous ownership, a security risk). Lives in `tension_log.json`. Capped at 200 active.

**Truth filter.** The five-gate check the Normalizer runs against each dream: confidence ≥ 0.62, plausibility ≥ 0.45, evidence ≥ 0.40, evidence_count ≥ 2, contradiction ≤ 0.3.

**TTL (Time-to-Live).** Per-dream counter. Starts at 8, decreases by 1 each cycle. At 0, the dream expires.

**UI registry.** Graph layer tracking UI components and routes. Stored in `ui_registry.json`.

**Validated edge.** A trusted, promoted edge in the fact graph. Stored in `validated_edges.json`.

**Workflow.** An end-to-end flow through your system (login, checkout, ingest, etc.). Stored in `workflows.json`. Can span multiple features and repos.

---

That's the vocabulary. If a term in any other guide page isn't defined here, it's probably defined in [docs/cognitive-engine.md](../docs/cognitive-engine.md) or [docs/data-model.md](../docs/data-model.md).
