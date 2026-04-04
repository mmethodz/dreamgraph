# DreamGraph Tools Reference

> Complete catalog of all 37 MCP tools (17 cognitive + 20 general).

---

## Cognitive Tools (17)

Registered in [src/cognitive/register.ts](../src/cognitive/register.ts). These operate the dream engine itself.

### Core Cycle

#### `dream_cycle`

Trigger a full AWAKE → REM → NORMALIZING → AWAKE cycle. Generates speculative edges, decays stale dreams, deduplicates, normalizes via three-outcome classifier, promotes passing edges, creates tensions for near-miss rejections, and auto-resolves tensions addressed by promotions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `strategy` | enum | `"all"` | `gap_detection`, `weak_reinforcement`, `cross_domain`, `missing_abstraction`, `symmetry_completion`, `tension_directed`, `causal_replay`, `reflective`, `all` |
| `max_dreams` | number (1–100) | 20 | Maximum dream items to generate |
| `auto_normalize` | boolean | true | Run normalization after dreaming |

**Post-cycle hooks (v5.1):** `maybeAutoNarrate()` — generates a chapter every 10 cycles; `checkTensionThresholds()` — dispatches event if tension count exceeds limit.

#### `normalize_dreams`

Manually run normalization on existing dream graph.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | number (0–1) | 0.75 | Minimum confidence for validation |
| `strict` | boolean | false | If true, reject latent items too |

#### `nightmare_cycle`

Adversarial security scan: AWAKE → NIGHTMARE → AWAKE.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `strategy` | enum | `"all"` | `privilege_escalation`, `data_leak_path`, `injection_surface`, `missing_validation`, `broken_access_control`, `all` |

---

### Introspection

#### `cognitive_status`

Current state, cycle counts, graph stats, validation metrics, tension stats, promotion config. No parameters.

#### `get_dream_insights`

Strongest hypotheses, entity clusters, expiring dreams, active tensions, health assessment.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `top_n` | number (1–50) | 10 | Items per section |

#### `query_dreams`

Search/filter dream nodes, edges, and validated edges.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `type` | enum | `"all"` | `node`, `edge`, `all` |
| `domain` | string | — | Filter by domain tag |
| `min_confidence` | number (0–1) | 0 | Confidence floor |
| `status` | enum | — | `candidate`, `latent`, `validated`, `rejected`, `expired`, `raw` |

---

### Tension Management

#### `resolve_tension`

Close a tension with explicit authority and evidence.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tension_id` | string | yes | Tension ID |
| `resolved_by` | enum | yes | `human` or `system` |
| `resolution_type` | enum | yes | `confirmed_fixed`, `false_positive`, `wont_fix` |
| `evidence` | string | no | Supporting evidence |
| `recheck_ttl` | number (1–100) | no | Cycles before potential reactivation |

---

### Analysis

#### `get_causal_insights`

Causal chain discovery via BFS — cause→effect relationships, propagation hotspots, predicted impacts. No parameters.

#### `get_temporal_insights`

Temporal pattern analysis — tension trajectories, predictions, seasonal patterns, retrocognitive matches. No parameters.

#### `get_system_narrative`

System autobiography at three depth levels.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `depth` | enum | `"technical"` | `executive` (1-page), `technical` (detailed), `full` (cycle-by-cycle) |

#### `get_remediation_plan`

Concrete fix plans from high-urgency tensions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_plans` | number (1–20) | 5 | Plans to generate |
| `min_urgency` | number (0–1) | 0.3 | Urgency threshold |

---

### Federation

#### `export_dream_archetypes`

Extract anonymized patterns from validated edges for cross-project sharing. No parameters.

#### `import_dream_archetypes`

Import archetypes from another DreamGraph instance.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file_path` | string | yes | Path to archetype JSON file |

---

### v5.1 Capabilities

#### `metacognitive_analysis`

Self-tuning analysis: per-strategy precision/recall, calibration buckets, domain decay profiles.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `window_size` | number (5–500) | 50 | Recent cycles to analyze |
| `auto_apply` | boolean | false | Apply recommended thresholds (in-memory, resets on restart) |

#### `dispatch_cognitive_event`

Dispatch reactive event that may trigger scoped dream cycle.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | enum | yes | `git_webhook`, `ci_cd`, `runtime_anomaly`, `tension_threshold`, `federation_import`, `manual` |
| `severity` | enum | yes | `critical`, `high`, `medium`, `low`, `info` |
| `description` | string | yes | Event description |
| `affected_entities` | string[] | no | Scoping entities |
| `payload` | object | no | Arbitrary data |

#### `get_system_story`

Read the persistent auto-accumulated narrative.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `last_n_chapters` | number (1–100) | all | Recent chapters only |
| `digest_only` | boolean | false | Weekly digests only |

---

### Safety

#### `clear_dreams`

Reset cognitive data. Requires confirmation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | enum | yes | `dream_graph`, `candidates`, `validated`, `tensions`, `history`, `all` |
| `confirm` | boolean | yes | Must be `true` |

---

## General Tools (20)

Registered in [src/tools/register.ts](../src/tools/register.ts). These provide I/O, visualization, and documentation capabilities.

### Code Senses

#### `read_source_code`

Read file contents, optionally by line range.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | yes | Relative or absolute path |
| `repo` | string | no | Repo name from `DREAMGRAPH_REPOS` |
| `startLine` | number | no | Start line (1-based) |
| `endLine` | number | no | End line (inclusive) |

#### `list_directory`

List files and folders at a path.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dirPath` | string | yes | Directory path |
| `repo` | string | no | Repo name |

#### `create_file`

Create or overwrite a file. Auto-creates parent directories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | yes | File path |
| `content` | string | yes | File content |
| `repo` | string | no | Repo name |

---

### Git Senses

#### `git_log`

Commit history with rename tracking.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repo` | string | — | **Required.** Repo name |
| `path` | string | — | File/dir path (omit for full repo) |
| `maxCount` | number (1–100) | 20 | Max commits |
| `follow` | boolean | true | Track renames |

#### `git_blame`

Per-line authorship.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo` | string | yes | Repo name |
| `filePath` | string | yes | File path |
| `startLine` | number | no | Start line |
| `endLine` | number | no | End line |

---

### DB Senses

#### `query_db_schema`

PostgreSQL schema introspection (read-only). Requires `DATABASE_URL`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query_type` | enum | yes | `columns`, `constraints`, `indexes`, `check_constraints`, `foreign_keys`, `rls_policies` |
| `table_name` | string | yes | Table name |
| `schema` | string | no | Schema (default: `public`) |

---

### Web Senses

#### `fetch_web_page`

Fetch URL, clean HTML, return Markdown.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | — | **Required.** HTTP(S) URL |
| `selector` | string | — | CSS selector to narrow content |
| `maxLength` | number (500–100000) | 30000 | Max chars returned |

---

### Runtime Senses

#### `query_runtime_metrics`

Live observability metrics. Requires `DREAMGRAPH_RUNTIME_ENDPOINT`.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `entity_filter` | string | — | Specific entity ID |
| `include_correlations` | boolean | true | Behavioral correlation analysis |

---

### Knowledge Tools

#### `get_workflow`

Retrieve a workflow by ID with step-by-step details.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Workflow ID |

#### `search_data_model`

Search for a data model entity by name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity` | string | yes | Entity ID |

#### `query_resource`

Generic URI-based resource query.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `uri` | string | yes | `system://features`, `system://workflows`, `system://data-model`, `dream://graph`, etc. |
| `filter` | object | no | Key/value filter |

---

### Insight Injection

#### `solidify_cognitive_insight`

Write a subjective AI insight into cognitive memory. Enters normal decay → normalize → promote pipeline.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `insightType` | enum | yes | `EDGE`, `TENSION`, `ENTITY` |
| `sourceNodeId` | string | yes | Source entity ID |
| `targetNodeId` | string | conditional | Required for EDGE |
| `relation` | string | no | Relation name (EDGE) |
| `rationale` | string | yes | Explanation |
| `confidence` | number (0–1) | yes | Confidence level |
| `codeReferences` | string[] | no | File paths/lines |
| `tensionLevel` | enum | no | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (TENSION only) |
| `entityName` | string | no | Name (ENTITY only) |
| `entityDescription` | string | no | Description (ENTITY only) |

---

### Visual Architect

#### `generate_visual_flow`

Generate Mermaid.js diagrams from the knowledge graph.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target_type` | enum | — | **Required.** `workflow`, `feature_deps`, `data_flow`, `tension_map`, `domain_overview`, `ui_composition` |
| `target_ids` | string[] | — | **Required.** Center entity IDs |
| `depth` | number | 2 | Hops outward |
| `direction` | enum | `TB` | `TB`, `LR`, `BT`, `RL` |
| `include_dreams` | boolean | false | Speculative edges (dashed) |
| `include_tensions` | boolean | false | Highlight tensioned entities |
| `max_nodes` | number | 40 | Auto-simplify threshold |

---

### ADR Historian

#### `record_architecture_decision`

Record an Architecture Decision Record.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Title |
| `decided_by` | enum | yes | `human`, `system`, `collaborative` |
| `problem` | string | yes | Problem statement |
| `constraints` | string[] | yes | Design constraints |
| `affected_entities` | string[] | yes | Affected entity IDs |
| `related_tensions` | string[] | no | Related tension IDs |
| `chosen` | string | yes | Decision made |
| `alternatives` | array | no | `{option, rejected_because}` |
| `expected_consequences` | string[] | yes | Expected outcomes |
| `risks` | string[] | yes | Accepted risks |
| `guard_rails` | string[] | yes | Change triggers |
| `tags` | string[] | no | Tags |

#### `query_architecture_decisions`

Search ADRs by entity, tag, status, or text. Includes guard rail checks.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity_id` | string | no | Filter by entity |
| `tag` | string | no | Filter by tag |
| `status` | enum | no | `accepted`, `deprecated`, `superseded` |
| `search` | string | no | Free text search |
| `guard_check_entity_id` | string | no | Guard rail check entity |
| `guard_check_proposed_change` | string | no | Proposed change to check |

#### `deprecate_architecture_decision`

Retire an ADR.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `adr_id` | string | yes | ADR ID |
| `new_status` | enum | yes | `deprecated`, `superseded` |
| `superseded_by` | string | no | Replacement ADR |
| `reason` | string | yes | Reason |

---

### UI Registry

#### `register_ui_element`

Register a semantic UI element (platform-independent).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Unique ID |
| `name` | string | yes | Display name |
| `purpose` | string | yes | What it does |
| `category` | enum | yes | `data_display`, `data_input`, `navigation`, `feedback`, `layout`, `action`, `composite` |
| `inputs` | array | yes | `{name, type, description, required}` |
| `outputs` | array | yes | `{name, type, description, trigger}` |
| `interactions` | array | yes | `{action, description}` |
| `children` | string[] | no | Child element IDs |
| `implementations` | array | no | `{platform, component, source_file?, notes?}` |
| `used_by` | string[] | no | Feature IDs |
| `tags` | string[] | no | Tags |

#### `query_ui_elements`

Search the UI registry.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | enum | no | Category filter |
| `purpose_search` | string | no | Purpose text search |
| `platform` | string | no | Platform filter |
| `feature_id` | string | no | Feature filter |
| `missing_platform` | string | no | Migration gap check |

#### `generate_ui_migration_plan`

Platform migration plan with gap analysis.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_platform` | string | yes | Source platform |
| `target_platform` | string | yes | Target platform |
| `scope` | string[] | no | Limit to feature IDs |

---

### Living Docs

#### `export_living_docs`

Export knowledge graph as structured Markdown for documentation sites.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `output_dir` | string | yes | Output directory |
| `sections` | enum[] | yes | `features`, `data_model`, `workflows`, `architecture`, `ui_registry`, `cognitive_status`, `api_reference`, `all` |
| `format` | enum | no | `docusaurus`, `nextra`, `mkdocs`, `plain` (default) |
| `include_diagrams` | boolean | no | Mermaid inline (default: true) |
| `include_cognitive` | boolean | no | Cognitive status (default: false) |

---

## MCP Resources (13)

| URI | Description |
|-----|-------------|
| `dream://graph` | Raw dream graph (speculative nodes + edges) |
| `dream://candidates` | Normalization judgments (three-outcome) |
| `dream://validated` | Promoted edges (trusted) |
| `dream://status` | Cognitive state introspection |
| `dream://tensions` | Active + resolved tensions |
| `dream://history` | Full cycle audit trail |
| `dream://adrs` | Architecture Decision Records |
| `dream://ui-registry` | Semantic UI elements |
| `dream://threats` | Adversarial scan results |
| `dream://archetypes` | Federation archetypes |
| `dream://metacognition` | Self-tuning audit log (v5.1) |
| `dream://events` | Cognitive event log (v5.1) |
| `dream://story` | Persistent system autobiography (v5.1) |

System resources (read via `query_resource`):

| URI | Description |
|-----|-------------|
| `system://features` | All features from fact graph |
| `system://workflows` | All workflows |
| `system://data-model` | All data entities |
| `system://capabilities` | Server capabilities & strategies |
