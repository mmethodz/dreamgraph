# DreamGraph — Autonomous Cognitive Layer for Software Systems

Traditional AI systems answer questions. DreamGraph reduces uncertainty over time — it finds, verifies, and resolves problems in your system autonomously.

A self-regulating AI cognitive layer that discovers, verifies, and resolves system-level insights through structured "dream cycles".

---

## Overview

DreamGraph is a cognitive layer for software systems that continuously discovers, verifies, and resolves problems using structured reasoning loops. It augments software development with:

- Autonomous reasoning loops
- Structured knowledge graphs
- Evidence-based validation
- Controlled speculative exploration ("dreaming")
- Self-cleaning memory via decay and resolution

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

- Explores relationships (analogy, gaps, symmetry, cross-domain)
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

This enables conclusions like:

> "I checked the code and DB — this is correct / already fixed."

### Tension Lifecycle

Tensions are not permanent. They:

- Decay over time (urgency -0.02/cycle)
- Expire via TTL (default 30 cycles)
- Can be resolved with evidence
- Are capped to maintain focus (max 50 active)

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

## Safety Model

- **Read-only by default** — no automatic code modification unless you enable write tools
- **External data is non-authoritative** — cannot override internal evidence
- **All outputs require human validation**
- **No write access without explicit permission**
- Strict separation of: facts, hypotheses, and beliefs

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
- Dream speculative connections using 6 strategies
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

None are required. Without `DREAMGRAPH_REPOS`, code/git tools will be unavailable. Without `DATABASE_URL`, the `query_db_schema` tool will be unavailable. The cognitive engine works regardless — it just has fewer senses.

---

## Architecture

```
                +--------------+
                |   MCP Layer  |
                | (tools/API)  |
                +------+-------+
                       |
        +--------------v--------------+
        |     Cognitive Engine        |
        |                             |
        |  - Dream cycles             |
        |  - Normalization            |
        |  - Tension management       |
        |  - Strategy selection       |
        +--------------+--------------+
                       |
        +--------------v--------------+
        |        Memory Layer         |
        |                             |
        |  - Fact graph               |
        |  - Dream graph              |
        |  - Tension store            |
        |  - Resolution archive       |
        +-----------------------------+
```

### Source Layout

```
src/
├── cognitive/          # The dreaming engine (the core)
│   ├── engine.ts       # State machine: AWAKE / REM / NORMALIZING
│   ├── dreamer.ts      # 6 dream strategies for edge generation
│   ├── normalizer.ts   # Three-outcome classifier (validate/latent/reject)
│   ├── register.ts     # MCP tool + resource registration for cognitive layer
│   └── types.ts        # All cognitive type definitions
├── tools/              # MCP tools (senses)
│   ├── code-senses.ts  # list_directory, read_source_code
│   ├── git-senses.ts   # git_log, git_blame
│   ├── web-senses.ts   # fetch_web_page
│   ├── db-senses.ts    # query_db_schema (any PostgreSQL database)
│   ├── solidify-insight.ts  # solidify_cognitive_insight
│   ├── get-workflow.ts      # get_workflow
│   ├── search-data-model.ts # search_data_model
│   └── query-resource.ts   # query_resource
├── resources/          # MCP resources (read-only context)
├── config/             # Environment-driven configuration
├── server/             # MCP server bootstrap (stdio transport)
├── types/              # Shared TypeScript type definitions
└── utils/              # Logger, cache, error helpers
```

### Data Directory

```
data/
├── features.json         # Your system's features       (you populate)
├── data_model.json       # Your data entities            (you populate)
├── workflows.json        # Your workflows                (you populate)
├── system_overview.json  # High-level system description (you populate)
├── index.json            # Entity index                  (you populate)
├── capabilities.json     # Server self-description
├── dream_graph.json      # [runtime] Speculative edges from dreaming
├── tension_log.json      # [runtime] Detected contradictions and gaps
├── dream_history.json    # [runtime] Audit trail of dream cycles
├── candidate_edges.json  # [runtime] Normalization results
└── validated_edges.json  # [runtime] Promoted edges that passed the Truth Filter
```

---

## MCP Tools (18 total)

### Cognitive Tools (7)

| Tool | Description |
|---|---|
| `dream_cycle` | Run a full AWAKE -> REM -> NORMALIZING cycle with configurable strategy and dream count |
| `cognitive_status` | Current engine state, cycle count, graph stats, tension summary |
| `get_dream_insights` | Strongest hypotheses, clusters, active tensions, health assessment |
| `query_dreams` | Search/filter dream data by type, domain, confidence, status |
| `normalize_dreams` | Manually trigger normalization of dream artifacts |
| `resolve_tension` | Close a tension with authority (human/system), resolution type, and evidence |
| `clear_dreams` | Reset cognitive state with confirmation gate (preserves the knowledge graph) |

### Sense Tools (11)

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

### MCP Resources (6)

Read-only views the agent can inspect at any time:

| Resource | URI | Description |
|---|---|---|
| Dream Graph | `dream://graph` | Raw speculative edges and nodes with decay/TTL metadata |
| Candidates | `dream://candidates` | Three-outcome normalization judgments |
| Validated | `dream://validated` | Promoted edges that passed the Truth Filter |
| Status | `dream://status` | Full cognitive state introspection |
| Tensions | `dream://tensions` | Unresolved tension signals with urgency and domain |
| History | `dream://history` | Audit trail of every dream cycle |

---

## Dream Strategies

The dreamer uses 6 strategies to generate speculative edges:

| Strategy | What it does |
|---|---|
| **Gap Detection** | Finds entity pairs that share domain or keywords but have no direct edge |
| **Weak Reinforcement** | Finds weak edges and looks for indirect support via shared third-party connections |
| **Cross-Domain Bridging** | Connects entities from different domains that share keywords |
| **Missing Abstraction** | Detects entity clusters that would benefit from a unifying hub node |
| **Symmetry Completion** | Finds A->B edges where B->A is missing and proposes the reverse |
| **Tension-Directed** | Uses unresolved tensions (sorted by urgency) to focus dreaming on problem areas |

Strategies adapt over time. After 3 consecutive zero-yield cycles, a strategy is benched and its budget is redistributed to active strategies. Every 6th cycle it gets a probe run to check if conditions have changed.

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
- Identify a shared root cause (e.g. missing RLS policies)
- Propose a structural fix
- Validate fixes against code and database schema
- Resolve all related tensions with evidence
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

---

## Vocabulary

This project introduces a cognitive model with the following primitives:

| Term | Meaning |
|---|---|
| **Tension** | An unresolved question, inconsistency, or hypothesis |
| **Dream Cycle** | A controlled speculative reasoning phase (AWAKE -> REM -> NORMALIZING) |
| **Truth Filter** | A validation pipeline grounded in real data — code, schema, graph structure |
| **Speculative Memory** | Unproven but retained hypotheses (latent edges in the dream graph) |
| **Resolution** | Evidence-based closure of a tension |
| **Decay / TTL** | Automatic forgetting of stale tensions and dream artifacts |
| **Active Set** | The top prioritized tensions currently driving reasoning |
| **Validated Edge** | A speculative connection that passed the Truth Filter and was promoted |
| **Dream Edge** | A speculative connection that has not yet been evaluated |
| **Reinforcement** | When the dreamer re-discovers an existing connection, strengthening confidence |

You can think of DreamGraph as:

- Tensions = questions
- Dream cycles = thinking
- Truth filter = reality check
- Resolution = decision

These terms make the model easy to understand and communicate. If this sticks, people will start saying things like:

- "What's your tension model?"
- "Do you run background dream cycles?"
- "How strict is your truth filter?"
- "Do you retain speculative memory?"

---

## Future Directions

- Multi-agent belief systems
- Dream coalition experiments
- Adaptive signal weighting
- AST-level code understanding
- Safe write operations (with human approval gates)
- IDE integration

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

---

## License

MIT — see [LICENSE](LICENSE).

---

> This project explores a simple idea:
>
> *What if software systems could think about themselves — but only believe what they can verify?*
