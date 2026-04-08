# DreamGraph Tools Reference

> Complete catalog of all 57 MCP tools (23 cognitive + 25 general + 9 discipline) and 23 MCP resources.

---

## Cognitive Tools (23)

Registered in [src/cognitive/register.ts](../src/cognitive/register.ts). These operate the dream engine itself.

### Core Cycle

#### `dream_cycle`

Trigger a full AWAKE → REM → NORMALIZING → AWAKE cycle. Generates speculative edges, decays stale dreams, deduplicates, normalizes via three-outcome classifier, promotes passing edges, creates tensions for near-miss rejections, and auto-resolves tensions addressed by promotions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `strategy` | enum | `"all"` | `llm_dream`, `pgo_wave`, `gap_detection`, `weak_reinforcement`, `cross_domain`, `missing_abstraction`, `symmetry_completion`, `tension_directed`, `causal_replay`, `reflective`, `all` |
| `max_dreams` | number (1–500) | 100 | Maximum dream items to generate |
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

### v5.2 Dream Scheduling

#### `schedule_dream`

Create a scheduled cognitive action with a trigger policy.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | enum | yes | — | `dream_cycle`, `nightmare_cycle`, `normalize_dreams`, `metacognitive_analysis`, `get_causal_insights`, `get_temporal_insights`, `export_dream_archetypes` |
| `trigger_type` | enum | yes | — | `interval`, `cron_like`, `after_cycles`, `on_idle` |
| `label` | string | no | auto-generated | Human-readable schedule name |
| `strategy` | string | no | `"all"` | Dream strategy (for `dream_cycle` action) |
| `max_dreams` | number | no | 15 | Max edges per cycle (for `dream_cycle` action) |
| `interval_seconds` | number | no | — | Seconds between runs (for `interval` trigger) |
| `cron_hour` | number | no | — | Hour (0–23) for `cron_like` trigger |
| `cron_minute` | number | no | 0 | Minute (0–59) for `cron_like` trigger |
| `cron_days` | number[] | no | [0–6] | Days of week (0=Sun) for `cron_like` trigger |
| `after_every_n_cycles` | number | no | — | Fire after N cycles (for `after_cycles` trigger) |
| `idle_seconds` | number | no | — | Seconds of inactivity (for `on_idle` trigger) |
| `max_runs` | number | no | unlimited | Total executions before auto-disable |
| `enabled` | boolean | no | true | Whether the schedule is active |

#### `list_schedules`

List all schedules with status and execution summary. No parameters.

#### `update_schedule`

Modify an existing schedule's trigger, action parameters, or enabled state.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schedule_id` | string | yes | Schedule ID to update |
| `enabled` | boolean | no | Enable/disable |
| `label` | string | no | New label |
| `strategy` | string | no | New dream strategy |
| `max_dreams` | number | no | New max dreams |
| `interval_seconds` | number | no | New interval |
| `max_runs` | number | no | New max runs |

#### `run_schedule_now`

Immediately execute a schedule, bypassing its trigger condition.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schedule_id` | string | yes | Schedule ID to execute |

#### `delete_schedule`

Permanently remove a schedule.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schedule_id` | string | yes | Schedule ID to delete |

#### `get_schedule_history`

Retrieve execution history for a schedule or all schedules.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `schedule_id` | string | no | — | Filter by schedule ID |
| `last_n` | number | no | 20 | Most recent N executions |

---

## General Tools (25)

Registered in [src/tools/register.ts](../src/tools/register.ts). These provide I/O, visualization, documentation, and operational knowledge capabilities.

### Code Senses

#### `read_source_code`

Read file contents, optionally by line range.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filePath` | string | yes | Relative or absolute path |
| `repo` | string | no | Repo name from `DREAMGRAPH_REPOS` or instance-mapped repos |
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

#### `init_graph`

Bootstrap the fact graph by scanning configured project repositories. Discovers features, workflows, and data model entities from source code and populates the seed data files. Run once for a new project, or when the fact graph is empty.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `repos` | string[] | all configured | Specific repo names to scan (from `DREAMGRAPH_REPOS` config). If omitted, scans all. |
| `force` | boolean | false | If true, overwrites existing seed data. If false, skips if features.json already has real entries. |

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

### Seed Data Enrichment

#### `enrich_seed_data`

Feed curated knowledge into the fact graph. The LLM reads source code (via code senses) and calls this tool to push structured entity data to the server. The server validates structure, merges by ID (upsert) or replaces entirely, strips template stubs, and rebuilds the resource index.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | enum | — | **Required.** `features`, `workflows`, `data_model` |
| `entries` | array | — | **Required.** Array of entity objects (min 1). Each must have `id` and `name`. Structure depends on target. |
| `mode` | enum | `merge` | `merge`: upsert by ID — preserves existing, updates matching, appends new. `replace`: wipe existing and write only incoming entries. |

**Merge mode** (default): Existing entries are preserved. Entries with matching IDs are updated. New IDs are appended.

**Replace mode**: All existing data is discarded. Only the validated incoming entries are written. Use when you have a complete, authoritative view and want to clean out stale `init_graph` data.

Both modes auto-strip template stubs (`_schema`, `_fields`, `_note` entries), invalidate cache, and rebuild `index.json`.

#### `scan_project`

Automated project scan with LLM enrichment. Scans the project directory structure, reads key source files, then uses the configured dreamer LLM to generate rich semantic entries for features, workflows, and data model entities. Non-destructive — always uses merge mode. Falls back to structural-only analysis if no LLM is configured.

This is a convenience orchestrator. All individual tools (`init_graph`, `enrich_seed_data`, `register_ui_element`) remain available for manual or targeted enrichment.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `depth` | enum | `deep` | `shallow` (3 levels) or `deep` (10 levels). Shallow is faster but may miss nested modules. |
| `targets` | string[] | all three | Subset of `["features", "workflows", "data_model"]` to populate. |
| `repos` | string[] | all configured | Specific repo names to scan. |

**Returns:** Summary with counts for repos scanned, files discovered, UI files detected, technology detected, features/workflows/data_model inserted/updated/total, index entries rebuilt, LLM tokens used, and any warnings.

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

---

### Operational Knowledge (API Surface)

#### `extract_api_surface`

Extract programmatic API surface from source files and store it as operational knowledge. Regex-based (~90% accuracy). Supports Python, TypeScript, JavaScript, C#. Use when onboarding a repo, after major code changes, or before validation if no API surface exists yet.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | — | **Required.** File or directory path relative to repo root |
| `language` | enum | `"auto"` | `auto`, `python`, `typescript`, `javascript`, `csharp` |
| `scope` | enum | `"public"` | `public` (exported only) or `all` (all detectable members) |
| `incremental` | boolean | `true` | Only re-extract changed files (compares mtime). Set `false` to force full rescan |
| `platform` | string | — | Optional platform tag (e.g., `python-port`, `web`) |

#### `query_api_surface`

Return the exact callable/programmatic surface for a class, function, or module. Use before writing code that calls methods or accesses properties. Supports inheritance resolution with `defined_in` annotations. **Automatically aggregates C# partial classes** — when a class like `GUI` is split across 25 files, the query merges all fragments and returns the full method set with `defined_in` showing each method's source file. The response includes `is_partial_aggregate: true` and `file_paths: [...]` for partial classes.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `symbol_name` | string | — | **Required.** Class, function, or module name (e.g., `UIStack`, `CognitiveEngine`) |
| `symbol_kind` | enum | `"auto"` | `auto`, `class`, `function`, `module` |
| `member_name` | string | — | Filter to one specific method or property |
| `file_path` | string | — | Restrict results to members defined in this file (substring match). Useful for partial classes spanning many files |
| `include_inherited` | boolean | `true` | Include inherited members with `defined_in` origin annotation |
| `detail_level` | enum | `"full"` | `summary`, `signatures_only`, `full` |
| `platform` | string | — | Platform filter (e.g., `python-port`) |
| `language` | enum | `"any"` | Language filter: `any`, `python`, `typescript`, `javascript`, `csharp` |

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

## Discipline Execution Tools (9)

Registered in [src/discipline/tools.ts](../src/discipline/tools.ts). These enforce the five-phase execution model (ADR-014).

### `discipline_start_session`

Start a new disciplinary task session, entering the INGEST phase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | enum | yes | `audit`, `port`, `reconstruction`, `modification` |
| `description` | string | yes | What this task is about |
| `target_scope` | string[] | yes | File paths or directories in scope |
| `requires_ground_truth` | boolean | no | All claims need tool evidence (default: true) |

### `discipline_transition`

Transition the active session to a new phase with guard checks.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target_phase` | enum | yes | `ingest`, `audit`, `plan`, `execute`, `verify` |
| `justification` | string | no | Why this transition is appropriate (required for loopbacks) |

### `discipline_check_tool`

Check whether a specific tool call is permitted in the current discipline phase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tool_name` | string | yes | Name of the MCP tool to check |
| `target_file` | string | no | Target file path (for write tools — validates data protection) |

### `discipline_get_session`

Get the current discipline session state, list sessions, or load a specific one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `session_id` | string | no | Specific session ID to load |
| `list_all` | boolean | no | List all sessions |
| `include_prompt` | boolean | no | Include current system prompt in response |

### `discipline_record_delta`

Submit delta table entries during AUDIT or VERIFY phase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entries` | DeltaEntry[] | yes | Delta entries comparing source-of-truth vs implementation |
| `sources` | SourceReference[] | yes | Sources of truth that were queried |
| `phase` | enum | no | Override phase (`audit` or `verify`) |

### `discipline_submit_plan`

Submit a structured implementation plan during PLAN phase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | yes | Overall plan description |
| `items` | PlanItem[] | yes | Plan items, each addressing a delta table entry |
| `auto_approve` | boolean | no | Auto-approve the plan (default: false) |

### `discipline_approve_plan`

Approve a draft implementation plan.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `plan_index` | number | no | Index of plan to approve (default: latest) |

### `discipline_verify`

Generate a verification report during VERIFY phase.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `post_delta_entries` | DeltaEntry[] | yes | Post-execution delta entries from re-audit |
| `post_delta_sources` | SourceReference[] | yes | Sources queried during verification |
| `item_results` | ItemVerification[] | yes | Per-plan-item verification results |

### `discipline_complete_session`

Complete or abandon the active discipline session.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | enum | yes | `completed`, `failed`, `abandoned` |

---

## MCP Resources (23)

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
| `dream://schedules` | Active dream schedules with status (v5.2) |
| `dream://schedule-history` | Schedule execution history (v5.2) |
| `discipline://manifest` | Tool classifications, phase permissions, data protection rules (v6.0 La Catedral) |

Operational resources (registered via [src/tools/api-surface.ts](../src/tools/api-surface.ts)):

| URI | Description |
|-----|-------------|
| `ops://api-surface` | Full cached API surface extracted from source files — classes, functions, methods, properties with signatures. Read-only. Populated by `extract_api_surface`, queried by `query_api_surface` |

System resources (registered in [src/resources/register.ts](../src/resources/register.ts)):

| URI | Description |
|-----|-------------|
| `system://overview` | High-level system overview (repos, tech stacks, purpose) |
| `system://features` | All features from fact graph |
| `system://workflows` | All operational workflows |
| `system://data-model` | Entity definitions and relationships |
| `system://capabilities` | Server capabilities, strategies & available tools |
| `system://index` | Central entity index for fast lookup and cross-resource linking |
