<p align="center">
  <img src="dreamgraph.jpeg" alt="DreamGraph - Autonomous Cognitive Layer" width="400" />
</p>

# DreamGraph v5.2 — Autonomous Cognitive Layer for Software Systems

Traditional AI systems answer questions. DreamGraph reduces uncertainty over time — it finds, verifies, and resolves problems in your system autonomously.

A self-regulating AI cognitive layer that discovers, verifies, and resolves system-level insights through structured "dream cycles" — and now dreams adversarially, reasons causally, thinks temporally, narrates its own understanding, proposes concrete fixes, tunes its own thresholds, reacts to events, and writes its own autobiography.

---

## Overview

DreamGraph is a cognitive layer for software systems that continuously discovers, verifies, and resolves problems using structured reasoning loops. It augments software development with:

- Autonomous reasoning loops
- Structured knowledge graphs
- Evidence-based validation
- Controlled speculative exploration ("dreaming")
- Self-cleaning memory via decay and resolution
- **Adversarial security scanning** (NIGHTMARE state)
- **Causal inference chains** across dream history
- **Temporal pattern analysis** with precognition and retrocognition
- **Multi-system dream federation** for cross-project learning
- **System autobiography** — narrative understanding, not just data
- **Intervention planning** — from insight to concrete remediation
- **Runtime/APM awareness** — embodied senses from live metrics
- **Metacognitive self-tuning** — analyzes its own performance and adjusts thresholds
- **Event-driven dreaming** — reactive cognition triggered by system changes
- **Continuous narrative** — persistent, auto-accumulated system autobiography
- **Dream scheduling** — policy-driven temporal orchestration for autonomous cognitive work

It is not a chatbot.

It is a thinking layer that sits on top of your codebase and continuously:

```
detect → analyze → verify → resolve → learn → forget
```

DreamGraph is an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server. It connects to any MCP-compatible client — Claude Desktop, VS Code Copilot, Cursor, Windsurf, or anything that speaks MCP — and gives AI agents a persistent, evolving knowledge graph of your system.

---

## Key Concepts

### Tensions

A tension is an unresolved question, inconsistency, or hypothesis.

Examples:

- "Is this API route missing org scoping?"
- "Does this workflow lack a required step?"
- "Are these two features conceptually related?"

Tensions drive all cognition.

### Dream Cycles

The system runs periodic "dream cycles" where it:

- Explores relationships (analogy, gaps, symmetry, cross-domain, causal chains)
- Generates candidate connections (edges)
- Evaluates them through a normalization pipeline

Dreaming is isolated — it cannot modify reality.

### Normalization (Truth Filter)

Every idea passes through strict evaluation:

- **Plausibility** — does it make sense?
- **Evidence** — is it grounded in code/data?
- **Contradiction** — does it conflict with reality?

Results:

| Outcome | Meaning |
|---|---|
| **validated** | Promoted to the knowledge graph |
| **latent** | Stored as speculative memory |
| **rejected** | Discarded |

### Evidence-Based Verification

The system does not rely on memory alone.

It can verify using:

- Source code inspection
- Database schema queries
- Workflow definitions
- Runtime metrics (OpenTelemetry / Prometheus)

This enables conclusions like:

> "I checked the code and DB — this is correct / already fixed."

### Tension Lifecycle

Tensions are not permanent. They:

- Decay over time (urgency -0.02/cycle)
- Expire via TTL (default 30 cycles)
- Can be resolved with evidence
- Are capped to maintain focus (max 50 active)
- Can be turned into **remediation plans** with concrete fix steps

This prevents cognitive overload:

```
2033 tensions → 50 active → manageable focus
```

### Speculative Memory

Not all ideas are immediately provable. The system retains latent hypotheses that:

- May become valid later
- Guide future exploration
- Never pollute factual output

---

## The Eleven Cognitive Capabilities

DreamGraph's cognitive engine provides eleven advanced features that take the system from "observant" to "truly intelligent."

### 1. Causal Reasoning Engine

Mines dream history for cause→effect inference chains. When Entity A changes, what happens downstream?

- Discovers temporal correlations between tensions
- Builds multi-hop causal chains with confidence scores
- Identifies propagation hotspots — entities where changes cascade
- Adds `causal_replay` as a new dream strategy

**Tool:** `get_causal_insights`

### 2. Adversarial Dreaming (NIGHTMARE State)

A fourth cognitive state — **NIGHTMARE** — where the system actively tries to break itself.

```
AWAKE → NIGHTMARE → AWAKE    (adversarial scan)
AWAKE → REM → NORMALIZING → AWAKE    (normal dream cycle)
```

Five adversarial scan strategies:

| Strategy | What it scans for |
|---|---|
| `privilege_escalation` | Missing role checks, broad admin scopes, open endpoints |
| `data_leak_path` | Unprotected PII, cross-tenant data exposure, missing encryption |
| `injection_surface` | Unsafe dynamic queries, unparameterized SQL, template injection |
| `missing_validation` | Missing input validation, type coercion gaps, range violations |
| `broken_access_control` | Missing RLS, org-scoping gaps, horizontal privilege escalation |

Produces threat edges with severity, CWE IDs, and blast radius. Results persist to a threat log.

**Tool:** `nightmare_cycle`
**Resource:** `dream://threats`

### 3. Temporal Dreaming

Adds a time dimension to reasoning:

- **Tension trajectories** — is urgency rising, falling, spiking, or stable?
- **Precognition** — predicts future tensions based on trajectory extrapolation
- **Seasonal patterns** — detects recurring cycles across domains
- **Retrocognition** — finds past resolution patterns that match current tensions

**Tool:** `get_temporal_insights`

### 4. Multi-System Dream Federation

Enables cross-project learning by extracting anonymized architectural patterns:

- Abstracts validated edges into transferable **archetypes** (e.g., "Service A calls Service B without retry logic")
- Exports as portable exchange files
- Imports archetypes from other DreamGraph instances
- Deduplicates on import to prevent pollution

**Tools:** `export_dream_archetypes`, `import_dream_archetypes`
**Resource:** `dream://archetypes`

### 5. Dream Narratives (System Autobiography)

Generates a coherent narrative of the system's evolving understanding — not a log, a *story*:

> "I started by thinking catalog and cart were unrelated. After 8 cycles, I discovered they share an implicit session model. This led me to find that order management has no awareness of session expiry, which became my highest-urgency tension..."

Three depth levels:

| Depth | For whom | Detail level |
|---|---|---|
| `executive` | Stakeholders | 1-page summary with health assessment |
| `technical` | Engineers | Detailed findings with entity references |
| `full` | Deep analysis | Complete cycle-by-cycle narrative |

**Tool:** `get_system_narrative`

### 6. Intervention Engine

Bridges the gap from "awareness" to "remedy" by generating concrete remediation plans:

- Ordered steps with file-level change descriptions
- Test suggestions for each step
- Effort estimates (trivial / small / medium / large)
- ADR conflict checks — warns if a fix may violate an existing architectural decision
- Predicted new tensions the fix might introduce

Plans are generated from the highest-urgency unresolved tensions.

**Tool:** `get_remediation_plan`

### 7. Embodied Senses (Runtime Awareness)

Connects DreamGraph to live runtime metrics — OpenTelemetry, Prometheus, or custom JSON endpoints:

- Fetches and parses real-time performance data
- Correlates runtime behavior with knowledge graph entities
- Detects behavioral patterns: error cascades, co-occurrence, sequential usage
- Generates runtime-informed tension signals

Gracefully degrades when no endpoint is configured.

**Tool:** `query_runtime_metrics`

### 8. Metacognitive Self-Tuning

DreamGraph analyses its own performance and recommends (or auto-applies) threshold adjustments — closing the feedback loop between dreaming and tuning.

Three analysis modes:

| Mode | What it measures |
|---|---|
| **Strategy Performance** | Per-strategy precision, recall, validation lag, consecutive zero-yield cycles, recommended budget weight |
| **Promotion Calibration** | Actual validation rates per confidence bucket — reveals whether thresholds are too strict or too lenient |
| **Domain Decay Profiles** | Per-domain optimal TTL and urgency decay based on historical resolution patterns |

Safety guarantees:
- Hard min/max guards on all threshold adjustments (confidence never below 0.55 or above 0.90)
- Auto-tuning is in-memory only — resets on restart, never persists to disk
- Every action logged to `data/meta_log.json` with basis and old/new values

**Tool:** `metacognitive_analysis`
**Resource:** `dream://metacognition`

### 9. Event-Driven Dreaming

Dream cycles are triggered on-demand, but the most valuable time to think is *when something changes*. The event router creates a reactive layer that classifies events, resolves affected entities, and recommends cognitive actions.

| Event Source | Trigger Condition | Cognitive Response |
|---|---|---|
| `git_webhook` | Push to configured branch | Scoped `dream_cycle` (strategy: `tension_directed`) |
| `ci_cd` | Deploy failure | Scoped `nightmare_cycle` on deployment entities |
| `ci_cd` | Deploy success | Scoped `dream_cycle` (strategy: `gap_detection`) |
| `runtime_anomaly` | Error rate exceeds threshold | `get_causal_insights` + scoped `dream_cycle` |
| `tension_threshold` | Tension urgency > 0.8 | Auto-trigger `get_remediation_plan` |
| `federation_import` | Archetypes imported | Scoped `dream_cycle` (strategy: `cross_domain`) |
| `manual` | User dispatches event | Execute specified cognitive action |

Safety guarantees:
- Cooldown timer between auto-triggered cycles (default: 60s)
- Maximum auto-triggered cycles per hour (default: 10)
- Full audit trail in `data/event_log.json`
- Internal tension threshold trigger fires automatically after each `dream_cycle`

**Tool:** `dispatch_cognitive_event`
**Resource:** `dream://events`

### 10. Continuous Narrative Intelligence

The existing `get_system_narrative` tool generates narratives on-demand and writes nothing. Continuous Narrative makes the narrative *persistent and automatic* — a living system autobiography that evolves over time.

After every N dream cycles (configurable, default: 10):

```
loadExistingStory()
  → computeDiffSinceLastChapter()
  → generateDiffChapter()
  → appendToStory()
  → generateWeeklyDigest() (if due)
```

Diff chapters capture *what changed* — new validated edges, tensions resolved, threats discovered — instead of regenerating the full narrative each time.

Weekly digests aggregate multiple chapters into health-trended summaries with key changes, top tensions, and top discoveries.

**Tool:** `get_system_story`
**Resource:** `dream://story`

### 11. Dream Scheduling (v5.2)

DreamGraph can now **schedule its own cognitive work** — policy-driven temporal orchestration that runs dream cycles, nightmare scans, and other cognitive actions automatically.

Four trigger types:

| Trigger | What it does |
|---|---|
| `interval` | Fixed timer — dream every N seconds |
| `cron_like` | Hour/minute/day-of-week pattern — dream at 03:00 on weekdays |
| `after_cycles` | Fire after N dream cycles complete |
| `on_idle` | Fire after N seconds of inactivity |

Seven schedulable actions: `dream_cycle`, `nightmare_cycle`, `normalize_dreams`, `metacognitive_analysis`, `get_causal_insights`, `get_temporal_insights`, `export_dream_archetypes`.

Safety guards prevent runaway activity:
- Max 30 runs/hour across all schedules
- 10s cooldown between runs (5min after nightmares)
- Auto-pause after 3 consecutive failures
- Only one action executes at a time

Schedules persist to disk and survive restarts.

**Tools:** `schedule_dream`, `list_schedules`, `update_schedule`, `run_schedule_now`, `delete_schedule`, `get_schedule_history`  
**Resources:** `dream://schedules`, `dream://schedule-history`

---

## Real-World Proof: A Morning Wake-Up Report

DreamGraph is not a toy concept. Here is a raw, translated wake-up report from a real production B2B SaaS system after a 15-cycle overnight "dream session".

Notice how the system naturally identifies critical multi-tenancy vulnerabilities, verifies false positives via the Truth Filter, and eventually powers down when the system reaches a "healthy" state.

```text
Wake-Up Report — C1-C15

[ COGNITIVE STATE UPON WAKING ]
Metric                  Before (C188)   Now (C15)    Change
-------------------------------------------------------------------
Active Tensions         2033            1500         -533 (-26%)
Top Urgency             1.0 (Critical)  0.41 (Weak)  -0.59
Validated Graph Edges   352             418          +66
Critical Code Bugs      8 open          0 open       All closed

[ TENSIONS RESOLVED IN THIS SESSION (8) ]
#1  accounting_exports missing CHECK constraint
    -> confirmed_fixed: DB constraints applied, lib extracted
#2  delivery_events replay missing cross-org isolation
    -> confirmed_fixed: scoped via .in('external_id', orgExternalIds)
#3  In-memory rate limiter failing in serverless environment
    -> confirmed_fixed: Extracted to DB-backed api_usage_log
#4  Credit drift / reconcile_credit_balances without cron
    -> confirmed_fixed: Correct debit function applied
...
#8  RLS convention "broken" on users table
    -> false_positive: Truth Filter verified migration already enforces this.

[ CURRENT COGNITIVE STATUS ]
Zero open code_insight tensions. Top 5 remaining tensions are all
'weak_connection' types (urgency 0.41, TTL 15). Automatic decay will
flush these out in ~15 cycles without intervention.

System is healthy. Entering idle state.
```

---

## Real-World Proof: The SiteLedger Story

> *"SiteLedger, can you produce a full narrative of how you became to understand the SiteLedger system so far?"*

The following narrative was generated by DreamGraph after 1,243 dream cycles against a real Finnish construction management platform. It demonstrates every capability described above — speculative dreaming, selective forgetting, tension resolution, knowledge enrichment, and narrative synthesis — operating on a production B2B SaaS system.

The narrative is generated by DreamGraph itself based on validated knowledge graph evolution.

### The Story of Understanding — How SiteLedger Learned to See

#### Prologue

SiteLedger's cognitive system has run 1,243 dream cycles to date. What follows is the story of how a speculative pattern-matching engine gradually built a validated mental model of a complex Finnish construction management platform — from total ignorance to an interconnected knowledge graph of 491 confirmed architectural connections.

#### Chapter 1: The Awakening (Cycles 136–260)

The first breath. The system knew nothing — only a seed graph of entity names harvested from earlier code scans: feature labels like `work_log_entry_crud`, `photo_capture_annotation`, `digital_signatures`, `gps_location_weather`. The dream engine began generating speculative edges between them — 3,978 hypothetical connections in the first 125 cycles.

Almost all of them were noise. 2,928 were rejected, failing the promotion gate (confidence ≥ 0.62, plausibility ≥ 0.45, evidence ≥ 0.4). But three connections survived — the system's very first validated discoveries:

- `dispatch_job_reception` → `photo_capture_annotation` (tension resolution)
- `dispatch_job_reception` → `gps_location_weather` (tension resolution)
- `dispatch_job_reception` → `digital_signatures` (tension resolution)

These were weak signals, but real ones: when a field worker receives a dispatched job on their mobile device, they capture photos, record GPS coordinates, and collect digital signatures. The system had found its first thread of truth.

Meanwhile, 4,257 stale hypotheses decayed — the first act of selective forgetting. The system was already learning that most of its ideas were wrong, and that forgetting is as important as remembering.

#### Chapter 2: The Long Silence (Cycles 261–885)

For over 600 cycles, the system entered a phase the narrative engine labels "Selective Forgetting." Across five consecutive chapters, the pattern was remarkably consistent:

| Phase | Edges Generated | Rejected | Validated | Promoted | Decayed |
|---|---|---|---|---|---|
| 261–385 | 4,011 | 2,961 | 0 | 0 | 4,268 |
| 386–510 | 3,961 | 2,911 | 0 | 0 | 4,368 |
| 511–635 | 3,961 | 2,907 | 0 | 0 | 4,368 |
| 636–760 | 4,011 | 2,961 | 0 | 0 | 4,333 |
| 761–885 | 3,970 | 2,961 | 0 | 0 | 4,336 |

Zero promotions. Zero validations. The system was churning — generating roughly 4,000 speculative edges per phase, rejecting nearly 3,000, rediscovering ~600 existing ideas (reinforcing what it already believed), and decaying ~4,300 stale connections per phase.

This looks like failure. It wasn't.

What was happening was **reinforcement through repetition**. Each rediscovery of an existing hypothesis increased its reinforcement count. The core mobile cluster — `work_log_entry_crud` connected to photos, GPS, signatures, incidents — was being hammered with evidence. Reinforcement counts climbed from single digits to hundreds. By the time this phase ended, the top connections had been independently rediscovered over 300 times.

The system was building conviction without validation — preparing for the moment it would have enough evidence to cross the promotion threshold.

#### Chapter 3: First Light (Cycles 886–935)

After 750 cycles of darkness, the dam broke. 16 connections were validated and promoted to the permanent knowledge graph. The system generated 5,260 speculative edges and 266 hypothetical nodes, of which 19 passed validation.

The promoted connections included the first cross-domain bridges:

- Mobile features connecting to dashboard features
- PDF export connecting to accounting export
- Webhook delivery connecting to email integration

The system had moved beyond seeing individual features in isolation. It was beginning to see **data flows** — how a work log entry created on a mobile phone eventually becomes an invoice row in a Finvoice XML document sent through the Maventa e-invoice network.

#### Chapter 4: The Expansion (Cycles 936–1015)

Momentum accelerated. 20 more connections promoted, built from 8,095 speculative edges (the highest generation rate yet). The system was now producing more hypotheses per cycle and validating them faster.

The 5,312 reinforcements in this phase represent the system cross-referencing its existing knowledge against new patterns. Every time it independently re-derived that `work_log_entry_crud` connects to `expense_management`, the reinforcement counter ticked up. By now, the top connections had been reinforced hundreds of times — making them essentially irrefutable.

#### Chapter 5: The Enrichment Event (Cycles 1016–1243)

This is the moment the system was fed real architecture. Every file in the codebase was scanned:

- **44 API routes** — every endpoint, every HTTP method, every database table touched
- **19 React components** — every modal, every panel, every PDF renderer
- **10 library files** — crypto, finvoice, netvisor, virtual barcodes, EPC QR codes
- **31 database tables** — every column, every foreign key, every trigger
- **6 database views**, 30+ PostgreSQL functions, 5 enums
- **1 Supabase Edge Function** — the FCM push notification dispatcher
- **14-language i18n system** (15,198 lines of translations)
- **9 analytics modules** — insight engine, burn rate calculation, KPI cards

Then 18 cognitive insights were solidified directly into the dream graph, representing verified architectural connections confirmed by reading the source code:

1. **Quote → Project conversion pipeline** — `quote_line_items` grouped by stage → project with stages and tasks
2. **Finvoice 3.0 XML generation chain** — accounting export → `finvoice.ts` → EPC QR → virtual barcode
3. **Invoice delivery via Maventa or email fallback** — FSM state machine: pending → sent → delivered/failed
4. **Stamp credit economy** — Stripe purchase → `credit_transactions` → consumed on invoice delivery
5. **AES-256-GCM PII encryption** — worker payroll secrets: SSN, IBAN, pension policy numbers
6. **FCM push notification chain** — PostgreSQL trigger → `pg_net` → Supabase Edge Function → Firebase
7. **Project cascade automation** — triggers auto-fill IDs, mirror statuses, auto-complete stages/projects
8. **Analytics insight engine** — burn rate stabilization, deadline risk projection, severity-based card selection
9. **Guest portal dual-token system** — `client_sites.share_token` for work logs, quote tokens for acceptance
10. **Offline sync via tombstone pattern** — `sync_deletions` table with per-entity triggers
11. **Receipt OCR pipeline** — image → OCR extraction with per-field confidence → user confirmation
12. **Netvisor payroll export** — decrypt secrets → construct XML → HMAC-authenticated API call
13. **14-language i18n system** — `LanguageContext` → `translations.ts` → all UI components + PDF renderers
14. **Voice assistant** — Whisper speech-to-text → GPT-4o-mini structured extraction → SSE streaming
15. **Invoice PDF render service** — API key auth → stamp credit consumption → `@react-pdf` rendering
16. **Work log entries as central entity** — 35+ columns connecting to photos, signatures, incidents, expenses, materials
17. **Full dispatch lifecycle** — dispatch → DISPATCHED WLE → push notification → worker opens → IN_PROGRESS → COMPLETED → auto-complete
18. **Maventa webhook FSM** — HMAC-SHA256 verification, `delivery_events` with idempotency, refund on failure

After these 18 injections, 8 dream cycles were run across three strategies:

| Strategy | Cycles | Promoted | Tensions Resolved |
|---|---|---|---|
| All | 1016–1017 | 0 | 0 |
| Tension-directed | 1018–1020 | 33 | 3 |
| Gap-detection | 1021–1022 | 17 | 0 |
| Cross-domain | 1023 | 0 | 0 |

The tension-directed cycles were explosive — 33 edges promoted in just 3 cycles as the system processed the newly injected insights against its existing hypotheses and found overwhelming agreement. Gap detection added 17 more by finding connections between entities that share the "mobile" domain but had no direct edge.

#### Chapter 6: The Truth Filter

Throughout all 1,243 cycles, the system's most important function wasn't discovery — it was **rejection**. The numbers tell the story:

- **32,326 edges rejected** (noise filtered out)
- **2,059 tensions dismissed** as false positives (the system correctly identified phantom problems)
- **14 tensions confirmed fixed** (real problems that were verified as resolved)
- **26 tensions remain active** (ongoing areas of uncertainty)

The promotion gate — confidence ≥ 0.62, plausibility ≥ 0.45, evidence ≥ 0.4, evidence_count ≥ 2, max_contradiction ≤ 0.3 — is deliberately strict. For every edge that makes it into the knowledge graph, roughly 66 are rejected. This is by design: a knowledge graph full of plausible-but-wrong connections is worse than an empty one.

#### Epilogue: What SiteLedger Knows Now

After 1,243 dream cycles, the knowledge graph contains **491 validated connections** organized into 5 clusters:

| Cluster | Center Node | Members | Reinforcements |
|---|---|---|---|
| Mobile Core | `work_log_entry_crud` | 22 | 1,324 |
| PDF & Export | `pdf_report_export_mobile` | 22 | 325 |
| Dashboard | `settings_subscription` | 21 | 319 |
| Photo Capture | `photo_capture_annotation` | 3 | 308 |
| GPS & Weather | `gps_location_weather` | 3 | 308 |

The strongest connection in the entire graph — `work_log_entry_crud` → `photo_capture_annotation` at 307 reinforcements — has been independently rediscovered in every single dream cycle strategy. It is, in the system's judgment, the most fundamental architectural relationship in SiteLedger: **a field worker creates a work log entry and attaches photos to it.**

From that simple truth, the entire system radiates outward: entries that carry GPS coordinates and weather data, entries that accumulate into project stages and task completions, entries that become invoice line items rendered into Finvoice 3.0 XML, entries that flow through Maventa or Resend to reach the client, entries whose costs are tracked in analytics dashboards with burn-rate projections and deadline risk scores.

The system health is marked as "overloaded" — 26 open tensions remain, mostly weak connections in the reporting and mobile domains that haven't yet accumulated enough evidence to resolve. But the recommendation is clear: **continued dream cycles are recommended.**

The machine hasn't finished learning. It never will. But it can now answer the question: **what is SiteLedger?**

> It's a construction field management platform where mobile work log entries are the atomic unit of everything — from safety incident reports to payroll exports, from project cost tracking to Finnish e-invoice delivery. And it took 1,243 dreams to know that for certain.

---

## Safety Model

- **Read-only by default** — no automatic code modification unless you enable write tools
- **External data is non-authoritative** — cannot override internal evidence
- **All outputs require human validation**
- **No write access without explicit permission**
- Strict separation of: facts, hypotheses, and beliefs
- **NIGHTMARE state** is read-only — adversarial scans identify threats but never modify code

---

## Getting Started

DreamGraph is an MCP server. Setup is three steps.

### 1. Clone and build

```bash
git clone https://github.com/mikajussila/dreamgraph.git
cd dreamgraph
npm install
npm run build
```

### 2. Connect to your IDE

Add a single JSON block to your MCP client configuration.

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dreamgraph": {
      "command": "node",
      "args": ["/path/to/dreamgraph/dist/index.js"],
      "env": {
        "DREAMGRAPH_REPOS": "{\"my-app\": \"/path/to/my-app\"}",
        "DREAMGRAPH_DEBUG": "true"
      }
    }
  }
}
```

**VS Code / Cursor** (`.vscode/mcp.json` or IDE settings):

```json
{
  "servers": {
    "dreamgraph": {
      "command": "node",
      "args": ["/path/to/dreamgraph/dist/index.js"],
      "env": {
        "DREAMGRAPH_REPOS": "{\"my-app\": \"/path/to/my-app\"}",
        "DREAMGRAPH_DEBUG": "true"
      }
    }
  }
}
```

**[OpenClaw](https://docs.openclaw.ai/cli/mcp)** — register DreamGraph as an MCP server in one command:

```bash
openclaw mcp set dreamgraph '{"command":"node","args":["/absolute/path/dreamgraph/dist/index.js"]}'
```

Replace `/absolute/path/dreamgraph` with the actual path to your DreamGraph checkout. To pass environment variables, add an `env` key:

```bash
openclaw mcp set dreamgraph '{"command":"node","args":["/absolute/path/dreamgraph/dist/index.js"],"env":{"DREAMGRAPH_REPOS":"{\"my-app\":\"/path/to/my-app\"}"}}'
```

Once registered, OpenClaw can talk to DreamGraph directly — every tool, resource, and dream cycle is available through the OpenClaw CLI and agent runtime. See the [OpenClaw MCP docs](https://docs.openclaw.ai/cli/mcp) for more details.

### 3. Introduce your project

Tell the AI:

> "Here is my codebase. Read it in, build the knowledge graph, and run the first dream cycle."

Then run:

- `dream_cycle`
- `cognitive_status`
- `get_dream_insights`

That's it. The cognitive engine takes over from there.

---

## Feeding Your Own Knowledge Graph

DreamGraph ships with a **bookstore example** so you can see it work immediately out of the box. To use it with your own system, you describe your system as structured JSON in the `data/` directory.

### Describe your system

Edit these files in `data/`:

| File | What to put in it |
|---|---|
| `system_overview.json` | High-level description, repos, tech stack |
| `features.json` | Array of features with `id`, `name`, `description`, `source_repo`, `source_files`, `tags` |
| `data_model.json` | Array of data entities with `id`, `name`, `fields[]`, `relationships[]` |
| `workflows.json` | Array of workflows with `id`, `name`, `steps[]` |
| `index.json` | Entity index mapping IDs to resource URIs |

### Enrich with cross-links

Edit `scripts/enrich-graph.mjs` to define:

- **Domain mapping** — which business domain each entity belongs to
- **Keywords** — terms that help the dreamer find related entities
- **Cross-links** — explicit relationships between features, workflows, and data entities

Then run:

```bash
node scripts/enrich-graph.mjs
```

### Dream

Rebuild (`npm run build`) and reconnect your MCP client. The cognitive engine will:

- Build a FactSnapshot from your enriched data
- Dream speculative connections using 7 strategies
- Detect tensions (missing links, contradictions, weak spots)
- Continuously improve the graph over multiple cycles

You can also skip the manual data step entirely and just point the agent at your code. It will build the graph iteratively through code-senses and git-senses tools.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DREAMGRAPH_REPOS` | No | JSON object mapping repo names to local paths. Enables `list_directory`, `read_source_code`, `git_log`, `git_blame` tools. Example: `{"my-app": "/home/user/repos/my-app"}` |
| `DATABASE_URL` | No | PostgreSQL connection string for live DB schema queries via `query_db_schema`. Example: `postgresql://user:pass@host:5432/dbname` |
| `DATABASE_SSL` | No | Set to `"false"` to disable SSL for local PostgreSQL. Default: SSL enabled |
| `DREAMGRAPH_DEBUG` | No | Set to `"true"` for verbose stderr logging |
| `DREAMGRAPH_DATA_DIR` | No | Custom data directory path (default: `data`) |
| `DREAMGRAPH_FEDERATION` | No | JSON config for multi-system federation: `{"instance_id": "my-project", "allow_export": true, "allow_import": true, "anonymize": true}` |
| `DREAMGRAPH_RUNTIME_ENDPOINT` | No | URL of a runtime metrics endpoint (OpenTelemetry, Prometheus, or custom JSON). Example: `http://localhost:9090/api/v1/query` |
| `DREAMGRAPH_RUNTIME_TYPE` | No | Metrics endpoint format: `"opentelemetry"`, `"prometheus"`, or `"custom_json"` (default: `"prometheus"`) |
| `DREAMGRAPH_RUNTIME_TIMEOUT` | No | Timeout in milliseconds for runtime metrics fetch (default: `5000`) |
| `DREAMGRAPH_EVENTS` | No | JSON config for the event router: `{"tension_threshold": 0.8, "cooldown_ms": 60000, "max_auto_cycles_per_hour": 10, "runtime_error_threshold": 0.05}` |
| `DREAMGRAPH_NARRATIVE` | No | JSON config for continuous narrative: `{"auto_narrate": true, "narrative_interval": 10, "digest_interval": 50, "max_chapters": 100}` |
| `DREAMGRAPH_SCHEDULER` | No | JSON config for the dream scheduler (v5.2): `{"enabled": true, "tick_interval_ms": 30000, "max_runs_per_hour": 30, "cooldown_ms": 10000, "nightmare_cooldown_ms": 300000, "error_streak_pause_limit": 3}` |

None are required. Without `DREAMGRAPH_REPOS`, code/git tools will be unavailable. Without `DATABASE_URL`, the `query_db_schema` tool will be unavailable. Without `DREAMGRAPH_RUNTIME_ENDPOINT`, the `query_runtime_metrics` tool will return a configuration hint. The cognitive engine works regardless — it just has fewer senses.

---

## Architecture

```
                +--------------+
                |   MCP Layer  |
                | (43 tools)   |
                +------+-------+
                       |
        +--------------v--------------+
        |     Cognitive Engine        |
        |                             |
        |  AWAKE ──→ REM ──→ NORM ──→ AWAKE
        |    │                             |
        |    └──→ NIGHTMARE ──→ AWAKE      |
        |                             |
        |  - 7 dream strategies       |
        |  - 5 adversarial scans      |
        |  - Causal reasoning         |
        |  - Temporal analysis        |
        |  - Narrative synthesis       |
        |  - Intervention planning    |
        |  - Metacognitive tuning     |
        |  - Event-driven dreaming    |
        |  - Dream scheduling         |
        +--------------+--------------+
                       |
        +--------------v--------------+
        |        Memory Layer         |
        |                             |
        |  - Fact graph               |
        |  - Dream graph              |
        |  - Tension store            |
        |  - Resolution archive       |
        |  - Threat log               |
        |  - Dream archetypes         |
        |  - Meta log (self-tuning)   |
        |  - Event log                |
        |  - System story             |
        |  - Schedules (v5.2)         |
        +-----------------------------+
                       |
        +--------------v--------------+
        |        Senses Layer         |
        |                             |
        |  - Code / Git / DB / Web    |
        |  - Runtime metrics (APM)    |
        |  - Federation (import/      |
        |    export archetypes)       |
        +-----------------------------+
```

### Source Layout

```
src/
├── cognitive/              # The dreaming engine (the core)
│   ├── engine.ts           # State machine: AWAKE / REM / NORMALIZING / NIGHTMARE
│   ├── dreamer.ts          # 7 dream strategies for edge generation
│   ├── normalizer.ts       # Three-outcome classifier (validate/latent/reject)
│   ├── register.ts         # MCP tool + resource registration for cognitive layer
│   ├── types.ts            # All cognitive type definitions
│   ├── causal.ts           # Causal Reasoning Engine
│   ├── temporal.ts         # Temporal Dreaming (retro/precognition)
│   ├── adversarial.ts      # Adversarial Dreaming (NIGHTMARE state)
│   ├── federation.ts       # Multi-System Dream Federation
│   ├── narrator.ts         # Dream Narratives (system autobiography + continuous story)
│   ├── intervention.ts     # Intervention Engine (remediation plans)
│   ├── metacognition.ts    # Metacognitive Self-Tuning Engine
│   └── event-router.ts     # Event-Driven Dreaming (reactive cognition)
│   └── scheduler.ts        # Dream Scheduler — policy-driven orchestration (v5.2)
├── tools/                  # MCP tools (senses)
│   ├── code-senses.ts      # list_directory, read_source_code, create_file
│   ├── git-senses.ts       # git_log, git_blame
│   ├── web-senses.ts       # fetch_web_page
│   ├── db-senses.ts        # query_db_schema (any PostgreSQL database)
│   ├── runtime-senses.ts   # query_runtime_metrics (OpenTelemetry / Prometheus)
│   ├── solidify-insight.ts # solidify_cognitive_insight
│   ├── visual-architect.ts # generate_visual_flow (Mermaid diagrams)
│   ├── adr-historian.ts    # record/query/deprecate architecture decisions
│   ├── ui-registry.ts      # register/query UI elements, migration plans
│   ├── living-docs-exporter.ts # export_living_docs (Markdown generation)
│   ├── get-workflow.ts     # get_workflow
│   ├── search-data-model.ts # search_data_model
│   └── query-resource.ts   # query_resource
├── resources/              # MCP resources (read-only context)
├── config/                 # Environment-driven configuration
├── server/                 # MCP server bootstrap (stdio transport)
├── types/                  # Shared TypeScript type definitions
└── utils/                  # Logger, cache, error helpers
```

### Data Directory

```
data/
├── features.json           # Your system's features       (you populate)
├── data_model.json         # Your data entities            (you populate)
├── workflows.json          # Your workflows                (you populate)
├── system_overview.json    # High-level system description (you populate)
├── index.json              # Entity index                  (you populate)
├── capabilities.json       # Server self-description
├── dream_graph.json        # [runtime] Speculative edges from dreaming
├── tension_log.json        # [runtime] Detected contradictions and gaps
├── dream_history.json      # [runtime] Audit trail of dream cycles
├── candidate_edges.json    # [runtime] Normalization results
├── validated_edges.json    # [runtime] Promoted edges that passed the Truth Filter
├── adr_log.json            # [runtime] Architecture Decision Records
├── ui_registry.json        # [runtime] Semantic UI element registry
├── threat_log.json         # [runtime] Adversarial scan results (NIGHTMARE)
└── dream_archetypes.json   # [runtime] Federated dream archetypes
├── meta_log.json           # [runtime] Metacognitive analysis audit trail
├── event_log.json          # [runtime] Cognitive event dispatch log
├── system_story.json       # [runtime] Persistent system autobiography
└── schedules.json          # [runtime] Dream scheduler persistence (v5.2)```

---

## MCP Tools (43 total)

### Cognitive Tools (23)

| Tool | Description |
|---|---|
| `dream_cycle` | Run a full AWAKE → REM → NORMALIZING cycle with configurable strategy and dream count |
| `cognitive_status` | Current engine state, cycle count, graph stats, tension summary |
| `get_dream_insights` | Strongest hypotheses, clusters, active tensions, health assessment |
| `query_dreams` | Search/filter dream data by type, domain, confidence, status |
| `normalize_dreams` | Manually trigger normalization of dream artifacts |
| `resolve_tension` | Close a tension with authority (human/system), resolution type, and evidence |
| `clear_dreams` | Reset cognitive state with confirmation gate (preserves the knowledge graph) |
| `nightmare_cycle` | Run an adversarial scan: AWAKE → NIGHTMARE → AWAKE. Five vulnerability strategies |
| `get_causal_insights` | Discover cause→effect chains across dream history |
| `get_temporal_insights` | Analyze tension trajectories, predictions, seasonal patterns, retrocognition |
| `export_dream_archetypes` | Extract anonymized patterns for cross-project sharing |
| `import_dream_archetypes` | Import archetypes from another DreamGraph instance |
| `get_system_narrative` | Generate a coherent story of the system's evolving understanding |
| `get_remediation_plan` | Generate concrete fix plans for high-urgency tensions |
| `metacognitive_analysis` | Analyze DreamGraph's own performance: strategy precision/recall, promotion calibration, domain decay profiles. Optional auto-apply |
| `dispatch_cognitive_event` | Dispatch a cognitive event (git push, CI/CD signal, runtime anomaly, manual trigger) that classifies, scopes, and recommends a cognitive response |
| `get_system_story` | Read the persistent system autobiography — auto-accumulated diff chapters, weekly digests, health trends |
| `schedule_dream` | Create a scheduled cognitive action with trigger policy (interval, cron_like, after_cycles, on_idle) |
| `list_schedules` | List all schedules with status and execution summary |
| `update_schedule` | Modify an existing schedule’s trigger, action, or enabled state |
| `run_schedule_now` | Immediately execute a schedule, bypassing its trigger condition |
| `delete_schedule` | Permanently remove a schedule |
| `get_schedule_history` | Retrieve execution history for a schedule or all schedules |

### Sense Tools (12)

| Tool | Description |
|---|---|
| `list_directory` | Browse source code directories in configured repos |
| `read_source_code` | Read source files with optional line range |
| `create_file` | Create or overwrite files inside configured repos (auto-creates parent directories) |
| `git_log` | Commit history for a file or directory |
| `git_blame` | Per-line authorship for a file |
| `query_db_schema` | Live PostgreSQL schema queries: columns, constraints, indexes, foreign keys, RLS policies |
| `fetch_web_page` | Fetch and convert web pages to markdown |
| `solidify_cognitive_insight` | Persist a validated insight to the knowledge graph |
| `get_workflow` | Retrieve a specific workflow by ID |
| `search_data_model` | Search for a data entity by name |
| `query_resource` | Query features, workflows, or data model with filters |
| `query_runtime_metrics` | Fetch and correlate live runtime metrics (OpenTelemetry / Prometheus) |

### Documentation Intelligence Tools (8)

| Tool | Description |
|---|---|
| `generate_visual_flow` | Generate Mermaid.js diagrams from the knowledge graph. Six modes: workflow, feature_deps, data_flow, tension_map, domain_overview, ui_composition. Auto-simplification, dream edge overlay, tension markers |
| `record_architecture_decision` | Record an ADR with context, alternatives, consequences, and guard rails. Append-only, sequential IDs |
| `query_architecture_decisions` | Search ADRs by entity, tag, status, or free text. Returns matching decisions with optional guard rail warnings |
| `deprecate_architecture_decision` | Mark an ADR as deprecated with reason. Status-change only — the original record is preserved |
| `register_ui_element` | Register a semantic UI element with purpose, data contract, interaction model. Platform-independent. Merge-on-update |
| `query_ui_elements` | Search UI elements by category, purpose, platform, feature, or missing platform (instant migration checklist) |
| `generate_ui_migration_plan` | Gap analysis between source and target platforms with data contract summaries and complexity estimates |
| `export_living_docs` | Export the knowledge graph as structured Markdown for Docusaurus, Nextra, MkDocs, or plain GitHub. Stateless and idempotent |

### MCP Resources (15)

Read-only views the agent can inspect at any time:

| Resource | URI | Description |
|---|---|---|
| Dream Graph | `dream://graph` | Raw speculative edges and nodes with decay/TTL metadata |
| Candidates | `dream://candidates` | Three-outcome normalization judgments |
| Validated | `dream://validated` | Promoted edges that passed the Truth Filter |
| Status | `dream://status` | Full cognitive state introspection |
| Tensions | `dream://tensions` | Unresolved tension signals with urgency and domain |
| History | `dream://history` | Audit trail of every dream cycle |
| ADRs | `dream://adrs` | Architecture Decision Records with context, alternatives, and guard rails |
| UI Registry | `dream://ui-registry` | Semantic UI element definitions with data contracts and platform implementations |
| Threats | `dream://threats` | Adversarial scan results — threat edges with severity and CWE IDs |
| Archetypes | `dream://archetypes` | Federated dream archetypes — anonymized transferable patterns |
| Metacognition | `dream://metacognition` | Self-tuning audit trail — strategy metrics, calibration buckets, threshold recommendations |
| Events | `dream://events` | Cognitive event dispatch log — event classification, entity scoping, action outcomes |
| Story | `dream://story` | Persistent system autobiography — diff chapters, weekly digests, health trends |
| Schedules | `dream://schedules` | Active dream schedules with status and next run time (v5.2) |
| Schedule History | `dream://schedule-history` | Schedule execution history with outcomes (v5.2) |

---

## Dream Strategies

The dreamer uses 7 strategies to generate speculative edges:

| Strategy | What it does |
|---|---|
| **Gap Detection** | Finds entity pairs that share domain or keywords but have no direct edge |
| **Weak Reinforcement** | Finds weak edges and looks for indirect support via shared third-party connections |
| **Cross-Domain Bridging** | Connects entities from different domains that share keywords |
| **Missing Abstraction** | Detects entity clusters that would benefit from a unifying hub node |
| **Symmetry Completion** | Finds A→B edges where B→A is missing and proposes the reverse |
| **Tension-Directed** | Uses unresolved tensions (sorted by urgency) to focus dreaming on problem areas |
| **Causal Replay** | Mines dream history for cause→effect patterns and generates edges along discovered causal chains |

Strategies adapt over time. After 3 consecutive zero-yield cycles, a strategy is benched and its budget is redistributed to active strategies. Every 6th cycle it gets a probe run to check if conditions have changed.

---

## The Cognitive State Machine

DreamGraph operates through four cognitive states with strict transition rules:

```
                    ┌──────────────────────────────────┐
                    │                                  │
                    ▼                                  │
              ┌──────────┐                             │
              │  AWAKE   │─────────────┐               │
              └──────────┘             │               │
                    │                  │               │
              enterRem()         enterNightmare()      │
                    │                  │               │
                    ▼                  ▼               │
              ┌──────────┐      ┌───────────┐         │
              │   REM    │      │ NIGHTMARE │         │
              └──────────┘      └───────────┘         │
                    │                  │               │
          enterNormalizing()   wakeFromNightmare()     │
                    │                  │               │
                    ▼                  │               │
              ┌──────────────┐        │               │
              │ NORMALIZING  │────────┘               │
              └──────────────┘                        │
                    │                                  │
                  wake()                               │
                    │                                  │
                    └──────────────────────────────────┘
```

| State | Purpose | Safety |
|---|---|---|
| **AWAKE** | Idle, ready for commands | Only state that accepts external input |
| **REM** | Speculative dreaming — generates candidate edges | Cannot modify fact graph |
| **NORMALIZING** | Truth Filter — validates, promotes, or rejects dreams | Strict scoring gates |
| **NIGHTMARE** | Adversarial scanning — actively tries to find vulnerabilities | Read-only threat analysis |

An **interrupt** from any state returns safely to AWAKE with in-progress data quarantined.

---

## The Tension System

Tensions are signals that something in the knowledge graph needs attention:

- **Missing links** — two entities that should be connected but aren't
- **Contradictions** — conflicting information between entities
- **Weak spots** — connections with low confidence that need verification
- **Code insights** — issues discovered through direct source code inspection

### Tension Properties

| Property | Description |
|---|---|
| **Domain** | Auto-categorized: security, auth, api, data_model, sync, integration, invoicing, payroll, reporting, mobile, general |
| **Urgency** | Priority score that decays (-0.02/cycle). High-urgency tensions direct dreaming |
| **TTL** | Time-to-live in cycles (default 30). Expired tensions are auto-archived |
| **Resolution** | Closed by human or system with evidence, authority tracking, and optional recheck window |
| **Active cap** | Maximum 50 active tensions, enforced by urgency-ranked eviction |

### Resolution Types

| Type | Meaning |
|---|---|
| `confirmed_fixed` | The issue was real and has been addressed |
| `false_positive` | The Truth Filter verified this is not actually a problem |
| `wont_fix` | Acknowledged but intentionally left as-is |

---

## Normalization Pipeline (Truth Filter)

Every dream artifact passes through a scoring pipeline before classification.

### Scoring

| Factor | Weight | Signals |
|---|---|---|
| **Plausibility** | 0.45 | Domain coherence, keyword overlap, repo coherence, dreamer confidence |
| **Evidence** | 0.45 | Endpoint existence, domain overlap, keyword overlap, repo match |
| **Reinforcement** | bonus | +0.05 per re-discovery (max +0.10) |
| **Contradiction** | penalty | Missing endpoints, hard duplicates, type conflicts |

### Promotion Gate

| Threshold | Default |
|---|---|
| Combined confidence | >= 0.62 |
| Plausibility | >= 0.45 |
| Evidence | >= 0.40 |
| Evidence signals | >= 2 distinct |
| Contradiction ceiling | < 0.30 |
| Retention floor | >= 0.35 plausibility (below = rejected) |

---

## Example Behavior

After ~100 cycles, the system may:

- Detect multiple security issues across API routes
- Identify a shared root cause via **causal reasoning**
- Run a **nightmare scan** to find additional attack surfaces
- Propose **remediation plans** with file-level fixes
- Generate a **narrative** explaining how understanding evolved
- Validate fixes against code and database schema
- Resolve all related tensions with evidence
- **Export archetypes** so other projects learn from the pattern
- Shift focus to higher-level architectural improvements
- Power down when the system reaches a "healthy" state

---

## What You Should Expect

After a few cycles, DreamGraph will:

- detect inconsistencies in your system
- verify them against code and data
- resolve or discard them
- build a structured understanding of your architecture

After longer runs:

- critical issues converge to zero
- only low-confidence tensions remain
- the system reaches a stable "healthy" state
- **causal chains** reveal systemic patterns
- **temporal analysis** predicts where tensions will emerge next
- **system narratives** document the journey

---

## What This Is NOT

- Not a general AI agent
- Not a replacement for developers
- Not autonomous production code modification
- Not always correct (requires human validation)
- Not a chatbot

---

## Design Philosophy

> "The system should not just generate answers — it should learn when to stop thinking."

Core principles:

- **Curiosity with limits** — explores broadly but respects the active tension cap
- **Speculation with discipline** — dreams freely but validates with evidence
- **Memory with forgetting** — retains what matters, decays what doesn't
- **Autonomy with control** — runs independently but defers all decisions to humans
- **Adversarial honesty** — actively tries to break its own conclusions
- **Narrative coherence** — understanding should tell a story, not just accumulate data

---

## Vocabulary

This project introduces a cognitive model with the following primitives:

| Term | Meaning |
|---|---|
| **Tension** | An unresolved question, inconsistency, or hypothesis |
| **Dream Cycle** | A controlled speculative reasoning phase (AWAKE → REM → NORMALIZING) |
| **Nightmare Cycle** | An adversarial scan phase (AWAKE → NIGHTMARE → AWAKE) |
| **Truth Filter** | A validation pipeline grounded in real data — code, schema, graph structure |
| **Speculative Memory** | Unproven but retained hypotheses (latent edges in the dream graph) |
| **Resolution** | Evidence-based closure of a tension |
| **Decay / TTL** | Automatic forgetting of stale tensions and dream artifacts |
| **Active Set** | The top prioritized tensions currently driving reasoning |
| **Validated Edge** | A speculative connection that passed the Truth Filter and was promoted |
| **Dream Edge** | A speculative connection that has not yet been evaluated |
| **Threat Edge** | A vulnerability identified during adversarial scanning |
| **Causal Chain** | A discovered cause→effect sequence across entities |
| **Archetype** | An anonymized, transferable pattern extracted from validated knowledge |
| **Reinforcement** | When the dreamer re-discovers an existing connection, strengthening confidence |
| **Remediation Plan** | A concrete, step-by-step fix proposal generated from a tension |
| **System Narrative** | A coherent story of how understanding evolved over dream cycles |
| **Meta Log** | Audit trail of metacognitive self-analysis — strategy metrics, threshold recommendations |
| **Cognitive Event** | An external or internal signal that triggers reactive cognition |
| **System Story** | The persistent, auto-accumulated autobiography (diff chapters + weekly digests) |
| **Calibration Bucket** | A confidence range used to measure actual validation rates vs. thresholds |
| **Dream Schedule** | A policy-driven rule that triggers cognitive actions automatically (interval, cron, cycle-based, or idle-based) |

You can think of DreamGraph as:

- Tensions = questions
- Dream cycles = thinking
- Nightmare cycles = stress testing
- Truth filter = reality check
- Resolution = decision
- Narrative = memory
- Metacognition = self-improvement
- Events = reflexes
- System story = autobiography

---

## Technical Documentation

See [TDD_COGNITIVE_DREAMING.md](TDD_COGNITIVE_DREAMING.md) for the full technical design — state machine, dream strategies, normalization pipeline, tension system, and architecture decisions.

---

## Contributing

This is an experimental system. Contributions welcome in:

- Normalization strategies
- Graph modeling
- Tension heuristics
- Performance improvements
- Safety mechanisms
- New dream strategies
- Adversarial scan patterns
- Temporal analysis algorithms
- Federation protocols

---

## License

MIT — see [LICENSE](LICENSE).

---

> This project explores a simple idea:
>
> *What if software systems could think about themselves — but only believe what they can verify?*
