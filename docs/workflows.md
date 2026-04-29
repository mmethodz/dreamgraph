# DreamGraph Workflows

> Step-by-step flows for all 15 operational processes.

---

## 1. Dream Cycle (`dream_cycle_flow`)

**The core cognitive loop.** AWAKE → REM → NORMALIZING → AWAKE.

**Trigger:** `dream_cycle` tool  
**Actors:** cognitive_engine, dreamer, normalizer  
**Source:** [src/cognitive/dreamer.ts](../src/cognitive/dreamer.ts), [src/cognitive/normalizer.ts](../src/cognitive/normalizer.ts), [src/cognitive/engine.ts](../src/cognitive/engine.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Pre-flight checks | Assert AWAKE state. Load dream graph from disk. |
| 2 | Transition to REM | AWAKE → REM. Fact graph loaded as grounding dataset. |
| 3 | Strategy selection | Select from 10 strategies (incl. LLM dream + PGO wave). Budget: LLM 35%, PGO wave 15%, structural 50% — distributed adaptively. Strategies with 3+ zero-yield cycles are benched, probed every 6th cycle. LLM dream and PGO wave are never benched. |
| 4 | Speculative generation | Each strategy generates DreamEdges with initial TTL=8, strategy-specific confidence. Deduplication applied. Edges matching reinforcement memory inherit accumulated count. Max dreams capped (default 20). |
| 5 | Dream persistence | New edges appended to `dream_graph.json`. Duplicates get `reinforcement_count++` instead of duplication. |
| 6 | Transition to NORMALIZING | REM → NORMALIZING (if `auto_normalize=true`). |
| 7 | Three-outcome classification | Split scoring: plausibility × evidence − contradiction. Promotion gate: confidence ≥ 0.62, plausibility ≥ 0.45, evidence ≥ 0.40, evidence_count ≥ 2, contradiction ≤ 0.3. |
| 8 | Outcome dispatch | Validated → `validated_edges.json` (relation cleaned). Latent → stays in dream graph. Rejected → removed. All logged to `candidate_edges.json`. |
| 9 | Dream decay | TTL−=1, confidence−=0.05. Edges at TTL=0 or confidence <0.35 expire. Reinforcement memory preserved 30 cycles post-death. |
| 10 | Return to AWAKE | NORMALIZING → AWAKE. History entry appended. v5.1 hooks fire: `maybeAutoNarrate()`, `checkTensionThresholds()`. |

**Output:** `{ dreams_generated, promoted, latent, rejected, expired, tensions_created, tensions_resolved }`

---

## 2. Nightmare Cycle (`nightmare_cycle_flow`)

**Adversarial security scan.** AWAKE → NIGHTMARE → AWAKE.

**Trigger:** `nightmare_cycle` tool  
**Actors:** cognitive_engine, adversarial_dreamer  
**Source:** [src/cognitive/adversarial.ts](../src/cognitive/adversarial.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Pre-flight checks | Assert AWAKE. Load fact graph for security entity construction. |
| 2 | Transition to NIGHTMARE | AWAKE → NIGHTMARE. |
| 3 | Security entity construction | Build SecurityEntity per feature via regex: `has_auth_refs`, `has_rls_refs`, `has_validation_refs`, `accepts_input`, `stores_data`. |
| 4 | Strategy execution | Five strategies run: privilege_escalation (CWE-269), data_leak_path (CWE-200), injection_surface (CWE-20), missing_validation (CWE-20), broken_access_control (CWE-862). |
| 5 | Threat edge generation | ThreatEdges with severity, CWE IDs, blast radius. |
| 6 | Persistence | Threats → `threat_log.json`. Critical/high → tension signals. |
| 7 | Return to AWAKE | NIGHTMARE → AWAKE. |

**Output:** `{ threats_found, by_severity, by_strategy, new_tensions_created }`

---

## 3. Normalization Pipeline (`normalization_flow`)

**The three-outcome classifier** — evaluating a single dream edge.

**Trigger:** Step 7 of dream cycle, or `normalize_dreams` tool  
**Source:** [src/cognitive/normalizer.ts](../src/cognitive/normalizer.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Load grounding data | Features, workflows, data model → lookup tables. |
| 2 | Plausibility scoring | Entity existence, domain coherence, keyword overlap, repo match. → 0.0–1.0 |
| 3 | Evidence scoring | Count independent sources: features (+1), data model (+1), workflows (+1), multi-feature (+0.5). → evidence_count + score |
| 4 | Contradiction scoring | Check conflicts with existing fact-graph links. → 0.0–1.0 |
| 5 | Combined confidence | `plausibility × evidence − contradiction` |
| 6 | Promotion gate | All 5 thresholds must pass for validated. Partial pass → latent. Fail → rejected. |
| 7 | Outcome recording | Validated: cleaned relation → `validated_edges.json`. Latent: scores attached, stays in dream graph. Rejected: removed. |

---

## 4. Tension Lifecycle (`tension_lifecycle_flow`)

**From creation to resolution or expiry.**

**Trigger:** Normalization rejection, adversarial scan, insight injection, federation import  
**Source:** [src/cognitive/engine.ts](../src/cognitive/engine.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Creation | UUID assigned. Type, urgency, entities, domain (inferred by keyword heuristic from 11 domains). |
| 2 | Active cap enforcement | >200 active → lowest-urgency auto-archived. Prevents cognitive overload while allowing rich autonomous exploration. |
| 3 | Per-cycle decay | urgency −= 0.01, TTL −= 1. At zero → expired. |
| 4 | Goal-directed dreaming | Highest-urgency tensions read by `tension_directed` strategy. |
| 5 | Resolution (happy path) | `resolve_tension(id, type, authority)`. Types: `confirmed_fixed`, `false_positive`, `wont_fix`. |
| 6 | Expiry (timeout path) | TTL=0 or urgency=0 → auto-expires. Archived for historical analysis. |

---

## 5. Edge Promotion (`edge_promotion_flow`)

**The 5-state lifecycle of a dream edge.**

```
candidate → [normalization] → validated (promoted)
                             → latent (speculative memory)
                             → rejected (discarded)
                                 ↓ (decay)
                             → expired (TTL death, reinforcement memory survives)
```

| Step | Name | Description |
|------|------|-------------|
| 1 | Generation | Strategy creates edge: TTL=8, status=candidate. Inherits reinforcement memory if same key existed before. |
| 2 | Evaluation | Normalizer scores plausibility, evidence, contradiction. |
| 3 | Validated | All 5 thresholds pass. Relation cleaned, copied to `validated_edges.json`. |
| 4 | Latent | Partial pass. Stays in dream graph with scores. Can be re-evaluated. |
| 5 | Rejected | Hard fail. Removed. If confidence ≥ 0.3, creates a tension. |
| 6 | Expired | TTL decay death. Reinforcement memory preserved 30 cycles. |

---

## 6. Federation (`federation_flow`)

**Cross-project pattern sharing.**

**Trigger:** `export_dream_archetypes` / `import_dream_archetypes`  
**Source:** [src/cognitive/federation.ts](../src/cognitive/federation.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Export: read validated | Load `validated_edges.json`. Group by pattern type. |
| 2 | Export: anonymize | Replace entity names with generic roles: `service_entity`, `data_store_entity`, `ui_component`, `auth_component`, `api_endpoint`. |
| 3 | Export: classify | Map to pattern type: `security_pattern`, `structural_gap`, `cross_domain_bridge`, `tension_resolution`, etc. |
| 4 | Export: persist | Write to `dream_archetypes.json`. |
| 5 | Import: load | Read foreign archetypes. Validate structure. |
| 6 | Import: create tensions | Each imported archetype → tension: *"Does this pattern hold locally?"* → triggers `tension_directed` dreaming. |

---

## 7. Interruption Protocol (`interruption_protocol_flow`)

**Emergency abort with data safety.**

**Trigger:** Tool call during active REM/NORMALIZING/NIGHTMARE, or `engine.interrupt()`  
**Source:** [src/cognitive/engine.ts](../src/cognitive/engine.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Trigger | Tool call during non-AWAKE state. |
| 2 | Dream quarantine | Uncommitted edges flagged. NOT written to dream graph. |
| 3 | State rollback | Force transition to AWAKE. Partial results discarded. |
| 4 | Persistence checkpoint | Committed data saved. History entry notes interruption. |
| 5 | Notification | Returns `{ interrupted_state, quarantined_count, cycle }`. |

---

## 8. Living Documentation Export (`living_docs_flow`)

**Knowledge graph → structured Markdown.**

**Trigger:** `export_living_docs` tool  
**Source:** [src/tools/living-docs-exporter.ts](../src/tools/living-docs-exporter.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Load knowledge graph | All fact graph files + optional ADR, UI registry. |
| 2 | Section generation | 8 generators: features, data_model, workflows, architecture, ui_registry, cognitive_status, api_reference, index. |
| 3 | Framework adaptation | Docusaurus (sidebars.js, MDX), Nextra (meta.json), MkDocs (mkdocs.yml), Plain (standard MD). |
| 4 | Enrichment | Optional Mermaid diagrams, cognitive health section. |
| 5 | Output | Stateless and idempotent structured Markdown. |

---

## 9. Insight Solidification (`insight_solidification_flow`)

**Manual injection into cognitive memory.**

**Trigger:** `solidify_cognitive_insight` tool  
**Source:** [src/tools/solidify-insight.ts](../src/tools/solidify-insight.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Validate | Check insight type (EDGE/TENSION/ENTITY) and required fields. |
| 2 | Brief REM entry | AWAKE → REM (state guard compliance). |
| 3 | Create | EDGE: strategy=reflective, TTL=12, specified confidence. TENSION: via `engine.recordTension()`. ENTITY: node with hypothetical=true. |
| 4 | Return to AWAKE | REM → AWAKE. No normalization triggered (pre-validated by agent). |

---

## 10. Schedule Execution Flow (`schedule_execution_flow`)

**Policy-driven temporal orchestration of cognitive actions.**

**Trigger:** Scheduler tick loop (every 30s), `run_schedule_now` tool, or hook (`notifyCycleComplete`, `recordActivity`)  
**Source:** [src/cognitive/scheduler.ts](../src/cognitive/scheduler.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Tick | Scheduler wakes every `tick_interval_ms` (default 30s). Checks each enabled schedule. |
| 2 | Trigger evaluation | For each schedule, check trigger condition: `interval` (elapsed time), `cron_like` (hour/minute/day-of-week match), `after_cycles` (cycle count since last run), `on_idle` (time since last activity). |
| 3 | Safety check | Verify: (a) not already executing, (b) cooldown elapsed since last run, (c) hourly rate limit not exceeded, (d) error streak < pause limit. |
| 4 | Execute action | Call internal engine function: `dream_cycle`, `nightmare_cycle`, `normalize_dreams`, `metacognitive_analysis`, `get_causal_insights`, `get_temporal_insights`, or `export_dream_archetypes`. |
| 5 | Record result | Append execution record: timestamp, success/failure, duration_ms, result summary. Update `run_count`, `last_run_at`, `next_run_at`. |
| 6 | Error handling | On failure: increment `error_streak`. If streak ≥ 3, auto-pause schedule (status: `paused`). On success: reset `error_streak` to 0. |
| 7 | Completion check | If `run_count` ≥ `max_runs`, set status to `completed` and disable schedule. |
| 8 | Persist | Write updated schedule state to `data/schedules.json`. |

---

## 11. Global Install (`global_install_flow`)

**Cross-platform install from source to `~/.dreamgraph/bin/`.**

**Trigger:** `scripts/install.ps1` (Windows) or `scripts/install.sh` (macOS/Linux)  
**Source:** [scripts/install.ps1](../scripts/install.ps1), [scripts/install.sh](../scripts/install.sh)

| Step | Name | Description |
|------|------|-------------|
| 1 | Build | Run `npm run build` to compile TypeScript to `dist/`. |
| 2 | Create bin dir | Ensure `~/.dreamgraph/bin/` exists. |
| 3 | Clean node_modules | Remove existing `~/.dreamgraph/bin/node_modules/` to avoid stale deps. |
| 4 | Copy dist | Mirror `dist/` into `~/.dreamgraph/bin/dist/`. |
| 5 | Copy package files | Copy `package.json` and `package-lock.json` for npm install. |
| 6 | Install production deps | Run `npm install --omit=dev` inside `~/.dreamgraph/bin/`. |
| 7 | Write version.json | Stamp `{ version, builtAt, sourceDir }`. |
| 8 | Create shims | Platform-specific: `.ps1` shim on Windows, symlink on POSIX, both pointing to `dist/cli/dg.js`. |

---

## 12. Daemon Start (`daemon_start_flow`)

**Start a DreamGraph daemon process for an instance.**

**Trigger:** `dg start [instance]` CLI command  
**Source:** [src/cli/commands/start.ts](../src/cli/commands/start.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Resolve instance | Look up instance directory from name/UUID. Load `instance.json`. |
| 2 | Check already running | Read PID from metadata; verify process alive. Abort if already running. |
| 3 | Read transport | Read `transport` from `instance.json` (default: `http`). |
| 4 | Parse flags | Check `--foreground`, `--port`, `--verbose`. |
| 5 | Guard stdio | If transport is `stdio` and `--foreground` not set, throw error with 3 suggested alternatives. |
| 6 | Port collision check | If HTTP, verify port is free; auto-increment if occupied. |
| 7 | Spawn daemon | Fork `node dist/index.js` detached with env vars, stdout/stderr → log files. |
| 8 | Write metadata | Write PID, port, transport, startedAt to instance metadata. |
| 9 | Health check | Poll HTTP endpoint (up to 15 s). Confirm server is responsive. |

---

## 13. Daemon Stop (`daemon_stop_flow`)

**Gracefully stop a running DreamGraph daemon.**

**Trigger:** `dg stop [instance]` CLI command  
**Source:** [src/cli/commands/stop.ts](../src/cli/commands/stop.ts)

| Step | Name | Description |
|------|------|-------------|
| 1 | Resolve PID | Load instance metadata, read daemon PID. |
| 2 | Validate ownership | Confirm PID belongs to a DreamGraph process. |
| 3 | Send signal | Send SIGTERM (POSIX) or `taskkill` (Windows). |
| 4 | Wait for exit | Poll process status up to timeout (default 10 s). |
| 5 | Verify shutdown | Check process is gone. Server logs "Shutdown complete" with 200 ms flush. |
| 6 | Clean metadata | Remove PID and port from instance metadata files. |

---

## 14. Dashboard Request Lifecycle (`dashboard_request_flow`)

**Handle an incoming HTTP request to the web dashboard.**

**Trigger:** Browser navigates to any dashboard route (GET) or submits a form (POST)  
**Source:** [src/server/dashboard.ts](../src/server/dashboard.ts)

### GET Request (Page Render)

| Step | Name | Description |
|------|------|-------------|
| 1 | Route match | `handleDashboardRoute()` matches URL pathname to a known page (`/`, `/status`, `/schedules`, `/config`, `/docs`, `/health`). |
| 2 | Gather data | Page renderer reads live state: cognitive engine status, schedules, config values, knowledge graph data. |
| 3 | Render HTML | Server-side renders full HTML page with inlined CSS, navigation bar, and page-specific content. |
| 4 | Respond | Returns `200 text/html` (or `application/json` for `/health` with JSON Accept header). |

### POST Request (Form Action)

| Step | Name | Description |
|------|------|-------------|
| 1 | Parse body | Read URL-encoded form body or JSON body. |
| 2 | Dispatch action | Route to handler based on path: `/config` → `handleConfigPost()`, `/schedules` → `handleSchedulePost()`, `/config/test-db` → `handleTestDbPost()`. |
| 3 | Execute mutation | Apply the requested change: update LLM/scheduler/narrative config, toggle/create/delete schedule, or test DB connection. |
| 4 | Redirect (PRG) | For form POSTs, return `303 See Other` redirecting back to the originating page. For `/config/test-db`, return JSON response directly. |

---

## 15. Project Bootstrap via `dg scan` (`bootstrap_flow`)

**Onboarding for new instances.** Triggered by the user running `dg scan <instance>` after configuring LLM settings.

**Trigger:** `dg scan` → `scan_project` MCP tool (Phases 1–5)
**Guard:** ADR discovery and follow-up scheduling only run when seed data is populated and LLM is available
**Source:** [src/tools/scan-project.ts](../src/tools/scan-project.ts), [src/instance/bootstrap.ts](../src/instance/bootstrap.ts)

| Step | Phase | Description |
|------|-------|-------------|
| 1 | Phase 1 — File scan | Discover directory structure, read key source files, classify by type. |
| 2 | Phase 2 — LLM enrichment | If an LLM is configured, generate rich semantic descriptions for features, workflows, and data model entities. Falls back to structural-only analysis otherwise. |
| 3 | Phase 3 — Auto-dream | Trigger a full dream cycle (`strategy="all"`) to generate initial speculative edges and validate them against the newly populated fact graph. |
| 4 | Phase 4 — ADR discovery | Build an LLM prompt from discovered entities to identify implicit architectural decisions. Each discovered ADR is recorded via `recordADR()` with `decided_by: "system"`. |
| 5 | Phase 5 — Schedule follow-ups | Five dream cycles are scheduled at 5-minute intervals to allow the knowledge graph to grow and stabilize. |

**Important:** The daemon does NOT auto-scan on startup. The user must configure LLM settings first (via dashboard at `/config` or by editing `engine.env`), then run `dg scan <instance>`.

**Output:** Log messages and CLI output indicating each phase's completion. The instance is ready for interactive use after the scan completes.

---

## 16. Explorer Curated Mutation (`explorer_mutation_flow`)

**Purpose**: Operator-driven promotion, rejection, or tension resolution applied through the Explorer SPA with optimistic concurrency, mandatory rationale, and a permanent audit trail.

**Steps**:
1. Operator opens the Explorer (`/explorer/`) via the VS Code statusbar quick-pick or directly in the browser.
2. SPA fetches `GET /explorer/api/snapshot` ? receives `{ instance_uuid, etag, ... }`.
3. Operator selects the Tensions or Candidates tab in the right rail. Each row is enriched (endpoints, names, descriptions) and exposes Inspect chips that jump to the Inspector tab.
4. Operator chooses an action � Resolve / Promote / Reject � and a form opens with a `reason` textarea.
5. (Optional) Operator clicks **Suggest** ? SPA `POST /explorer/api/reason-suggest` with `{ intent, subject }`. The Dreamer LLM (`gpt-5.4-nano`) drafts a reason; operator edits as needed.
6. Operator submits the form. SPA `POST /explorer/mutations/<intent>` with headers `X-DreamGraph-Instance: <uuid>` + `If-Match: <etag>` and body `{ <id>, reason }`.
7. Daemon validates the etag. On mismatch ? **HTTP 412**; SPA refetches the snapshot, surfaces a conflict banner, and the operator can retry against the fresh state.
8. On success the daemon applies the mutation (resolve tension / promote candidate / reject candidate), appends a row to `explorer_audit_log.jsonl` with `{ ts, intent, subject, reason, actor, etag_before, etag_after }`, and emits `cache.invalidated` + `snapshot.changed` over `/explorer/events`.
9. SPA receives the SSE, refetches the snapshot, and the affected row disappears from the pending pool. Inspector reflects the new graph state.
10. Subsequent dream cycles see the new validated/resolved state and reason about the graph going forward.

**Concurrency contract**:
- The etag is a content hash of the snapshot. Any concurrent dream cycle, mutation, or schedule that modifies the graph rotates the etag.
- Stale etag ? 412; never silent overwrite.
- Mutations are serialized through the data-file mutex.

---

## 17. Connect a Shared Database (`shared_database_flow`)

**Purpose**: Make a project's primary datastore a first-class graph hub so multi-repo features and workflows visibly orbit around the shared state they touch.

**Steps**:

| Step | Phase | Description |
|------|-------|-------------|
| 1 | Configure | Set `DATABASE_URL` in the instance's `config/engine.env` and restart the daemon. |
| 2 | Auto-seed | On boot, `src/instance/datastore-bootstrap.ts` writes a `datastore:primary` stub into `data/datastores.json` if no real datastore is registered yet. |
| 3 | Sync schema | Click **Sync schema** on the dashboard Datastores card (or call the `scan_database` MCP tool). The daemon introspects via `query_db_schema`, applies denylist filters (`pg_*`, `_prisma_migrations`, junction tables with no FKs and < 3 columns), and writes `tables[]` + `last_scanned_at` back to `datastores.json`. |
| 4 | (Optional) Materialize entities | Run `scan_database({ create_missing: true })` to upsert stub `data_model` entries for any kept table that has no representation. New entries get `id: data_model:db.<schema>.<table>`, `status: introspected`, and a `stored_in` link to the datastore. |
| 5 | Ground the graph | Run a dream cycle with `strategy: schema_grounding`. Stage 1 proposes `stored_in` edges (exact name match conf 0.85, fuzzy 0.55). Stage 2 proposes `shares_state_with` edges between top-level entities in different repos that touch the same datastore. |
| 6 | Surface gaps | The same strategy raises `phantom_entity` tensions (data_models with no resolvable table) and `shadow_table` tensions (tables nothing claims). `dg curate --targets datastores` lists both. |
| 7 | Curate | Address each finding: enrich the `storage` field, run `scan_database({ create_missing: true })`, or add stub entities via `enrich_seed_data`. |

**Inert when unconfigured**: with no `DATABASE_URL`, the dashboard card renders a `NOT CONFIGURED` pill, no auto-seed runs, `schema_grounding` returns `[]` immediately, and the `orphan_bridging` hub-bias bonus is `0` � zero impact on non-DB instances.

