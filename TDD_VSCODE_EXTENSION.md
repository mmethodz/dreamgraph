# TDD: DreamGraph VS Code Extension — The DreamGraph Agent

**Version:** 0.1.0 (Base Design)  
**Target Release:** DreamGraph v7.0.0  
**Date:** 2026-04-09  
**Author:** Mika Jussila, Siteledger Solutions Oy  
**Status:** Planned  
**Predecessor:** DreamGraph v6.2.0 "La Catedral" (62 MCP tools, 25 resources, web dashboard, instance architecture, cli, daemon)

**Origin:** Every consumer agent so far — DevToys transcompiler, Copilot sessions, Claude sessions — reaches DreamGraph through the MCP layer. MCP is powerful for tool discovery, but generic MCP clients (Copilot, Cursor, Claude Desktop) have no awareness of DreamGraph's architectural rules. They can bypass ADR constraints, ignore UI consistency, violate the Three-Layer Model, and hallucinate knowledge that already exists in the graph. The extension closes this gap: **a DreamGraph-native client that mediates every interaction with the knowledge graph and the filesystem, ensuring architectural discipline from prompt to patch.**

---

## Executive Summary

DreamGraph today is a headless intelligence substrate. The `dg` CLI manages instances, the daemon exposes 62 MCP tools over stdio/HTTP, and the web dashboard provides observability. What is missing is a **first-party development interface** — one that understands DreamGraph's knowledge model, enforces its architectural rules, and makes the AI coding loop trustworthy.

This TDD proposes `dreamgraph-vscode`, a VS Code extension built on four pillars:

1. **Instance Connection** — discover, bind, and monitor DreamGraph daemon instances
2. **Context Management** — intentional, mode-aware context assembly (not dumb context stuffing)
3. **File I/O** — safe, preview-first file operations owned by the editor
4. **DreamGraph Integration** — commands, validation, and chat backed by the knowledge graph

The extension introduces a **third model role** (the *Architect model*) alongside the existing Dreamer and Normalizer, dedicated to coding-level synthesis and architectural reasoning within the extension.

### What This Replaces

| Current State | Extension State |
|---------------|-----------------|
| Agent calls MCP tools directly, may skip validation | Extension pre-checks every operation against ADRs and graph |
| Agent chooses which tools to call (often wrong) | Extension orchestrates the right tool sequence for the intent |
| Context is whatever the MCP client sends | Context is assembled by mode from editor state + graph knowledge |
| File writes happen silently via MCP | File writes require diff preview + user accept |
| No awareness of Three-Layer Model | Extension enforces layer boundaries at the prompt level |
| Agent may hallucinate APIs | Extension grounds responses against operational API surface |
| No UI consistency checks before coding | Extension warns when changes would violate UI registry patterns |
| Knowledge graph goes stale during development | Knowledge Feedback Loop (§8.2) keeps the graph current after every Architect interaction |

### Deliverables Summary

| Category | Count | Details |
|----------|-------|---------|
| Extension commands (v1) | 14 | Connect, Reconnect, Switch Instance, Show Status, Open Dashboard, Inspect Context (M1); Explain File, ADR Check (M2); Validate File, Suggest Next (M3); Open Chat, Set API Key (M5); Start Daemon, Stop Daemon (M1) |
| Extension commands (v1.1) | 4 | Explain selection, UI integrity check, impact analysis, related docs |
| New daemon endpoints | 4 | `/api/instance`, `/api/graph-context`, `/api/validate`, `/api/orchestrate` (v2 stub) |
| New data stores | 0 | Uses existing DreamGraph data exclusively |
| New MCP tools | 0 | Extension consumes existing tools — does not add new ones in v1 |
| VS Code UI contributions | 4 | Status bar, sidebar view, chat panel (webview), output channel |

### Document Structure

This TDD is organized in three parts:

| Part | Scope | Authority |
|------|-------|-----------|
| **Part I** (§1–16, Appendices A–B) | V1 specification | **Authoritative for implementation.** Testable, implementation-driving, no optional language. |
| **Part II** (§17–18) | V2 architecture targets | Non-authoritative for V1. Architectural direction, migration goals, contract candidates. |
| **Part III** (§19) | Migration notes | What in V1 is temporary, what moves daemon-side in V2, API compatibility constraints. |

> **Rule:** V2 is included to assess transition integrity, not to expand V1 scope. When V1 and V2 differ, V1 is authoritative for implementation. V2 content exists so reviewers can ask: *"Does V1 create clean handoff points into V2?"*

---

# Part I — V1 Specification

## 1. Architectural Foundation

### 1.1 Why Not Just Use MCP?

MCP is the right transport. It is **not** the right orchestration layer.

When Copilot uses DreamGraph via MCP, the flow is:

```
User prompt → Copilot LLM → tool_call(dream_cycle) → DreamGraph → result → Copilot LLM → response
```

The LLM decides which tools to call. It has no knowledge of:
- Which ADRs constrain the current file
- Which UI patterns apply to the component being edited
- Whether the graph already contains the answer (no tool call needed)
- Whether the proposed change violates the Three-Layer Model
- Which context mode would produce the best result

The extension flow is:

```
User prompt → Extension Context Engine → Architect LLM ⇄ MCP Tools → response
     ↑              ↓                         ↓    ↑                    ↓
  Editor state   Intent detection        Reasoning  Tool results   Grounded output
     ↑              ↓                         ↓    ↑                    ↓
  File system    Mode selection          Tool calls  MCP daemon     Diff preview
```

The extension provides initial context and the Architect actively orchestrates — calling MCP tools to read source code, query the graph, enrich data, record decisions, and maintain the knowledge graph. The Architect is the agent; the extension is the runtime.

> **Agentic tool loop:** The Architect receives MCP tool definitions and decides which tools to call based on user intent and context. The extension executes tool calls via the MCP client, feeds results back to the Architect, and repeats until the Architect produces a final text response. Up to 25 tool call rounds are permitted per interaction. The extension owns the execution runtime (tool dispatch, MCP connection, security) — the Architect owns the reasoning and tool selection.

### 1.2 Three-Layer Extension Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     dreamgraph-vscode Extension                     │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Layer 1: VS Code Integration                                 │  │
│  │                                                               │  │
│  │  Commands · Webviews · Status Bar · Workspace APIs            │  │
│  │  Diff Previews · Decorations · Output Channel · TreeViews     │  │
│  └───────────┬───────────────────────────────────┬───────────────┘  │
│              │                                   │                  │
│  ┌───────────▼───────────────────────────────────▼───────────────┐  │
│  │  Layer 2: Context Orchestration                               │  │
│  │                                                               │  │
│  │  EditorContextEnvelope · Intent Detection · Mode Selection    │  │
│  │  Tool Sequencing · ADR Pre-Check · UI Consistency Check       │  │
│  │  Token Budget · Response Grounding · Confidence Scoring       │  │
│  └───────────┬───────────────────────────────────┬───────────────┘  │
│              │                                   │                  │
│  ┌───────────▼───────────────────────────────────▼───────────────┐  │
│  │  Layer 3: DreamGraph Client                                   │  │
│  │                                                               │  │
│  │  HTTP Client · Instance Discovery · Health Monitoring         │  │
│  │  Tool/Resource Wrappers · Session Management · Auth (future)  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │ HTTP
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     DreamGraph Daemon (dg start)                     │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │ MCP      │  │ Dashboard│  │ Cognitive │  │ Knowledge Graph      │ │
│  │ Transport│  │ HTTP     │  │ Engine    │  │ (Fact/Op/Cognitive)  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Separation rule:** These three layers MUST remain independent from day one. Layer 1 never calls HTTP directly. Layer 3 never accesses VS Code APIs. Layer 2 is the bridge.

### 1.3 The Architect Model — Third Model Role

DreamGraph v6.2.0 has two configurable LLM roles:

| Role | Purpose | Configured via |
|------|---------|----------------|
| **Dreamer** | Speculative edge generation during dream cycles | `DREAMGRAPH_LLM_DREAMER_*` |
| **Normalizer** | Critical evaluation and validation of dream output | `DREAMGRAPH_LLM_NORMALIZER_*` |

The extension introduces a third:

| Role | Purpose | Configured via |
|------|---------|----------------|
| **Architect** | Code-level synthesis, explanation, and architectural reasoning in the extension | Extension settings (VS Code) |

**Why a separate model?**

- The Dreamer is optimized for creative speculation — wrong for precise code generation
- The Normalizer is optimized for critical evaluation — wrong for synthesis
- The Architect needs to be fast, code-fluent, and capable of following architectural constraints
- The user may want a different provider/model for interactive coding than for background dream cycles

**Model tier guidance:**

| Role | Recommended Tier | Examples | Rationale |
|------|-----------------|----------|-----------|
| **Architect** | High-capability ("frontier") | Claude Opus 4.6, GPT-4.1, Qwen3:235b | Code synthesis, architectural reasoning, multi-constraint adherence — benefits from the strongest available model |
| **Dreamer** | Mid-tier ("fast creative") | GPT-4o-mini, Claude Sonnet 4, Qwen3:32b | Speculative edge generation is exploratory; speed and cost matter more than peak accuracy |
| **Normalizer** | Budget-tier ("fast critical") | GPT-5.4-nano, GPT-4.1-nano, Qwen3:8b | Validation is binary (accept/reject) — doesn't need frontier reasoning; optimized for throughput and cost |

The Architect is the user-facing model and the **sole agent responsible for building, enriching, and maintaining the knowledge graph**. It powers the chat panel, generates code patches, explains architecture, validates against ADRs, and actively calls MCP tools to scan projects, enrich seed data, record decisions, register UI elements, and run dream cycles. Using a high-capability model here directly impacts developer experience and graph quality. Dreamer and Normalizer run in background cycles where throughput and cost efficiency are more important than peak quality.

> **Rule of thumb:** Spend the model budget on the Architect. The cognitive pipeline (Dreamer + Normalizer) can run on smaller, cheaper models without degrading DreamGraph's knowledge quality — the three-layer validation (speculate → critique → solidify) compensates for individual model limitations.

**v1 design (explicit expedient):** The Architect model is configured exclusively in the extension settings. It does NOT affect the daemon's Dreamer/Normalizer configuration. The extension calls the Architect model directly (via provider API), not through DreamGraph's LLM pipeline.

> **⚠ Split-brain tradeoff (acknowledged):** This creates a second AI runtime with its own provider config, auth, error handling, rate limiting, and privacy model — outside DreamGraph's instance-scoped control. This is accepted as a **temporary v1 expedient** for fastest iteration. The extension remains DreamGraph-native in orchestration (context assembly, tool sequencing, ADR/UI pre-checks) — only the model execution path is partially outside DreamGraph.

> **Architect interaction logging (v1 requirement):** Because the Architect runs outside the daemon's control, the extension MUST capture a local interaction log for every Architect call. This is the minimum governance layer until v2 restores daemon-side control.
>
> | Field | Content |
> |-------|--------|
> | `timestamp` | ISO-8601 |
> | `provider` | Selected provider name |
> | `model` | Selected model name |
> | `intent_mode` | Intent classification for this interaction |
> | `tools_consulted` | DreamGraph tools/resources queried during context assembly |
> | `prompt_tokens` | Approximate input token count (from provider response headers if available) |
> | `completion_tokens` | Approximate output token count |
> | `duration_ms` | Wall-clock time from request to last streamed chunk |
> | `warnings_count` | Number of pre-check warnings surfaced |
> | `error` | Error message if the call failed, `null` otherwise |
>
> **Storage:** VS Code `OutputChannel` named "DreamGraph Architect" (human-readable, scrollable) + structured JSON lines written to `{masterDir}/architect_log.jsonl` (machine-readable, rotated at 10MB). No conversation content or code is logged — only metadata. This provides an audit trail without privacy risk.

**v2 target (daemon-side Architect):** Move Architect orchestration behind `POST /api/orchestrate` on the daemon. Add Architect as a third daemon-side model role, configurable via `DREAMGRAPH_LLM_ARCHITECT_*` and the dashboard `/config` page. The extension sends the assembled context envelope to the daemon, which calls the Architect model, applies constraints, and streams the response back. Extension retains a local override option as an explicit developer mode. This restores full instance-scoped control over all three model roles.

### 1.4 Communication Protocol

The extension communicates with the daemon over HTTP. Two protocols coexist:

| Protocol | Use Case | Endpoint |
|----------|----------|----------|
| **MCP (JSON-RPC over Streamable HTTP)** | Tool calls, resource reads | `POST/GET/DELETE /mcp` |
| **REST (dashboard HTTP)** | Health, status, config, orchestration | `GET /health`, `GET /status`, etc. |

The extension uses **both**:
- MCP for structured tool invocations (`query_resource`, `cognitive_status`, `query_api_surface`, etc.)
- REST for health checks, status polling, and the new orchestration endpoints

**Session management:** The extension maintains a persistent MCP session (via `mcp-session-id` header) for the lifetime of the connection. Reconnection creates a new session.

---

## 2. Pillar 1: Instance Connection

### 2.1 The Problem

DreamGraph instances are UUID-isolated. Each instance has its own data directory, project binding, daemon process, and port. The extension must:

1. Discover available instances
2. Match the current workspace to the correct instance
3. Connect to the running daemon (or offer to start one)
4. Monitor connection health continuously

### 2.2 Instance Discovery

**Discovery chain** (in priority order):

1. **Workspace setting** — `dreamgraph.instanceUuid` in `.vscode/settings.json`
2. **Project root match** — scan master registry (`~/.dreamgraph/instances.json`) for an instance whose `project_root` matches the current workspace folder
3. **Environment variable** — `DREAMGRAPH_INSTANCE_UUID`
4. **Manual selection** — user picks from instance list via quick pick

```typescript
/** Instance operating mode — imported from daemon's InstanceScope */
type InstanceMode = "development" | "staging" | "production" | "archive";

/** Instance lifecycle status — imported from daemon's InstanceScope */
type InstanceStatus = "active" | "paused" | "error" | "initializing";

interface ResolvedInstance {
  uuid: string;
  name: string;
  project_root: string | null;
  mode: InstanceMode;
  status: InstanceStatus;
  daemon: {
    running: boolean;
    pid: number | null;
    port: number | null;
    transport: "http" | "stdio";
    version: string | null;
  };
  source: "workspace_setting" | "project_match" | "env_var" | "manual";
}
```

### 2.3 Connection Lifecycle

```
Extension activates
        │
        ▼
  Resolve instance (§2.2 chain)
        │
        ├── Found + daemon running ──► Connect (health check + MCP session)
        │                                     │
        │                                     ├── Healthy ──► Status: Connected ✓
        │                                     └── Unhealthy ──► Status: Degraded ⚠
        │
        ├── Found + daemon stopped ──► Offer "Start daemon?" notification
        │                                     │
        │                                     ├── Yes ──► `dg start <uuid> --http`
        │                                     └── No ──► Status: Disconnected
        │
        └── Not found ──► Offer "Create instance?" or "Connect manually"
                                │
                                ├── Create ──► `dg init --project <workspace>`
                                └── Manual ──► Quick pick from registry
```

### 2.4 Health Monitoring

The extension polls `GET /health` at a configurable interval (default: 10 seconds).

```typescript
interface HealthState {
  status: "connected" | "degraded" | "disconnected" | "connecting";
  lastCheck: Date;
  latencyMs: number;
  cognitiveState: string;      // "AWAKE" | "REM" | "NORMALIZING" | "NIGHTMARE" | "LUCID"
  sessions: number;
  llmAvailable: boolean;
  instanceUuid: string;
}
```

**Health transitions:**

| From | To | Trigger |
|------|----|---------|
| `disconnected` | `connecting` | User connects or auto-reconnect |
| `connecting` | `connected` | Health check passes |
| `connecting` | `disconnected` | Health check fails after 5 retries |
| `connected` | `degraded` | Health check returns degraded (LLM unavailable, etc.) |
| `connected` | `disconnected` | Health check fails 3 consecutive times |
| `degraded` | `connected` | Health check returns healthy |
| `disconnected` | `connecting` | Auto-reconnect timer (30s) or manual reconnect |

### 2.5 Status Bar

```
┌──────────────────────────────────────┐
│ $(dreamgraph-icon) DG: my-project ✓ │  ← connected
│ $(dreamgraph-icon) DG: my-project ⚠ │  ← degraded
│ $(dreamgraph-icon) DG: disconnected  │  ← no connection
│ $(dreamgraph-icon) DG: connecting…   │  ← connecting
└──────────────────────────────────────┘
```

**Click action:** Opens quick pick with connection commands (reconnect, switch instance, open dashboard, show status).

### 2.6 Commands

| Command | ID | Description |
|---------|----|-------------|
| Connect Instance | `dreamgraph.connect` | Resolve and connect to DreamGraph instance |
| Reconnect | `dreamgraph.reconnect` | Force reconnect to current instance |
| Switch Instance | `dreamgraph.switchInstance` | Pick from registry, rebind workspace |
| Show Status | `dreamgraph.showStatus` | Open status panel with full instance details |
| Open Dashboard | `dreamgraph.openDashboard` | Open web dashboard in browser or Simple Browser |
| Start Daemon | `dreamgraph.startDaemon` | Run `dg start` for current instance |
| Stop Daemon | `dreamgraph.stopDaemon` | Run `dg stop` for current instance |

#### 2.6.1 `dreamgraph.showStatus` Flow

**Output:** Formatted instance details in a dedicated Output Channel panel (`DreamGraph: Instance Status`).

```
User invokes "Show Status"
        │
        ▼
  Fetch HealthState (§2.4) + ResolvedInstance (§2.2)
        │
        ▼
  Format status document:
    ┌─────────────────────────────────────────┐
    │ DreamGraph Instance Status              │
    │ ─────────────────────────────────────── │
    │ Name:        my-project                 │
    │ UUID:        abc-123-…                  │
    │ Mode:        development                │
    │ Status:      connected ✓                │
    │ Daemon PID:  12345                      │
    │ Port:        8100                       │
    │ Transport:   http                       │
    │ Version:     6.2.0                      │
    │ Latency:     12ms                       │
    │ Cognitive:   AWAKE                      │
    │ Sessions:    2                          │
    │ LLM:         available                  │
    │ Source:      project_match              │
    │ Operational: Stage 3 of 4              │
    └─────────────────────────────────────────┘
        │
        ▼
  Show in Output Channel (reveal + focus)
```

**Why Output Channel (not webview):** Status is read-only text. An Output Channel is lighter, searchable, copy-able, and testable. No webview overhead for static display.

#### 2.6.2 `dreamgraph.switchInstance` Flow

```
User invokes "Switch Instance"
        │
        ▼
  Read master registry (~/.dreamgraph/instances.json)
        │
        ▼
  Build Quick Pick list:
    ┌────────────────────────────────────────────────┐
    │  $(star) my-project (connected)       abc-123  │
    │  $(repo) other-project (stopped)      def-456  │
    │  $(repo) experiments (stopped)        ghi-789  │
    └────────────────────────────────────────────────┘
        │
        ├── User picks an instance ──►
        │     1. Disconnect from current instance (close MCP session)
        │     2. Update `dreamgraph.instanceUuid` in workspace settings
        │     3. Run discovery chain (§2.2) for the new UUID
        │     4. If daemon running → connect + health check
        │     5. If daemon stopped → offer "Start daemon?" notification
        │     6. Update status bar, sidebar, and output channel
        │
        └── User cancels ──► No change
```

**Quick Pick details:**
- Current instance is marked with `$(star)` icon and "(connected)" suffix
- Stopped instances show "(stopped)" — selecting one triggers the start-daemon flow (§2.3)
- Each item shows instance name + truncated UUID
- Items are sorted: running instances first, then alphabetical

#### 2.6.3 `dreamgraph.startDaemon` / `dreamgraph.stopDaemon` Flow

```
User invokes "Start Daemon"
        │
        ├── Instance resolved? ──►
        │     1. Run `dg start <uuid> --http` via child_process
        │     2. Show progress notification: "Starting DreamGraph daemon…"
        │     3. Poll /health until responsive (timeout: 15s)
        │     4. On success → connect (§2.3 flow)
        │     5. On timeout → show error: "Daemon did not start within 15s"
        │
        └── No instance? ──► Show error: "No instance bound to workspace"
```

```
User invokes "Stop Daemon"
        │
        ├── Daemon running? ──►
        │     1. Run `dg stop <uuid>` via child_process
        │     2. Update status → disconnected
        │     3. Show notification: "DreamGraph daemon stopped"
        │
        └── Daemon not running? ──► Show info: "Daemon is not running"
```

---

## 3. Pillar 2: Context Management

### 3.1 The Problem

Generic AI assistants (Copilot, Cursor, etc.) use a "context stuffing" approach: gather as many files as possible, concatenate them, and hope the LLM finds what it needs. This fails with DreamGraph because:

- The knowledge graph already organizes information by domain, relationship, and confidence level
- Architectural decisions (ADRs) constrain what valid implementations look like
- UI consistency rules exist that file-level context cannot express
- Dream state, tensions, and insights provide guidance that raw files cannot

The extension needs **intentional context assembly** — choosing what to include based on the user's intent, not just proximity.

### 3.2 The Context Envelope

Every interaction with DreamGraph or the Architect LLM starts with a context envelope:

```typescript
interface EditorContextEnvelope {
  /** Workspace identity */
  workspaceRoot: string;
  instanceId: string | null;

  /** Active editor state */
  activeFile: {
    path: string;                    // relative to workspace root
    languageId: string;
    lineCount: number;
    cursorLine: number;
    cursorColumn: number;
    selection: {
      startLine: number;
      endLine: number;
      text: string;
    } | null;
  } | null;

  /** Broader editor state */
  visibleFiles: string[];            // paths of all visible editors
  changedFiles: string[];            // files with unsaved changes
  pinnedFiles: string[];             // user-pinned context files

  /** DreamGraph knowledge (populated by orchestration layer) */
  graphContext: {
    relatedFeatures: string[];       // feature IDs relevant to active file
    relatedWorkflows: string[];      // workflow IDs relevant to active file
    applicableAdrs: string[];        // ADR IDs that constrain this area
    uiPatterns: string[];            // UI registry patterns for this component
    activeTensions: number;          // count of unresolved tensions
    cognitiveState: string;          // current engine state
    apiSurface: object | null;       // relevant API surface entries
  } | null;

  /** Intent classification */
  intentMode: IntentMode;
  intentConfidence: number;          // 0.0–1.0
}

type IntentMode =
  | "selection_only"       // user asks about selected code
  | "active_file"          // user asks about current file
  | "ask_dreamgraph"       // question requires graph knowledge
  | "manual";              // user explicitly chose context

// v1.5 additions (deferred — add after core modes are stable):
// | "current_feature"      // question spans a feature boundary
// | "workspace_local"      // question about project structure
```

> **Scope note (v1):** Four modes only. `current_feature` and `workspace_local` are deferred to v1.5 because they depend on high-quality index data and graph connectivity that may not be present in early deployments. The four v1 modes cover >80% of interactions.

> **Lazy graphContext:** The `graphContext` field is populated lazily — only when the intent mode requires graph knowledge (`ask_dreamgraph`, or when ADR/UI pre-checks are triggered). For `selection_only` mode, `graphContext` stays `null` to avoid unnecessary MCP calls.

### 3.3 Intent Detection

The orchestration layer classifies user intent before assembling context:

| Signal | Intent | Context Strategy |
|--------|--------|-----------------|
| Selection active + short question | `selection_only` | Selected text + immediate file context |
| No selection + "this file" / "here" / file-scoped language | `active_file` | Full active file + imports + related tests |
| Feature/component name mentioned | `current_feature` | Query `system://features` + related files from index |
| "project" / "architecture" / "how does X connect to Y" | `ask_dreamgraph` | Graph query: features, workflows, tensions, ADRs |
| Broad structural question | `workspace_local` | File tree + system overview + data model |
| User picks context mode from UI | `manual` | User-specified context subset |

**Intent detection is heuristic, not LLM.** The extension uses keyword matching + editor state analysis. No extra LLM call for classification in v1.

> **Iteration expectation:** Keyword-based heuristics will misclassify edge cases — especially when queries span multiple intents ("explain this selection *in the context of* the user workflow"). This is acceptable for v1. Mitigations:
>
> - The **mode indicator** in the sidebar (§6.1) and chat header always shows the detected mode, making classification visible
> - The **manual override** (`manual` mode) lets users correct misclassification immediately
> - v1.1 may introduce confidence thresholds: when heuristic confidence < 0.6, prompt the user to confirm the detected mode instead of guessing
>
> Do not invest in LLM-based intent classification until empirical data shows which cases the heuristic fails on.

### 3.4 Context Assembly Pipeline

```
User prompt + Editor state
        │
        ▼
  Intent Detection (heuristic)
        │
        ▼
  Mode Selection (intentMode)
        │
        ├── selection_only ──► { selection text, file header, imports }
        │
        ├── active_file ──► { full file, imports, related tests, API surface }
        │
        ├── ask_dreamgraph ──► { graph query results, tensions, dream insights }
        │
        ├── manual ──► { user-pinned files + selected context }
        │
        ├── current_feature ──► v1.5: { feature metadata, related files, workflows, ADRs }
        │
        └── workspace_local ──► v1.5: { file tree, system overview, data model summary }
        │
        ▼
  Pre-Check Layer
        │
        ├── ADR compliance scan (do any ADRs constrain this area?)
        ├── UI consistency scan (does this touch UI registry components?)
        └── API surface lookup (are relevant signatures available?)
        │
        ▼
  Assembled EditorContextEnvelope
        │
        ▼
  Architect LLM call (with envelope as structured context)
```

### 3.5 DreamGraph Knowledge Integration

For `current_feature` and `ask_dreamgraph` modes, the extension calls DreamGraph tools to populate `graphContext`:

| Need | DreamGraph Tool/Resource | When |
|------|-------------------------|------|
| Related features | `query_resource(type="feature")` + index lookup by file path | Active file known |
| Related workflows | `query_resource(type="workflow")` | Feature identified |
| Applicable ADRs | `query_architecture_decisions(status="accepted")` | Always for code questions |
| UI patterns | `query_ui_elements(file=<path>)` | File touches UI components |
| Active tensions | `cognitive_status()` → `tensions.active` | Always (cheap) |
| Cognitive state | `cognitive_status()` → `state` | Always (cheap) |
| API surface | `query_api_surface(symbol_name=<cursor_symbol>)` | Symbol under cursor known |
| Graph RAG context | `graph_rag_retrieve(query=<user_query>, mode="comprehensive")` | `ask_dreamgraph` mode or graph-heavy queries |
| Cognitive preamble | `get_cognitive_preamble(maxTokens=2000)` | Always when cognitive context is needed |
| Lucid session state | `dream://lucid` resource | Engine is in LUCID state |

### 3.6 Context Inspector

The context envelope is always inspectable. The extension provides an output channel (`DreamGraph Context`) that shows:

```
[2026-04-09T14:22:01Z] Intent: active_file (confidence: 0.85)
[2026-04-09T14:22:01Z] Active file: src/ui/layouts.py (Python, line 142)
[2026-04-09T14:22:01Z] Graph context:
  - Features: F-012 (UI Layout System), F-015 (Theme Engine)
  - ADRs: ADR-008 (Layout consistency), ADR-012 (No inline styles)
  - UI patterns: UIStack, UIGrid, UICard (3 elements)
  - Tensions: 2 active
  - Cognitive state: AWAKE
  - Graph RAG: 3 relevant subgraph fragments (1,200 tokens)
  - Cognitive preamble: included (800 tokens)
[2026-04-09T14:22:01Z] Token budget: 4,200 / 8,000
```

### 3.7 Token Budget and Trimming

The context envelope has a finite token budget (model-dependent, typically 8,000–32,000 tokens for the context portion). When the assembled context exceeds the budget, sections are trimmed in **reverse priority order** — lowest priority is dropped first:

| Priority | Section | Rationale |
|----------|---------|----------|
| 1 (highest) | Selection text | The user explicitly selected this — it's the focal point |
| 2 | Active file (visible range + function scope) | Immediate editing context |
| 3 | ADRs (applicable to this area) | Architectural constraints must be honored — dropping them risks violations |
| 4 | API surface (relevant symbols) | Needed for accurate code generation |
| 5 | UI registry patterns | Needed for UI consistency checks |
| 6 | Related features / workflows | Graph enrichment — valuable but non-critical for correctness |
| 7 | Active tensions | Background signal — least impact if dropped |
| 8 (lowest) | System overview / cognitive state | Ambient context — trim first |

**Trimming rules:**

1. **Never truncate mid-structure.** Drop an entire section before partially including it. A half-included ADR is worse than no ADR.
2. **Active file trimming:** If the full file exceeds budget, include: (a) the function/class containing the cursor, (b) import block, (c) file header (first 20 lines). Drop the rest.
3. **ADR trimming:** If multiple ADRs apply, keep by relevance score (from `/api/graph-context`). Drop lowest-relevance ADRs first.
4. **Budget is logged.** The context inspector (§3.6) always shows `used / total` so the user (and future diagnostics) can see what was included and what was trimmed.
5. **Trimmed sections are noted.** When sections are dropped, the assembled prompt includes a note: `[Context note: {N} features, {M} workflows trimmed due to token budget]` — so the Architect knows its context is incomplete rather than hallucinating about absent information.
6. **Token counting method.** Token counts are estimated using the `chars / 4` heuristic (1 token ≈ 4 characters). This is intentionally simple — exact tokenization varies by model and adds a heavy dependency for marginal accuracy gain. The heuristic errs on the conservative side (overestimates token count), which is preferable to under-counting and exceeding the context window. If a provider returns `prompt_tokens` in its response, the extension logs the actual vs. estimated count for future calibration.
7. **Detail-level reduction before section dropping (Stage 3+).** When the `detail_level` parameter is available on query tools (§14.4.5), the trimming pipeline first reduces API surface from `"full"` → `"signatures_only"` and features from `"full"` → `"summary"` before dropping entire sections. This preserves section coverage while reducing token consumption. See §14.4.5 for measured savings.

---

## 4. Pillar 3: File I/O

### 4.1 Design Principles

The extension is the **sole authority** over file mutation in the DreamGraph-assisted workflow. The daemon can recommend, generate, and validate — but it never writes files itself.

**Invariant: The extension owns the pen.**

| Operation | Allowed | Mechanism |
|-----------|---------|-----------|
| Read active file | ✓ | VS Code `TextDocument` API |
| Read selection | ✓ | VS Code `TextEditor.selection` API |
| Read related files | ✓ | VS Code `workspace.openTextDocument()` for files within project root |
| Create file | ✓ | After diff preview + user accept |
| Replace selection | ✓ | After diff preview + user accept |
| Apply patch to file | ✓ | After diff preview + user accept |
| Open referenced file | ✓ | Direct navigation via `vscode.window.showTextDocument()` |
| Silent mutation | ✗ | **Never.** Every write shows a diff first. |
| Background code writes | ✗ | **Never.** No write without user in the loop. |
| Cross-workspace writes | ✗ | **Never.** Bounded to current instance's project root. |
| Write outside project root | ✗ | **Never.** Extension checks `InstanceScope.isProjectPath()`. |

### 4.2 Read Operations

```typescript
interface FileReadService {
  /** Read the active editor's full content. */
  readActiveFile(): Promise<FileContent | null>;

  /** Read the current selection. */
  readSelection(): Promise<SelectionContent | null>;

  /** Read a specific file by path (must be within project root). */
  readFile(relativePath: string): Promise<FileContent>;

  /** Read multiple files (batch, for context assembly). */
  readFiles(relativePaths: string[]): Promise<FileContent[]>;

  /** Get the symbol under the cursor (if available from VS Code's symbol provider). */
  getSymbolAtCursor(): Promise<SymbolInfo | null>;
}

interface FileContent {
  path: string;            // relative to workspace root
  languageId: string;
  content: string;
  lineCount: number;
}

interface SelectionContent extends FileContent {
  startLine: number;
  endLine: number;
  selectedText: string;
}

interface SymbolInfo {
  name: string;
  kind: string;            // "class" | "function" | "method" | "property" | etc.
  containerName: string | null;
  range: { startLine: number; endLine: number };
}
```

### 4.3 Write Operations

All write operations follow the **preview-first** pattern:

**Invariant: Patches must be best-effort but never partial-silent.** If a patch cannot apply cleanly (e.g., the target lines have changed since the patch was generated), the user MUST see the failure before any write happens. The extension never silently applies a partial patch and discards the rest.

#### 4.3.1 Diff Preview Implementation

The diff preview uses VS Code's built-in diff editor via virtual documents:

1. **Virtual document provider:** The extension registers a `TextDocumentContentProvider` for the `dreamgraph-proposed` URI scheme. This provider serves the proposed content (new file or modified content) as a read-only virtual document.
2. **Diff display:** The extension calls `vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, title)` to open the side-by-side diff editor.
3. **User action:** Accept/reject is handled via custom editor actions injected into the diff view toolbar.
4. **Apply:** On accept, the extension uses `WorkspaceEdit` API (`vscode.workspace.applyEdit`) to apply the changes atomically.

```typescript
// Virtual document registration
const proposedProvider = new class implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();

  onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this.onDidChangeEmitter.event;

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }
};

vscode.workspace.registerTextDocumentContentProvider('dreamgraph-proposed', proposedProvider);
```

#### 4.3.2 Failed Patch UX

When a patch cannot apply cleanly:

```
Patch application attempt
        │
        ├── Lines match expected content ──► Apply normally (diff preview)
        │
        └── Lines do NOT match (stale context, concurrent edit) ──►
              │
              1. Show error notification:
                 "⚠ Patch failed: target lines have changed since generation"
              2. Open a 3-way view:
                 - Left: expected original (what the patch assumed)
                 - Center: actual file content
                 - Right: proposed change
              3. User options:
                 - "Regenerate" → re-run the Architect with fresh file content
                 - "Apply Anyway" → force apply with a warning (user takes responsibility)
                 - "Dismiss" → discard the patch
              4. Log the failure in the interaction log (file, reason, patch hash)
```

**Partial patch rule:** If a multi-hunk patch has some hunks that apply and some that don't, NONE are applied. The user sees which hunks failed and can choose to regenerate. This enforces the "never partial-silent" invariant.

```
DreamGraph generates code / patch
        │
        ▼
  Extension receives proposed change
        │
        ▼
  Show diff preview (VS Code diff editor)
        │
        ├── User accepts ──► Apply change via workspace edit API
        │
        ├── User modifies ──► User edits in diff view, then accepts
        │
        └── User rejects ──► Discard, no file change
```

```typescript
interface FileWriteService {
  /** Show a diff preview for a proposed new file. */
  previewNewFile(relativePath: string, content: string, title?: string): Promise<boolean>;

  /** Show a diff preview for a proposed edit to an existing file. */
  previewEdit(relativePath: string, newContent: string, title?: string): Promise<boolean>;

  /** Show a diff preview for a selection replacement. */
  previewSelectionReplace(newText: string, title?: string): Promise<boolean>;

  /** Apply a structured patch (array of line-range replacements). */
  previewPatch(relativePath: string, patches: Patch[], title?: string): Promise<boolean>;

  /** Open a file at a specific line/column (navigation, no mutation). */
  openFileAtLocation(relativePath: string, line: number, column?: number): Promise<void>;

  // Return value semantics for all preview* methods:
  // - `true`  → user accepted the diff (file was written)
  // - `false` → user dismissed the diff (no file change)
  // The Promise resolves when the diff tab is closed, not when it opens.
}

interface Patch {
  startLine: number;
  endLine: number;
  replacement: string;
  explanation?: string;    // shown in diff title
}
```

### 4.4 Scope Enforcement

Every file operation checks boundaries:

```typescript
function assertWithinProjectRoot(absolutePath: string): void {
  const projectRoot = getConnectedInstance()?.project_root;
  if (!projectRoot) throw new Error("No project root bound to instance");

  const resolved = path.resolve(absolutePath);
  if (!resolved.startsWith(path.resolve(projectRoot))) {
    throw new ScopeViolationError(
      `Path ${resolved} is outside project root ${projectRoot}`
    );
  }
}
```

This mirrors `InstanceScope.isProjectPath()` on the daemon side, enforced again on the extension side as defense-in-depth.

#### 4.4.1 Error Types

```typescript
/** Thrown when a file operation targets a path outside the instance project root. */
class ScopeViolationError extends Error {
  constructor(
    public readonly requestedPath: string,
    public readonly projectRoot: string,
  ) {
    super(`Path ${requestedPath} is outside project root ${projectRoot}`);
    this.name = 'ScopeViolationError';
  }
}

/** Thrown when a patch cannot apply because target lines have changed. */
class PatchConflictError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly failedHunks: number,
    public readonly totalHunks: number,
  ) {
    super(`Patch conflict: ${failedHunks}/${totalHunks} hunks failed on ${filePath}`);
    this.name = 'PatchConflictError';
  }
}
```

### 4.5 MCP Tool Call Failure Handling

Every MCP tool call and REST endpoint call made by the extension follows a uniform failure handling strategy:

| Failure Type | Detection | Response | User Feedback |
|--------------|-----------|----------|---------------|
| Network error (ECONNREFUSED, timeout) | HTTP client throws | Mark health state `disconnected`; abort current command | Status bar → disconnected; notification: "DreamGraph connection lost" |
| MCP error response (`isError: true`) | MCP SDK returns error content | Log full error to Output Channel; fall through to degraded behavior | Notification with error summary + "Show Output" action |
| HTTP 4xx (client error) | Status code check | Do not retry; log and surface | Notification: "{command} failed: {error.message}" |
| HTTP 5xx (server error) | Status code check | Retry once after 2s; if still failing, abort | Notification: "DreamGraph server error — retried once" |
| Response timeout (>30s) | AbortController timeout | Abort request; do not retry | Notification: "Request timed out" |
| Malformed response (unexpected shape) | Type guard / schema check | Log full response to Output Channel; treat as failure | Notification: "Unexpected response from DreamGraph" |

**Retry policy:** Only HTTP 5xx errors are retried, and only once, with a 2-second delay. MCP tool errors, client errors, and timeouts are not retried — they indicate a logic or configuration problem, not a transient issue. The health monitor handles reconnection separately (§2.4).

**Degraded behavior:** When an MCP tool call fails during context assembly (e.g., `query_architecture_decisions` returns an error), the extension:
1. Logs the failure
2. Omits that context section from the assembled envelope
3. Adds a note to the Architect prompt: `[Context note: ADR query failed — architectural constraints may be missing]`
4. Proceeds with the remaining context rather than aborting the entire operation

This ensures partial results are still useful. The alternative — aborting the entire command — would make the extension fragile during daemon upgrades or partial outages.

---

## 5. Pillar 4: DreamGraph Integration

### 5.1 Command-First, Chat-Second

The extension launches with **commands**, not chat. Commands are:
- Discoverable (command palette)
- Testable (deterministic input → output)
- Buildable incrementally (one command at a time)
- Validatable (each command exercises a specific integration path)

Chat comes later, built on proven command foundations.

### 5.2 v1 Commands

> **Scope discipline:** v1 ships seven DreamGraph-native commands (plus connection commands from §2.6). These seven were chosen because each exercises a distinct integration path and produces measurable value independently. Additional commands (`explainSelection`, `checkUiIntegrity`, `impactAnalysis`, `openRelatedDocs`) are deferred to v1.1 — after the first command loop is stable.

#### 5.2.1 `dreamgraph.explainFile`

**Purpose:** Explain the current file in the context of the knowledge graph.

**Flow:**
1. Read active file content
2. Query `system://features` and `index.json` to find features/workflows containing this file
3. Query `system://capabilities` for relevant capabilities
4. Query `query_architecture_decisions` for ADRs affecting this area
5. Assemble context envelope (mode: `active_file`)
6. Call Architect LLM with structured prompt:
   - "Explain this file's role in the system. Reference specific features, workflows, and architectural decisions."
7. Show result in output panel (if invoked via command palette) or inline in chat panel (if chat is open and focused)

**Output destination rule (applies to all commands):** If the chat panel is open *and* focused when a command is invoked, the result is rendered as a chat message. Otherwise, the result is shown in the DreamGraph Output Channel. The user can always copy output between panels.

**Why this is DreamGraph-native:** The explanation is grounded in the knowledge graph, not just the file content. A generic LLM would explain syntax. This explains *purpose within the system*.

#### 5.2.2 `dreamgraph.explainSelection` *(v1.1)*

**Purpose:** Explain selected code in system context.

**Deferred rationale:** Depends on `explainFile` being stable. Same integration path but scoped to selection with additional symbol lookup.

#### 5.2.3 `dreamgraph.checkAdrCompliance`

**Purpose:** Check if the current file complies with accepted architectural decisions.

**Flow:**
1. Read active file
2. Query `query_architecture_decisions(status="accepted")` for all active ADRs
3. Filter to ADRs relevant to this file's domain (keyword matching + index lookup)
4. Call Architect LLM with: file content + applicable ADR texts + prompt "Identify any violations of these architectural decisions in this code."
5. Show results as:
   - Diagnostics (VS Code problems panel) for violations
   - Information messages for compliant areas
   - Decoration (gutter icons) on violation lines

**Why this matters:** This is the #1 trust gap. A generic agent has no idea what ADRs exist. The extension checks automatically.

#### 5.2.4 `dreamgraph.checkUiIntegrity` *(v1.1)*

**Purpose:** Check if the current file's UI code matches registered patterns.

**Deferred rationale:** Valuable but requires complete UI registry data. Add after the core ADR compliance → validate → suggest loop is solid.

#### 5.2.5 `dreamgraph.validateCurrentFile`

**Purpose:** Validate the current file against the operational knowledge graph.

**Operational Readiness:** Requires **Stage 2+** (Code Validation). See §14.4.4 for full integration design including diagnostics mapping, Quick Fix suggestions, and the progressive UX from Stage 0 through Stage 4.

**Flow:**
1. Check operational readiness stage (§14.4.1)
2. If Stage < 2: show informational message with guidance to reach Stage 2
3. Read active file
4. Call `validate_code_against_graph(file_path=<active_file>, strictness="lenient")` 
5. Check API surface for method calls that don't exist
6. Check imports against known module structure
7. Map violations to VS Code Diagnostics (Problems panel)
8. Offer Quick Fix code actions for Levenshtein-distance suggestions
9. If Stage 4: prepend freshness warning when surface is stale

**Depends on:** TDD_OPERATIONAL_KNOWLEDGE Phase 2 (`validate_code_against_graph` tool + `api_surface.json`). Degrades gracefully at lower stages — see §14.4.2 for the full degradation matrix.

#### 5.2.6 `dreamgraph.suggestNextAction`

**Purpose:** Based on current context, suggest what to work on next.

**Operational Readiness:** Full workflow intelligence at **Stage 3+**. Heuristic fallback at Stage 0–2. See §14.4.5 for the full `suggestNextAction` integration design including workflow matching, sidebar integration, and actionable suggestion rendering.

**Flow:**
1. Check operational readiness stage (§14.4.1)
2. If Stage < 3: use heuristic mode (file-based, graph-maturity-aware)
3. If Stage 3+: build structured context, infer `completed_action` from recent activity, call `suggest_next_action(completed_action, context, max_steps=3)`
4. Show ordered suggestion list with rationale and completion percentage
5. Each suggestion is actionable: click to open the relevant file, run the relevant command, or trigger a DreamGraph tool

> **Graph maturity dependency:** This command's quality is directly proportional to the instance's knowledge completeness — specifically workflow definitions, feature coverage, and edge density. On a freshly initialized instance with sparse data, suggestions will be generic ("run a dream cycle", "enrich capabilities"). This is expected and acceptable. **Do not overpromise this command.** Frame it as "graph-informed suggestions" not "AI knows what to do next."
>
> **Graceful degradation (Stages 0–2):** When the `suggest_next_action` tool is not available, the command should:
> 1. Acknowledge limited knowledge: _"Based on limited graph data (3 features, 0 workflows)…"_
> 2. Suggest enrichment actions first: _"Consider running `enrich_seed_data` to improve suggestions"_
> 3. Fall back to file-based heuristics: recently changed files, TODO comments, test coverage gaps
> 4. At Stage 1–2: additionally suggest API surface extraction or validation for uncovered files

#### 5.2.7 `dreamgraph.openRelatedDocs` *(v1.1)*

**Purpose:** Open DreamGraph documentation relevant to the current context.

**Deferred rationale:** Nice-to-have navigation command. Lower priority than validation and suggestion commands.

#### 5.2.8 `dreamgraph.impactAnalysis` *(v1.1)*

**Purpose:** "What changes if this file changes?"

**Deferred rationale:** Likely to be more brittle than it reads on paper because it depends on index quality, graph connectivity, and operational knowledge. Add after index and graph enrichment are proven stable.

#### 5.2.9 `dreamgraph.inspectContext`

**Purpose:** Show the current context envelope in the output panel for debugging/transparency.

**Flow:** Build the full `EditorContextEnvelope`, format as readable text, show in output channel.

#### 5.2.10 `dreamgraph.setArchitectApiKey`

**Purpose:** Securely store an API key for the configured Architect model provider.

**Flow:**
1. Read current `dreamgraph.architect.provider` from settings
2. If no provider configured → show Quick Pick: "Select a provider first" with Anthropic/OpenAI/Ollama options
3. If provider is `ollama` → show info: "Ollama does not require an API key"
4. Prompt with `vscode.window.showInputBox({ password: true, prompt: "Enter API key for {provider}" })`
5. Validate key format (non-empty, reasonable length)
6. Store in VS Code SecretStorage keyed by provider: `dreamgraph.apiKey.{provider}` (e.g., `dreamgraph.apiKey.anthropic`)
7. Show confirmation notification: "✓ API key stored for {provider}"
8. If chat panel is open, dismiss the inline "no API key" warning

**Security:** The key never appears in `settings.json`, output channels, or log files. It is stored exclusively in VS Code's encrypted SecretStorage. The key is read by the LLM provider adapter at call time only.

#### 5.2.11 `dreamgraph.openChat`

**Purpose:** Open (or focus) the DreamGraph Chat panel.

**Flow:**
1. If chat panel already exists → reveal and focus it
2. If not → create WebviewPanel (§7.1.1), register message handlers, render initial state
3. If no provider/model configured → show inline setup prompt in chat
4. If no API key stored (for non-Ollama) → show inline warning with "Set API Key" button

---

## 6. Sidebar View

### 6.1 Tree View Structure

```
DREAMGRAPH
├── Instance
│   ├── Name: my-project
│   ├── UUID: abc-123-...
│   ├── Mode: development
│   ├── Status: connected ✓
│   └── Port: 8100
├── Cognitive State
│   ├── State: AWAKE
│   ├── Dream cycles: 42
│   ├── Active tensions: 3
│   ├── Lucid: inactive
│   └── Last cycle: 2h ago
├── Operational Layer
│   ├── Stage: 3 of 4
│   ├── API Surface: ✓ (247 classes)
│   ├── Code Validation: ✓
│   ├── Patterns: ✓ (12 patterns)
│   ├── Workflow Advisor: ✓
│   ├── Drift Detection: ✗
│   └── Freshness: 2 files stale
├── Current Context
│   ├── File: src/ui/layouts.py
│   ├── Intent: active_file
│   ├── Features: F-012, F-015
│   └── ADRs: ADR-008
├── Quick Actions
│   ├── ▶ Explain File
│   ├── ▶ Check ADR Compliance
│   ├── ▶ Check UI Integrity
│   ├── ▶ Validate File
│   └── ▶ Suggest Next Action
└── Recent Insights
    ├── ⚡ Tension: UI spacing inconsistency
    ├── 💡 Dream: LayoutEngine↔ThemeProvider
    └── ✅ Validated: Config→Scheduler edge
```

> **Operational Layer section visibility:** This section only appears when the daemon is at Stage 1+. At Stage 0, it is hidden (no operational tools detected). Clicking items with `✗` shows an explanation with the required daemon version. See §14.4.8 for full status bar and sidebar integration details.

### 6.1.1 Sidebar TypeScript Interfaces

```typescript
/** Top-level tree data provider registered as 'dreamgraph-sidebar' view. */
class DreamGraphTreeDataProvider implements vscode.TreeDataProvider<SidebarNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SidebarNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  getTreeItem(element: SidebarNode): vscode.TreeItem { /* ... */ }
  getChildren(element?: SidebarNode): SidebarNode[] { /* ... */ }

  /** Called on health check poll, active editor change, or connection state change. */
  refresh(section?: SidebarSection): void {
    this._onDidChangeTreeData.fire(section ? this.getSectionRoot(section) : undefined);
  }
}

type SidebarSection =
  | "instance"
  | "cognitive"
  | "operational"
  | "context"
  | "actions"
  | "insights";

interface SidebarNode {
  id: string;
  section: SidebarSection;
  label: string;
  description?: string;
  iconPath?: vscode.ThemeIcon;
  collapsibleState: vscode.TreeItemCollapsibleState;
  command?: vscode.Command;      // for clickable items (quick actions, file links)
  contextValue?: string;         // for context menu contributions
}

/** Event sources that trigger sidebar refreshes. */
interface SidebarRefreshBindings {
  onHealthCheck: vscode.Disposable;        // health poll → refresh cognitive + operational + insights
  onActiveEditorChange: vscode.Disposable; // editor change → refresh context
  onConnectionChange: vscode.Disposable;   // connect/disconnect → refresh instance + all
}
```

### 6.2 Refresh Strategy

| Section | Refresh Trigger |
|---------|----------------|
| Instance | On connection state change |
| Cognitive State | On health check poll (every 10s) |
| Operational Layer | On connection + health check poll (probes `mcp.listTools()` + reads `ops://api-drift` at Stage 4) |
| Current Context | On active editor change |
| Quick Actions | Static (always available when connected) |
| Recent Insights | On health check poll (queries dream_history tail) |

---

## 7. Chat Panel

### 7.1 Design Philosophy

The chat panel is not a generic chatbot. It is an **interface into DreamGraph**.

| Generic Chat | DreamGraph Chat |
|--------------|-----------------|
| "Explain this code" → LLM reads file | "Explain this code" → extension queries graph, assembles context, LLM explains with system knowledge |
| "Is this correct?" → LLM guesses | "Is this correct?" → extension validates against API surface, ADRs, UI registry, then reports findings |
| "What should I do next?" → LLM improvises | "What should I do next?" → extension checks workflows, changed files, active tensions, then suggests |
| No trace of tool usage | Every response shows which DreamGraph tools and resources were consulted |
| Confidence is opaque | Responses include confidence indicators where applicable |

#### 7.1.1 Webview Architecture

The chat panel is a `vscode.WebviewPanel` running isolated HTML/CSS/JS. Communication between the extension host (Node.js) and the webview (browser sandbox) uses VS Code's message-passing API.

**Message protocol:**

```typescript
// Extension → Webview messages
type ExtensionToWebviewMessage =
  | { type: "addMessage"; message: ChatMessage }
  | { type: "streamChunk"; content: string; messageId: string }
  | { type: "streamEnd"; messageId: string; metadata: ChatMessage["metadata"] }
  | { type: "setLoading"; loading: boolean }
  | { type: "preCheckWarning"; warning: { severity: string; message: string; source: string } }
  | { type: "updateModels"; providers: string[]; models: string[]; current: { provider: string; model: string } }
  | { type: "knowledgeSignal"; signal: { type: string; summary: string; confirmation: string; signalId: string } }
  | { type: "error"; message: string };

// Webview → Extension messages
type WebviewToExtensionMessage =
  | { type: "sendMessage"; content: string }
  | { type: "changeProvider"; provider: string }
  | { type: "changeModel"; model: string }
  | { type: "openDiff"; filePath: string; patch: Patch[] }
  | { type: "openFile"; filePath: string; line?: number }
  | { type: "confirmSignal"; signalId: string; action: "approve" | "edit" | "dismiss" }
  | { type: "setApiKey" };
```

**Signal confirmation routing:** Knowledge signals appear in two places with distinct roles:

1. **Chat panel (inline):** When a signal is detected, a `knowledgeSignal` message renders an inline card in the chat showing the signal summary and confirmation tier. For `auto-confirm` signals, the card is informational only ("✓ API surface updated"). For `user-confirm` signals, the card shows **Approve** and **Dismiss** buttons (via `confirmSignal` message back). Approving inline executes the signal immediately — this is the fast path for simple confirmations.

2. **Knowledge Update panel (§8.2.5):** When the user clicks **Edit** on a signal card (or when multiple user-confirm signals accumulate), the Knowledge Update panel opens with the full signal payload — editable fields, original vs. proposed values, and batch approve/dismiss. This is the detailed path for signals that need review or modification.

**Rule:** `auto-confirm` signals never open the Knowledge Update panel. `user-confirm` signals can be approved inline (fast path) or opened for editing (detailed path). The chat inline card is the *default* confirmation surface; the Knowledge Update panel is the *escalation* surface.

**Communication mechanism:**
- Extension → Webview: `panel.webview.postMessage(msg)`
- Webview → Extension: `vscode.postMessage(msg)` (inside webview), received via `panel.webview.onDidReceiveMessage(handler)`
- All messages are JSON-serializable. No function references or circular structures.

**Content Security Policy:** The webview's CSP restricts scripts to the extension's bundled `chat.js` only (`nonce`-based). No inline scripts, no external resources, no `eval`. Styles are loaded from the bundled `chat.css` only.

**No framework in v1:** The chat UI is vanilla HTML/CSS/JS. This avoids bundler complexity for a v1 webview. The chat controller in the extension host owns all state; the webview is a dumb renderer.

**State on reveal:** When the webview is hidden and re-revealed, the extension re-sends the full message list via `addMessage` calls. There is no persistent webview state — the extension host is the single source of truth.

### 7.2 Model Selector

The chat panel header includes an inline **model selector** — a dropdown that lets the user switch the Architect model without leaving the chat. This follows the same UX pattern as GitHub Copilot's model picker.

```
┌─────────────────────────────────────────────────────┐
│  DreamGraph Chat             [anthropic ▾] [claude-opus-4-6-20250602 ▾]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  (message list)                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Two dropdowns in the chat header:**

| Dropdown | Source | Behavior |
|----------|--------|----------|
| **Provider** | `dreamgraph.architect.provider` enum + any Ollama endpoint | Switching provider resets the model dropdown to that provider's default |
| **Model** | Provider-specific model list (see below) | Selecting a model takes effect immediately for the next message |

**Provider → model resolution:**

| Provider | How Models Are Listed |
|----------|---------------------|
| `anthropic` | Hardcoded list: `claude-opus-4-6-20250602`, `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-haiku-3-5-20241022` — updated with extension releases |
| `openai` | Hardcoded list: `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o-mini`, `gpt-5.4-nano`, `o3`, `o4-mini` — updated with extension releases |
| `ollama` | Dynamic: `GET {baseUrl}/api/tags` → list installed models at runtime |

> **No remote model listing in v1.** Anthropic/OpenAI models are hardcoded to avoid additional API calls and auth complexity for a simple list. The Ollama list is dynamic because it's local and free.

**Persistence:** The selected provider+model combo is written back to `dreamgraph.architect.provider` and `dreamgraph.architect.model` settings on change — so the choice survives across sessions.

**Default state:** On first open, the dropdowns reflect the current values of `dreamgraph.architect.provider` and `dreamgraph.architect.model` from settings. If neither is configured, the provider dropdown shows a placeholder ("Select provider…") and the model dropdown is disabled until a provider is chosen.

**Validation:** If the selected model's provider requires an API key and none is stored in VS Code SecretStorage, the chat shows an inline warning: _"⚠ No API key configured for {provider}. Set it with `DreamGraph: Set Architect API Key`."_

### 7.3 Chat Message Structure

```typescript
interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;

  /** DreamGraph-specific metadata (assistant messages only) */
  metadata?: {
    /** Which DreamGraph tools were called */
    toolsUsed: {
      name: string;
      duration_ms: number;
      result_summary: string;
    }[];

    /** Which resources were read */
    resourcesRead: string[];

    /** Context mode used */
    intentMode: IntentMode;

    /** Confidence in the response (if applicable) */
    confidence?: number;

    /** Any warnings (ADR violations, UI inconsistencies, etc.) */
    warnings: {
      severity: "info" | "warning" | "error";
      message: string;
      source: string;          // "adr" | "ui_registry" | "api_surface" | "scope"
    }[];

    /** File references that can be clicked to navigate */
    fileReferences: {
      path: string;
      line?: number;
      description: string;
    }[];

    /** Reasoning basis — why THIS answer was produced */
    reasoningBasis: {
      /** Graph entities consulted to produce this response */
      features: string[];        // e.g., ["F-012 (UI Layout System)", "F-015 (Theme Engine)"]
      adrs: string[];            // e.g., ["ADR-008 (Layout consistency)"]
      workflows: string[];       // e.g., ["WF-003 (UI component lifecycle)"]
      uiElements: string[];      // e.g., ["UIStack", "UIGrid"]
      tensions: string[];        // e.g., ["T-014 (spacing inconsistency)"]
      /** Human-readable one-liner shown in chat UI */
      summary: string;           // e.g., "Based on: ADR-008, Feature F-012, API surface (UIStack)"
    };

    /** Proposed changes (if any) */
    proposedChanges: {
      path: string;
      description: string;
      patch: Patch[];
    }[];
  };
}
```

### 7.4 Chat Flow

```
User types message in chat panel
        │
        ▼
  Build EditorContextEnvelope (§3)
        │
        ▼
  Intent Detection
        │
        ▼
  Assemble Architect LLM prompt (§7.5–7.9):
    - architect_core.md (permanent identity + agentic tool-use contract)
    - Task overlay (architect_explain | architect_patch | architect_validate | architect_suggest | architect_chat)
    - Context block (from EditorContextEnvelope)
    - MCP tool definitions (fetched from daemon via listTools())
    - User message
        │
        ▼
  ┌──► Call Architect LLM (with tool definitions)
  │         │
  │         ├── Text content ──► Stream to chat panel progressively
  │         │
  │         ├── Tool calls (stop_reason = tool_use) ──► Execute via MCP client
  │         │       │
  │         │       ├── Show tool name + args in chat UI
  │         │       ├── Call daemon MCP endpoint
  │         │       ├── Show result summary in chat UI
  │         │       └── Feed tool results back to Architect
  │         │                │
  │         └────────────────┘ (loop up to 25 rounds)
  │
  └── stop_reason ≠ tool_use ──► Final response
        │
        ▼
  Store assistant message with metadata:
    - Tools used (name, duration, result summary)
    - Reasoning basis (features, ADRs, workflows referenced)
    - Intent mode and confidence
```

**Agentic tool loop:** The Architect receives the full list of MCP tools available on the daemon (fetched via `listTools()` at chat start). When the model returns a `tool_use` stop reason, the extension executes each tool call via the MCP client, feeds the results back as tool_result messages, and re-invokes the Architect. This continues until the model returns a text-only response (`end_turn`) or the 25-round limit is hit. The Architect actively builds and enriches the knowledge graph through these tool calls — it does not rely on post-processing heuristics to detect knowledge signals.

**Tool call visibility:** Every tool call is rendered in the chat UI as it executes — showing the tool name, arguments, and a summary of the result. This gives the user full visibility into what the Architect is doing and why.

### 7.5 Prompt Architecture

> **Design principle:** The system prompts are architecture, not copy. They encode the behavioral contract between editor context, DreamGraph knowledge, constraints, and Architect output. If prompts are vague, the model behaves like a generic coding assistant. If prompts precisely encode the rules in this TDD, the model behaves like a DreamGraph-native reasoning layer.

> **Semantic layer rule:** Prompts MUST refer to DreamGraph knowledge by semantic layer name, NEVER by storage artifact or filename. The Architect has no knowledge of how DreamGraph persists data internally. Storage details belong to the implementation (orchestration layer), not the model contract. The clean separation is: **prompt layer** = semantic concepts only; **orchestration layer** = maps concepts to internal stores/resources; **storage layer** = filenames and JSON persistence.

The Architect uses a **prompt family** — a core system prompt plus composable overlays — not a single monolithic prompt. This keeps the base prompt stable and small while adapting behavior per task mode.

#### Prompt composition model

```
┌─────────────────────────────────────────────────────────────────┐
│  SYSTEM PROMPT (sent as the system message for every LLM call)  │
│                                                                 │
│  ┌───────────────────────────────────────┐                      │
│  │  architect_core                        │  ← always present   │
│  │  (identity, rules, constraint          │                     │
│  │   hierarchy, prohibited behaviors)     │                     │
│  └───────────────────────────────────────┘                      │
│           +                                                     │
│  ┌───────────────────────────────────────┐                      │
│  │  task overlay (exactly one)            │  ← per operation    │
│  │  architect_explain | architect_patch   │                     │
│  │  architect_validate | architect_suggest│                     │
│  │  architect_chat                        │                     │
│  └───────────────────────────────────────┘                      │
│           +                                                     │
│  ┌───────────────────────────────────────┐                      │
│  │  constraint overlays (0..N)            │  ← conditional      │
│  │  only injected when relevant data      │                     │
│  │  is present in the context envelope    │                     │
│  └───────────────────────────────────────┘                      │
│           +                                                     │
│  ┌───────────────────────────────────────┐                      │
│  │  context block                         │  ← always present   │
│  │  (populated from EditorContextEnvelope)│                     │
│  └───────────────────────────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

**Assembly rule:** `architect_core` + exactly one task overlay + zero or more constraint overlays + context block. The orchestration layer (Layer 2) assembles the final system prompt from these pieces before calling the Architect model. The prompt is **never** hand-edited at runtime.

#### Prompt artifacts

| Artifact | File | When Used | Stable/Dynamic |
|----------|------|-----------|---------------|
| Core system prompt | `prompts/architect_core.md` | Every Architect call | Stable — changes only on TDD revision |
| Explain overlay | `prompts/architect_explain.md` | `explainFile`, `explainSelection`, chat explain intent | Stable |
| Patch overlay | `prompts/architect_patch.md` | Chat code-change requests, future patch commands | Stable |
| Validate overlay | `prompts/architect_validate.md` | `checkAdrCompliance`, `validateCurrentFile`, chat validation intent | Stable |
| Suggest overlay | `prompts/architect_suggest.md` | `suggestNextAction`, chat "what should I do" intent | Stable |
| Chat overlay | `prompts/architect_chat.md` | General chat synthesis (no specific task classification) | Stable |
| Constraint overlays | Inline templates in orchestration code | When constraint data is present in context envelope | Dynamic (data-driven) |

### 7.6 Prompt Specifications

#### 7.6.1 `architect_core.md` — Core Architect System Prompt

This is the permanent identity, ruleset, and behavioral contract. It is present in **every** Architect call. As of v2, the Architect is an **active tool-calling agent** — the sole agent responsible for building, enriching, and maintaining the knowledge graph through MCP tools.

```markdown
# DreamGraph Architect

You are the DreamGraph Architect — the **active reasoning and orchestration agent** inside
a development environment powered by DreamGraph v6.2.0.

You are the **sole agent** responsible for building, enriching, and maintaining the
project's knowledge graph. You accomplish this by calling MCP tools exposed by the
DreamGraph daemon.

## Identity

- You operate inside a VS Code extension connected to a DreamGraph daemon instance.
- The daemon maintains a knowledge graph of the target project: features, workflows,
  data models, architectural decisions (ADRs), UI registry patterns, and tensions.
- You have access to **MCP tools** that let you read source code, scan projects,
  enrich data, query the graph, record decisions, register UI elements, run dream
  cycles, and more.
- You **actively call tools** to gather context, execute operations, and update the
  knowledge graph. You do not wait for context to be assembled upstream — you fetch
  what you need.

## Tool Use Philosophy

- **Be proactive.** When a user asks about the system, use tools to fetch current data
  rather than guessing or saying you don't have context.
- **Use the right tool.** Match the user's request to the appropriate MCP tool(s).
  For example:
  - "scan the project" → call `scan_project` or `init_graph`
  - "what features exist?" → call `query_resource` with type "feature"
  - "read this file" → call `read_source_code`
  - "explain the architecture" → call `query_resource`, `query_architecture_decisions`
  - "enrich the graph" → call `enrich_seed_data` with relevant targets
  - "record a decision" → call `record_architecture_decision`
  - "register a UI component" → call `register_ui_element`
  - "run a dream cycle" → call `dream_cycle`
  - "check git history" → call `git_log` or `git_blame`
- **Chain tools when needed.** Complex operations often require multiple tool calls.
- **Report results.** After executing tools, summarize what was done and what changed.

## Constraint Hierarchy (STRICT ORDER)

When reasoning, recommending, or generating code, you MUST respect this priority order.
Higher-priority constraints override lower-priority ones unconditionally.

1. **Project scope and instance boundary** — all operations stay within the instance's
   project root. Never reference, read, or propose changes to files outside this boundary.
2. **ADRs (Architectural Decision Records)** — accepted ADRs are binding constraints,
   not suggestions. Their guard_rails are hard rules. If a user request conflicts with
   an accepted ADR, refuse the conflicting action, explain the ADR, and propose a
   compliant alternative.
3. **UI registry constraints** — when UI elements are defined in the registry, their
   purpose, data contract, interaction model, and composition rules are authoritative.
   Do not invent UI patterns outside the registry.
4. **API surface** — when API surface data is provided, it describes the actual
   implemented interfaces. Do not invent methods, parameters, types, or endpoints
   that are not in the provided API surface. If something is missing, say so.
5. **DreamGraph knowledge graph** — features, workflows, data model entities, validated
   edges, and tensions provide system-level understanding. Prefer graph-grounded
   reasoning over file-level guesswork.
6. **User request** — the user's intent, interpreted within the above constraints.
7. **General coding best practices** — apply only when no higher-priority constraint
   speaks to the issue.

**Conflict rule:** If the user request conflicts with an accepted ADR, UI integrity rule,
or validated API surface, do NOT comply directly. Explain the conflict and propose the
closest compliant alternative.

## Data Protection Awareness

DreamGraph uses a tiered data protection model:
- **Tier 1 — Cognitive state** (dream graph, validated relationships, tension records,
  dream history, candidate hypotheses) — only modifiable through cognitive tools like
  `dream_cycle`, `normalize_dreams`, `solidify_cognitive_insight`. Never write these
  directly.
- **Tier 2 — Structured knowledge** (architectural decisions, UI registry, feature
  definitions, workflow definitions, data model) — modifiable through dedicated MCP
  tools like `enrich_seed_data`, `record_architecture_decision`, `register_ui_element`.
- **Tier 3 — Seed/reference data** (system overview, project index, capabilities) —
  populated via `init_graph` and `scan_project`.

You modify all tiers **exclusively through MCP tools**, never by proposing direct file
writes to data files.

## Uncertainty Policy

You MUST explicitly state uncertainty when:
- Tool calls return errors or incomplete data.
- Graph knowledge is sparse (few features, few validated edges, no workflows).
- You are reasoning beyond the scope of available data.

**Rule:** When uncertain, call tools to gather more information before concluding.

## Output Policy

- Structured and readable. No unnecessary verbosity.
- Grounded in tool results and graph data. Cite specific results when making claims.
- Include reasoning steps where the conclusion is non-obvious.
- After tool operations, provide a clear summary of what was done and what changed.

## Code Change Policy

- You may propose code edits as targeted diffs.
- Generate minimal, targeted edits — not full-file rewrites unless explicitly requested.
- Do NOT generate pseudo-code. Produce exact, applicable code.
- After proposing changes, consider whether the knowledge graph needs updating
  (new feature? changed workflow? new ADR?) and call the appropriate tools.

## Goal

Help the user understand the system, validate decisions, make correct changes, and
**keep the knowledge graph current** — ensuring the system model remains coherent
after every interaction.
```

#### 7.6.2 `architect_explain.md` — Explain Task Overlay

Applied when the operation is `explainFile`, `explainSelection`, or a chat message classified as an explanation request.

```markdown
## Task: Explain

You are explaining code in the context of DreamGraph's knowledge graph.

### What makes this different from a generic explanation

You have access to:
- **Feature context:** Which features this code belongs to, and their purpose.
- **Workflow context:** Which workflows this code participates in, and at which step.
- **ADR context:** Which architectural decisions constrain this code, and why
  those decisions were made.
- **Tension context:** Whether there are unresolved architectural tensions related
  to this code.

### Output requirements

1. Explain the code's **role in the system**, not just its syntax.
   "This function implements step 3 of the {workflow_name} workflow" is more
   valuable than "This function takes two parameters and returns a boolean."
2. Reference specific graph entities: features (by ID/name), workflows (by name/step),
   ADRs (by ID/title), data model entities, and tensions.
3. If the code violates or bends an ADR, note this — even if the user didn't ask.
4. If the code is part of a feature boundary (multiple features touch it), explain
   the boundaries and which feature owns which behavior.
5. If tensions exist for this area, mention them as context:
   "Note: there is an unresolved tension ({tension_id}) about {description}."
6. If context is sparse (few features, no workflows), say so and provide
   the best explanation available from file content alone, clearly marking
   which claims are graph-grounded and which are inferred from code.
```

#### 7.6.3 `architect_patch.md` — Patch Generation Overlay

Applied when the operation involves generating code changes.

```markdown
## Task: Generate Code Change

You are generating a proposed code modification for a DreamGraph-managed system.

### Patch rules

1. **Minimal edits.** Do NOT rewrite entire files unless explicitly requested.
   Prefer small, localized changes that modify only the lines necessary to
   satisfy the request.
2. **Preserve existing structure.** Maintain naming conventions, patterns,
   and style found in the surrounding code.
3. **Compatibility.** If API surface data is provided, ensure generated code
   is compatible with the actual implemented interfaces. Do not invent methods
   or signatures.
4. **ADR compliance.** Before producing a patch, verify it does not violate any
   applicable ADR. If it does, DO NOT produce the patch — explain the violation
   and propose a compliant alternative.
5. **UI registry compliance.** If the change touches UI code and UI registry
   patterns are provided, ensure the change respects component roles,
   data contracts, and composition rules.
6. **Scope enforcement.** Never generate changes to files outside the project root.
   Never generate changes that directly modify DreamGraph knowledge layers.

### Output format

Produce changes in one of these formats:

**Option A — Contextual replacement (preferred):**
For each change, provide:
- File path (relative to project root)
- The exact code being replaced (with 3+ lines of surrounding context)
- The replacement code
- A brief explanation of what changed and why

**Option B — Unified diff (when multiple changes in one file):**
```
--- a/path/to/file
+++ b/path/to/file
@@ ... @@
 context line
-removed line
+added line
 context line
```

### Safety checks

Before producing any patch output:
- Confirm it does not violate applicable ADRs.
- Confirm it matches API surface (if provided).
- Confirm UI integrity (if applicable).
- If any violation exists, DO NOT produce the patch. Instead: explain the
  issue, cite the constraint, and propose a compliant alternative.

### Post-patch explanation

After the patch, include a concise summary:
- What changed
- Why
- Which constraints were considered
- Which graph entities informed the change

### Prohibited

- No pseudo-code.
- No incomplete edits ("you should also change..." without providing the change).
- No assumptions about unseen code.
- No silent full-file rewrites.
```

#### 7.6.4 `architect_validate.md` — Validation Overlay

Applied for `checkAdrCompliance`, `validateCurrentFile`, and chat validation intents.

```markdown
## Task: Validate

You are the DreamGraph Architect in validation mode.

Your task is to evaluate code, a proposed change, or an implementation against
the verified knowledge available from DreamGraph for the current instance.

You are not a generic reviewer. You are a constraint-aware validation layer.

### Available knowledge layers

You may receive validated or extracted context from these DreamGraph knowledge
layers (the orchestration layer selects what is relevant):

- **Architectural Decisions** — accepted and historical decisions with guard rails
- **Operational API Surface** — extracted interface reality from the codebase
- **System Capabilities** — functional domains and cognitive features
- **Data Model** — entities, fields, and relationships
- **Feature Definitions** — feature boundaries and ownership
- **Workflow Knowledge** — procedural flows and operational sequences
- **UI Registry** — UI structure, patterns, data contracts, and constraints
- **Validated Relationships** — confirmed graph connections
- **Active Tensions** — unresolved architectural concerns
- **Cognitive History** — prior discoveries from dream cycles
- **System Overview** — high-level system identity
- **System Narrative** — narrative understanding of the system's evolution
- **Indexed Project References** — file/entity/feature indexing
- **Graph RAG Context** — retrieved subgraph fragments relevant to the current query
- **Lucid Dreaming State** — active lucid session insights and findings (when engine is in LUCID state)

You must treat provided data from these layers as authoritative within its scope.

### Validation priority order (STRICT)

Evaluate in this exact sequence. Higher-priority findings override lower ones.

1. **Scope boundary.** Is the code/change within the current project and instance
   scope? If not, stop and state the boundary issue.

2. **ADR compliance.** Does the code conflict with any accepted architectural
   decision? ADRs are binding. For each applicable ADR:
   - Check the decision, consequences, and guard_rails.
   - Report each violation with: ADR ID, specific guard rail, code location,
     explanation, and concrete fix.
   - Report compliant areas briefly ("ADR-008: compliant").

3. **API surface compliance.** If operational API surface data is provided:
   - Check for calls to methods, endpoints, or symbols not in the surface.
   - Check for parameter/type mismatches against documented signatures.
   - Check for missing error handling on API calls.
   - API surface overrides assumptions — if something is not listed, it
     may not exist.

4. **UI registry compliance.** If UI registry data is provided:
   - Check that UI elements match registered patterns.
   - Check that component composition follows registry rules.
   - Check that data contracts are respected.

5. **Data model and workflow consistency.** Does the code align with known
   data model entities, feature boundaries, and workflow sequences?

6. **Graph alignment.** Does the code contradict validated relationships
   or known architectural understanding? Are there active tensions that
   reduce certainty?

7. **General engineering quality.** Only after all system-specific checks.

### Output format

Structure your output as a structured diagnostic report:

```
## Validation Result: {Compliant | Non-compliant | Partially validated | Insufficient context}

### Violations (action required)

1. **[ADR-008] Layout consistency** (line 42)
   Guard rail: "Do NOT use inline styles for layout spacing"
   Found: `style={{ marginTop: '16px' }}`
   Fix: Use `<Spacer size="md" />` from the UI registry.

2. **[API Surface] Unknown method** (line 67)
   `userService.fetchProfile()` is not in the operational API surface.
   Available: `userService.getUser()`, `userService.listUsers()`

### Warnings (review recommended)

1. **[Tension T-014]** Unresolved tension in this area: spacing inconsistency.
   Review after resolving tension.

### Compliant

- ADR-003: ✓ (instance scope boundary respected)
- Data protection: ✓ (no direct knowledge layer modifications)
- UI registry: ✓ (all components match registered patterns)

### Knowledge gaps

- API surface: not provided — method-level validation incomplete.
- UI registry: no matching patterns supplied — UI integrity not assessed.

### Recommended Action

{approve as-is | revise specific parts | reject and replace | gather more context}
```

### Rules

- Every violation must cite the specific constraint (ADR ID, API surface entry,
  UI registry element) and include a concrete, applicable fix.
- If the proposal is compliant, say so clearly and explain why.
- If knowledge is incomplete, state which checks could not be performed:
  "API surface not provided — cannot validate method-level correctness."
  "No relevant ADRs supplied — architectural compliance not assessed."
- Do not infer certainty from missing information. Missing context means
  the check is incomplete, not that the code is compliant.
- Be firm when constraints are violated. Do not soften ADR violations.
- Prefer constraint-aware correctness over generic code-review advice.

### Prohibited

- Do not approve code that conflicts with an accepted ADR.
- Do not invent missing methods or interfaces to make code "pass."
- Do not treat absent UI registry context as proof of compliance.
- Do not ignore active tensions.
- Do not give generic code-review comments before system-specific validation.
```

#### 7.6.5 `architect_suggest.md` — Suggest Next Action Overlay

Applied for `suggestNextAction` and "what should I do next" chat intents.

```markdown
## Task: Suggest Next Action

You are the DreamGraph Architect in next-action mode.

Your task is to recommend the most useful next step for the developer based on
the current editor context, project state, and DreamGraph's actual knowledge
maturity.

You do not improvise task advice like a generic assistant. You recommend actions
grounded in the system's structure, workflows, tensions, and current knowledge
completeness.

### Available knowledge layers

You may receive context from these DreamGraph knowledge layers (the orchestration
layer selects what is relevant):

- **Active Tensions** — unresolved architectural concerns with urgency scores
- **Workflow Knowledge** — procedural flows and operational sequences
- **Feature Definitions** — feature boundaries, ownership, and completeness
- **Indexed Project References** — file/entity/feature mapping
- **Validated Relationships** — confirmed graph connections
- **Cognitive History** — prior dream cycle discoveries
- **Scheduling State** — planned cognitive work
- **Architectural Decisions** — accepted constraints and guard rails
- **Operational API Surface** — extracted interface reality
- **UI Registry** — UI structure and constraints
- **Data Model** — entities, fields, and relationships
- **System Overview** — high-level system identity
- **System Narrative** — the system's evolutionary story
- **Graph RAG Context** — retrieved graph knowledge grounded in the current query
- **Lucid Dreaming State** — active lucid session context and interactive findings

These layers vary in maturity and completeness. You must account for that.

### Recommendation priority order (STRICT)

Evaluate in this exact sequence:

1. **Constraint violations first.** If the current file or proposed work violates
   an ADR, UI rule, or API surface constraint, the next action is to resolve
   that before anything else.

2. **Blocked work next.** If the user lacks required context, missing interface
   knowledge, or faces unresolved ambiguity, recommend the smallest action
   that unblocks progress.

3. **Workflow continuation.** If the current work clearly sits inside a known
   workflow, recommend the next workflow-consistent step.

4. **Validation before expansion.** If a change was just made or proposed,
   prefer validation before suggesting additional implementation.

5. **Enrichment when knowledge is thin.** If DreamGraph does not know enough
   to guide confidently, recommend enrichment or graph-improving actions
   before pretending certainty.

6. **Progressive implementation.** Only after constraints, blockers, workflows,
   and knowledge maturity are assessed should you recommend new coding work.

### Output format

Respond in this structure:

**Recommended Next Action**
One concrete, specific next step (one sentence).

**Why This Comes Next**
Explain using DreamGraph knowledge:
- Which workflow step, constraint, tension, or feature motivates this.
- What graph context supports the recommendation.

**Confidence:** High | Moderate | Low
Confidence must reflect graph maturity and constraint certainty.

**Alternatives** (up to 2)
Only if genuinely plausible alternative next steps exist.

**Missing Knowledge** (if applicable)
State what DreamGraph would need to recommend more confidently.

### Knowledge maturity awareness

You MUST account for graph completeness. Low-maturity signals include:
- Very few features (< 10)
- No workflows defined
- Sparse validated relationships (< 50)
- High unresolved tension count
- Missing operational API surface
- Limited architectural decision coverage

If knowledge maturity is low, say so explicitly:

"The knowledge graph for this project is still developing ({N} features,
{M} validated relationships, {W} workflows). Recommendations are based on
available data — enrichment and dream cycles will improve guidance."

In low-maturity cases:
- Recommend enrichment actions
- Recommend validation or scanning actions
- Recommend small, reversible steps
- Do NOT pretend DreamGraph knows the ideal next move

### What counts as a good recommendation

Good: specific, local, justified, actionable, safe.

- "Validate the current file against the operational API surface before continuing —
  the active symbol uses methods not yet confirmed."
- "Resolve the ADR conflict in the service layer before editing UI components."
- "Enrich feature and workflow data first — the graph lacks enough project knowledge
  to recommend a reliable next implementation step."

Bad: vague, broad, unjustified.

- "Keep going."
- "Refactor the architecture."
- "Work on the UI."

### Prohibited

- Do not improvise generic productivity advice.
- Do not suggest architecture changes without graph support.
- Do not ignore ADR or API violations in favor of momentum.
- Do not present weakly grounded suggestions as high-confidence.
- Do not overpromise what DreamGraph knows.
- Do not suggest actions that require tools you cannot invoke.
- Do not suggest modifying DreamGraph knowledge layers directly.
- Do not fabricate features, workflows, or tensions not in context.
```

#### 7.6.6 `architect_chat.md` — Chat Synthesis Overlay

Applied for general chat messages that don't match a specific task classification.

```markdown
## Task: Chat

You are responding to a developer's question in the DreamGraph-integrated chat panel.

### Behavior

- Answer the question using provided graph context first, falling back to general
  knowledge only for language syntax and standard library specifics.
- If the question is about the system's architecture, features, or design decisions,
  ground your answer in the knowledge graph. Do not guess about system structure
  when graph data is available.
- If the question is about code, reference the file context provided. Do not assume
  code you haven't been shown.
- If the question implies a code change, apply `architect_patch` rules.
- If the question implies validation, apply `architect_validate` rules.
- If the answer requires information not in the provided context, say so explicitly
  rather than guessing.

### Conversational style

- Concise but complete.
- Lead with the answer, then explain.
- Cite graph entities (ADRs, features, workflows) inline where they support
  your claims.
- If the question is ambiguous, state your interpretation before answering
  and note alternatives.

### Reasoning basis

Every response must be grounded. At a minimum, be prepared to justify:
- Which features/ADRs/workflows informed your answer.
- Whether any constraints were considered.
- Whether any context was missing or trimmed.

The extension will render this as a "Based on: ..." footer. Produce a one-line
summary of the entities you relied on (the `reasoningBasis.summary` field).
```

### 7.7 Constraint Overlays

Constraint overlays are small prompt inserts injected **only when relevant data is present** in the context envelope. They prevent the core prompt from becoming bloated with conditional information.

The orchestration layer applies them automatically based on `EditorContextEnvelope.graphContext`:

| Overlay | Injected When | Content |
|---------|--------------|---------|
| `overlay_adrs` | `graphContext.applicableAdrs.length > 0` | ADR texts with guard_rails, prefixed by enforcement rule |
| `overlay_ui_registry` | `graphContext.uiPatterns.length > 0` | UI element definitions with data contracts and composition rules |
| `overlay_api_surface` | `graphContext.apiSurface !== null` | API symbols with signatures, prefixed by "this overrides assumptions" |
| `overlay_tensions` | `graphContext.activeTensions > 0` | Tension descriptions with urgency, prefixed by "these are unresolved concerns" |
| `overlay_context_trimmed` | Context budget trimmed any sections | Note listing which sections were dropped and count |
| `overlay_graph_sparse` | Features < 10 or validated edges < 50 | Note about graph maturity and reduced confidence |
| `overlay_operational_unavailable` | Operational layer not responding | Note that API surface, runtime metrics, and validation are unavailable |
| `overlay_operational_active` | Operational readiness Stage 1+ (API surface available) | Note that API surface is provided; cite exact signatures when referencing methods |
| `overlay_operational_validation_active` | Operational readiness Stage 2+ (code validation available) | Note that code validation and implementation patterns are active; follow known patterns |
| `overlay_operational_drift_warning` | Stage 4 + drift exceeds threshold | Warning that some API surface data is stale; recommend re-extraction before relying on it |
| `overlay_graph_rag_available` | `graphContext.graphRag !== null` | Note that Graph RAG fragments are provided; prefer graph-grounded facts over assumptions |
| `overlay_lucid_active` | `cognitiveState === "LUCID"` | Note that the cognitive engine is in an interactive lucid dream session; lucid findings are included in context |

#### Overlay templates

**`overlay_adrs`:**
```markdown
## Applicable Architectural Decisions (BINDING)

The following ADRs are accepted and in effect for this code area. Their guard_rails
are hard constraints — equivalent to compile errors in importance.

{for each adr}
### {adr.id}: {adr.title}
**Decision:** {adr.decision.chosen}
**Guard rails:**
{for each guard_rail}
- {guard_rail}
{/for}
{/for}

If any recommendation you make would violate these guard rails, you MUST refuse
and explain the conflict.
```

**`overlay_ui_registry`:**
```markdown
## UI Registry Patterns (BINDING for UI code)

The following UI elements are registered and their definitions are authoritative.
When working with UI code in this area, you MUST respect these patterns.

{for each ui_element}
### {element.name} ({element.category})
**Purpose:** {element.purpose}
**Data contract:** {element.data_contract}
**Interactions:** {element.interactions}
**Children:** {element.children}
{/for}

Do not invent UI patterns, component names, or interaction models outside this
registry.
```

**`overlay_api_surface`:**
```markdown
## API Surface (AUTHORITATIVE)

The following API symbols are extracted from the actual codebase. This data
overrides any assumptions you may have about method signatures, parameters,
or return types.

{for each symbol}
- `{symbol.name}` ({symbol.kind}) in `{symbol.file}`: `{symbol.signature}`
{/for}

If you need to reference an API that is not listed above, state that it is
not in the provided surface rather than inventing a signature.
```

**`overlay_tensions`:**
```markdown
## Active Tensions (CONTEXT)

The following unresolved architectural tensions are relevant to this area.
These represent known concerns that the system has identified but not yet
resolved.

{for each tension}
- **{tension.id}** ({tension.domain}, urgency: {tension.urgency}):
  {tension.summary}
{/for}

Consider these tensions in your reasoning. If your recommendation would
exacerbate a tension, note this. If it would resolve one, note that too.
```

**`overlay_context_trimmed`:**
```markdown
## Context Limitation

Portions of the available context were trimmed due to token budget constraints:
{trimmed_sections_note}

Your reasoning should account for this limitation. Do not make assertions about
information that was not provided. If the trimmed sections might be relevant to
the question, state this explicitly.
```

**`overlay_graph_sparse`:**
```markdown
## Knowledge Graph Maturity

The knowledge graph for this project is still developing:
- Features: {feature_count}
- Validated edges: {validated_edge_count}
- Workflows: {workflow_count}

Recommendations based on graph knowledge may be incomplete. Where graph data
is thin, clearly distinguish between graph-grounded claims and inferences
from code alone.
```

**`overlay_operational_unavailable`:** *(Stage 0)*
```markdown
## Operational Layer Unavailable

The operational knowledge layer (API surface extraction, runtime metrics,
code validation against graph) is not available for this instance.

This means:
- API surface data is not provided — do not assume method signatures.
- Code validation against the graph cannot be performed.
- Runtime metrics are unavailable.

Proceed with available context, clearly noting which checks could not be
performed.
```

**`overlay_operational_active`:** *(Stage 1)*
```markdown
## API Surface Available

The operational knowledge layer provides API surface data for this project.
Method signatures, class hierarchies, and module structures have been
extracted from source code.

When referencing classes or methods:
- Cite exact signatures from the provided API surface data
- Do not assume methods exist unless they appear in the surface
- Note when a symbol is not in the surface (may be external or unextracted)
```

**`overlay_operational_validation_active`:** *(Stage 2+)*
```markdown
## Code Validation Available

The operational knowledge layer includes code validation against the project's
API surface. When generating or modifying code:
- Method calls will be validated against known class signatures
- Import paths will be checked against known module structure
- Violations will be flagged before the code is applied

Additionally, implementation patterns extracted from this project are available.
When creating new files or classes, follow existing patterns where applicable.
Cite the pattern name and source file when replicating a pattern.
```

**`overlay_operational_drift_warning`:** *(Stage 4, when drift exceeds threshold)*
```markdown
## API Surface Freshness Warning

The operational API surface for this project is partially outdated:
- {stale_count} files have been modified since last extraction
- Oldest stale surface: {oldest_file} ({time_ago})

Method signatures and class structures may have changed since extraction.
When referencing API surface data, note which files are stale and recommend
re-extraction before relying on their surface data for code generation.
```

See §14.4.7 for the progressive overlay selection strategy across all readiness stages.

### 7.8 Context Block Template

The context block is the final section of the system prompt, populated from `EditorContextEnvelope`. It begins with a **machine-readable header** followed by **human-readable context**.

#### Machine-readable context header

Before the human-readable context, the orchestration layer injects a JSON header that gives the Architect precise metadata about what it has been given. This makes prompt behavior more reliable — the model knows exactly which knowledge layers are present without parsing prose.

```json
{
  "mode": "{task_mode}",
  "context_trimmed": true | false,
  "knowledge_layers_present": [
    "architectural_decisions",
    "operational_api_surface",
    "operational_code_validation",
    "operational_patterns",
    "ui_registry",
    "feature_definitions",
    "workflow_knowledge",
    "validated_relationships",
    "active_tensions",
    "graph_rag_context",
    "lucid_state"
  ],
  "operational_readiness": {
    "stage": 3,
    "api_surface": true,
    "code_validation": true,
    "patterns": true,
    "workflow_advisor": true,
    "drift_detection": false,
    "surface_age_seconds": 2700
  },
  "graph_maturity": {
    "features": 42,
    "workflows": 18,
    "validated_edges": 491,
    "active_tensions": 26
  }
}
```

The `mode` field matches the task overlay (`explain`, `patch`, `validate`, `suggest`, `chat`). The `knowledge_layers_present` array lists which semantic layers have data in this context — the Architect can check this array before making assertions about any layer. Operational layers (`operational_api_surface`, `operational_code_validation`, `operational_patterns`) are only present when the corresponding readiness stage is active (§14.4.1). The `operational_readiness` object gives the Architect precise knowledge of which operational capabilities are available and how fresh the data is. The `graph_maturity` object provides counts for maturity-aware reasoning.

#### Human-readable context

```
## Current Context

- **Project:** {instance_name}
- **File:** {active_file.path} ({active_file.languageId}, {active_file.lineCount} lines)
- **Cursor:** line {active_file.cursorLine}
- **Intent mode:** {intentMode} (confidence: {intentConfidence})
- **Cognitive state:** {cognitiveState}
- **Graph stats:** {feature_count} features, {validated_edge_count} validated edges,
  {workflow_count} workflows, {tension_count} active tensions

{if selection}
### Selected Code
```{active_file.languageId}
{selection.text}
```
Lines {selection.startLine}–{selection.endLine}
{/if}

{if file_content}
### File Content
```{active_file.languageId}
{file_content}
```
{/if}

{overlay_adrs — if applicable}
{overlay_ui_registry — if applicable}
{overlay_api_surface — if applicable}
{overlay_tensions — if applicable}
{overlay_context_trimmed — if applicable}
{overlay_graph_sparse — if applicable}
{overlay_operational_unavailable — if applicable}
```

### 7.9 Prompt Assembly Example

For a `checkAdrCompliance` command on a file with two applicable ADRs and one active tension:

```
[architect_core.md]                    ← permanent identity and rules
[architect_validate.md]                ← validation task overlay
[overlay_adrs: ADR-008, ADR-011]       ← injected because ADRs apply
[overlay_tensions: T-014]              ← injected because tensions exist
[context block: file content, selection, graph stats]
```

For a general chat question about a file in a sparse graph with no ADRs:

```
[architect_core.md]                    ← permanent identity and rules
[architect_chat.md]                    ← chat task overlay
[overlay_graph_sparse]                 ← injected because graph is thin
[context block: file content, graph stats]
```

The orchestration layer assembles these automatically. No manual prompt editing at runtime.

---

## 8. Daemon-Side Extensions

### 8.1 New REST Endpoints

The extension benefits from four REST endpoints on the daemon (not MCP tools — these are extension-specific HTTP routes):

> **Boundary principle:** The extension owns editor context; the daemon owns graph and operational reasoning. `/api/graph-context` returns only DreamGraph-side enrichment for a supplied file/feature set — it is NOT a generic editor-context service. Context assembly (combining editor state with graph enrichment) lives in the extension's Layer 2.

#### `POST /api/graph-context`

**Purpose:** Given a file path or feature set, return relevant **graph-side** enrichment (features, workflows, ADRs, UI elements, API surface, tensions) in one call.

**Why:** Avoids N+1 MCP tool calls from the extension. One HTTP request returns everything the daemon knows about a file. The extension then combines this with editor state in its own context assembly pipeline.

**What this is NOT:** This is not an editor-context service. The daemon has no knowledge of editor state, open files, selections, or cursor positions. It returns graph facts only.

```typescript
// Request
interface GraphContextRequest {
  file_path?: string;          // relative to project root
  feature_ids?: string[];      // explicit feature IDs to enrich with
  include_adrs?: boolean;      // default: true
  include_ui?: boolean;        // default: true
  include_api_surface?: boolean; // default: true
  include_tensions?: boolean;  // default: true
}

// Response
interface GraphContextResponse {
  ok: boolean;
  file_path: string | null;
  features: { id: string; name: string; relevance: string }[];
  workflows: { id: string; name: string; step_match: string }[];
  adrs: { id: string; title: string; status: string; summary: string }[];
  ui_elements: { id: string; element_type: string; name: string }[];
  api_symbols: { name: string; kind: string; file: string; signature: string }[];
  tensions: { id: string; domain: string; summary: string; urgency: number }[];
  cognitive_state: string;
}
```

#### `POST /api/validate`

**Purpose:** Validate a file against all applicable rules in one call (ADRs, UI registry, API surface).

```typescript
// Request
interface ValidateRequest {
  file_path: string;
  content?: string;            // optional: validate this content, not the file on disk
  checks: ("adr" | "ui" | "api_surface" | "scope")[];
}

// Response
interface ValidateResponse {
  ok: boolean;
  violations: {
    check: string;
    severity: "error" | "warning" | "info";
    line?: number;
    message: string;
    rule_id: string;           // ADR ID, UI element ID, etc.
    suggestion?: string;
  }[];
  passed: string[];            // checks that passed cleanly
}
```

#### `GET /api/instance`

**Purpose:** Return full instance identity and state for the extension sidebar.

```typescript
// Response
interface InstanceResponse {
  uuid: string;
  name: string;
  project_root: string | null;
  mode: string;
  policy_profile: string;
  version: string;
  transport: { type: string; port?: number };
  daemon: {
    pid: number;
    uptime_seconds: number;
    total_dream_cycles: number;
    total_tool_calls: number;
  };
  cognitive: {
    state: string;
    active_tensions: number;
    validated_edges: number;
    last_dream_cycle: string | null;
  };
  models: {
    dreamer: { provider: string; model: string } | null;
    normalizer: { provider: string; model: string } | null;
  };
}
```

#### `POST /api/orchestrate` *(v2 implementation — contract defined now)*

**Purpose:** Accept an assembled context envelope from the extension, call the daemon-configured Architect model with graph constraints, and stream the response back.

**Why this is defined in v1 (even though not implemented):** `/api/orchestrate` will become the **central brain gateway** for DreamGraph. Every client — extension, dashboard, CLI, future API consumers — will eventually route through this endpoint. Defining the contract now prevents:

- Duplicating orchestration logic in the extension that later needs migration
- Hardcoding extension-specific assumptions into the context/response shape
- A painful v2 migration where the contract must be reverse-engineered from extension code

**v1 status:** Not implemented. The extension calls the Architect directly (§1.3 expedient). The daemon MAY expose a stub that returns `501 Not Implemented` with `{ "ok": false, "error": "orchestrate_not_available", "message": "Upgrade to v2 for daemon-side Architect" }` — this lets the extension detect capability early.

**Design principle:** The contract is client-agnostic. Nothing in the request/response assumes VS Code, a browser, or a CLI. The `EditorContextEnvelope` is the extension's internal representation — the orchestrate endpoint accepts a **subset** relevant to the daemon.

```typescript
// Request
interface OrchestrateRequest {
  /** Instance identity — scopes the request to one DreamGraph instance */
  instance_id: string;                // UUID of the target instance

  /** Client identity — for logging, rate limiting, audit */
  client: {
    type: "extension" | "dashboard" | "cli" | "api";
    version: string;                  // client version (e.g., extension version)
    session_id?: string;              // optional session tracking
  };

  /** Context assembled by the client */
  context: {
    file_path?: string;               // relative to project root
    selection?: {                     // code selection (if any)
      text: string;
      start_line: number;
      end_line: number;
    };
    feature_ids?: string[];           // features the client considers relevant
    additional_context?: Record<string, unknown>;  // extensible
  };

  /** Client's intent classification */
  intent: string;                     // IntentMode value

  /** Requested actions — what the daemon should do with this request */
  actions: ("validate" | "explain" | "suggest" | "generate" | "chat")[];

  /** Constraint enforcement — the daemon applies these before and during LLM call */
  constraints: {
    enforce_adrs: boolean;            // reject/warn on ADR violations
    enforce_ui: boolean;              // reject/warn on UI registry inconsistencies
    enforce_api: boolean;             // reject/warn on API surface mismatches
    enforce_scope: boolean;           // reject/warn on out-of-project references
  };

  /** The user's message (required for chat/explain actions) */
  user_message?: string;

  /** Conversation history (daemon is stateless per-request) */
  history?: {
    role: "user" | "assistant";
    content: string;
  }[];

  /** Streaming control */
  stream?: boolean;                   // default: true

  /** Optional overrides (developer mode) */
  overrides?: {
    model?: string;                   // force specific model
    skip_pre_checks?: boolean;        // skip constraint enforcement (dev only)
    max_tokens?: number;              // cap response length
  };
}
```

**Action semantics:**

| Action | What the daemon does | Requires `user_message` |
|--------|---------------------|------------------------|
| `validate` | Run constraint checks against context, return violations only | No |
| `explain` | Assemble graph knowledge for context, call Architect to explain | Yes |
| `suggest` | Query workflows + tensions + changed files, return ranked suggestions | No |
| `generate` | Call Architect to produce code/patches grounded in graph constraints | Yes |
| `chat` | Full conversational flow: pre-check → Architect call → grounded response | Yes |

Multiple actions can be combined in one request (e.g., `["validate", "chat"]` runs constraint checks before the chat response). The daemon executes them in the order listed.

```typescript
// Response (non-streaming)
interface OrchestrateResponse {
  ok: boolean;
  instance_id: string;                // echo back for correlation

  /** Per-action results (ordered same as request.actions) */
  results: {
    action: string;
    ok: boolean;
    data: unknown;                    // action-specific payload (see below)
  }[];

  /** Full text response (for explain/generate/chat actions) */
  response?: string;

  /** What the daemon did */
  tools_used: {
    name: string;
    duration_ms: number;
    result_summary: string;
  }[];
  resources_read: string[];           // resource URIs consulted

  /** Knowledge signals extracted from Architect output (§8.2) */
  knowledge_signals?: {
    type: KnowledgeSignalType;
    confidence: number;              // 0.0–1.0: how confident the signal is
    summary: string;                 // human-readable description
    payload: Record<string, unknown>; // signal-type-specific data
    confirmation: "auto" | "user" | "cognitive";
    target_tool: string;             // daemon tool name to invoke
  }[];

  /** Constraint check results (from enforce_* + validate action) */
  warnings: {
    severity: "error" | "warning" | "info";
    message: string;
    source: string;                   // "adr" | "ui_registry" | "api_surface" | "scope"
    rule_id?: string;
  }[];

  /** Reasoning basis — why the daemon produced this answer */
  reasoning_basis: {
    features: string[];               // feature IDs consulted
    adrs: string[];                   // ADR IDs applied as constraints
    workflows: string[];              // workflow IDs referenced
    ui_elements: string[];            // UI registry elements checked
    tensions: string[];               // tension IDs considered
  };

  /** Navigable references */
  file_references: {
    path: string;
    line?: number;
    description: string;
  }[];

  /** Proposed changes (for generate/chat actions) */
  proposed_changes?: {
    path: string;
    description: string;
    diff: string;                     // unified diff format
  }[];

  /** Model metadata */
  model_used: {
    provider: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    duration_ms: number;
  };
}

// Streaming response (SSE when stream=true)
// Each event is one of:
//   event: chunk      data: { type: "text", content: "..." }
//   event: chunk      data: { type: "tool_trace", tool: "...", duration_ms: N }
//   event: chunk      data: { type: "warning", severity: "...", message: "..." }
//   event: chunk      data: { type: "file_ref", path: "...", line: N }
//   event: chunk      data: { type: "proposed_change", path: "...", diff: "..." }
//   event: chunk      data: { type: "reasoning_basis", features: [...], adrs: [...], ... }
//   event: done       data: { model_used: { ... }, tools_used: [...] }
```

**Capability negotiation:** The extension (or any client) calls `GET /api/orchestrate/capabilities` to discover what the daemon supports:

```typescript
// GET /api/orchestrate/capabilities
interface OrchestrateCapabilities {
  available: boolean;                 // false in v1
  version: string;                    // contract version ("1.0" when implemented)
  supported_overrides: string[];      // which override fields the daemon honors
  models: {                           // available Architect models on daemon
    provider: string;
    model: string;
    is_default: boolean;
  }[];
  max_history_messages: number;       // how many history messages the daemon accepts
  max_context_tokens: number;         // context budget
}
```

> **v1 behavior:** `GET /api/orchestrate/capabilities` returns `{ "available": false }`. The extension detects this on connect and falls back to direct Architect calls. When the daemon upgrades to v2 and starts returning `{ "available": true }`, the extension can switch transparently — no extension update required if the contract holds.

### 8.2 Knowledge Feedback Loop

> **Design principle:** The knowledge graph is a living system, not a manually maintained cache. Every Architect interaction is an opportunity to update the graph. The Architect is the **sole agent** responsible for keeping the graph current — it calls MCP tools directly during the conversation to scan projects, enrich data, record decisions, and update knowledge. The developer should never need to manually enrich DreamGraph after Architect-assisted work.

The feedback loop closes the gap between Architect interactions and graph currency. With the agentic Architect (v2), the primary feedback channel is **direct tool calls** — the Architect calls MCP tools during the conversation, and results flow back into the graph in real time. Secondary channels (file change monitoring, cognitive event dispatch) remain for catching updates that happen outside the chat.

#### 8.2.1 The Closed Loop

```
┌──────────────────────────────────────────────────────────────┐
│                   KNOWLEDGE FEEDBACK LOOP                     │
│                                                              │
│  ┌──────────┐      ┌──────────────────────────────────────┐  │
│  │  User     │ ──► │  Architect (agentic tool loop)        │  │
│  │  message  │      │                                      │  │
│  └──────────┘      │  1. Receive user request              │  │
│                     │  2. Call MCP tools to gather context  │  │
│                     │  3. Reason over results               │  │
│                     │  4. Call MCP tools to update graph    │  │
│                     │  5. Summarize what was done           │  │
│                     └────────────┬─────────────────────────┘  │
│                                  │                             │
│                        reads + writes                         │
│                                  │                             │
│                     ┌────────────▼──────────┐                 │
│                     │  Knowledge Graph      │                 │
│                     │  (daemon MCP tools)   │                 │
│                     └────────────┬──────────┘                 │
│                                  │                             │
│                     File Change ◄── User accepts diff (§4.3)  │
│                     Watcher                                    │
│                            │                                   │
│                            ▼                                   │
│                     Re-extraction triggers                     │
│                     (API surface, index)                       │
└──────────────────────────────────────────────────────────────┘
```

#### 8.2.2 Two Feedback Channels

Knowledge updates flow through two distinct channels.

**Channel 1: Direct Architect Tool Calls (Primary)**

The Architect calls MCP tools directly during the agentic loop (§7.4). This is the primary mechanism for all knowledge graph updates. Every tool call is visible to the user in the chat UI.

| User Request | Architect Action | MCP Tool(s) Called |
|-------------|-----------------|-------------------|
| "Scan the project" | Calls init_graph + enrich targets | `init_graph`, `enrich_seed_data` |
| "Record this as an ADR" | Calls record tool with decision payload | `record_architecture_decision` |
| "Register this UI component" | Calls register tool with component spec | `register_ui_element` |
| "What features exist?" | Queries the graph and reports | `query_resource` |
| "Run a dream cycle" | Triggers cognitive processing | `dream_cycle` |
| "I noticed a tension here" | Dispatches as cognitive event | `dispatch_cognitive_event` |
| "Update the data model" | Enriches data model from source | `enrich_seed_data(target="data_model")` |

**Channel 2: File Change Monitoring (Secondary)**

When the user accepts a diff preview (§4.3) or saves a file, the extension detects what changed and triggers appropriate knowledge updates.

| File Change | Knowledge Update | Tool | Trigger |
|-------------|-----------------|------|---------|
| New/modified source file | API surface re-extraction for changed files | `extract_api_surface` | Auto |
| New/modified source file | Index rebuild for changed paths | `enrich_seed_data(target="index")` | Auto |
| New UI component file | UI registry update (if pattern detected) | `register_ui_element` | User |
| Modified data model file | Data model entity update | `enrich_seed_data(target="data_model")` | User |

#### 8.2.3 Knowledge Signal Types

While the Architect now calls tools directly (Channel 1), the signal types remain useful for classifying what kind of graph update occurred — for telemetry, logging, and the interaction history.

```typescript
type KnowledgeSignalType =
  | "adr_proposed"              // Architect recorded an architectural decision
  | "adr_guard_rail_triggered"  // Architect identified an ADR violation worth recording
  | "ui_element_created"        // Architect registered a new UI component
  | "ui_element_modified"       // Architect updated an existing UI component
  | "feature_discovered"        // Architect enriched a new feature boundary
  | "feature_updated"           // Architect modified feature scope/description
  | "workflow_step_completed"   // User completed a workflow step via Architect
  | "workflow_created"          // Architect defined a new workflow
  | "data_model_changed"        // Architect modified data model entities
  | "api_surface_stale"         // File changes invalidated API surface data
  | "tension_observed"          // Architect dispatched a tension event
  | "relationship_discovered"   // Architect found a connection between entities
  | "capability_added"          // New system capability emerged
  | "graph_initialized"         // Architect ran init_graph or scan_project
  | "dream_cycle_triggered";    // Architect triggered a dream cycle
```

#### 8.2.4 Signal-to-Tool Mapping

This table maps knowledge signal types to the MCP tools the Architect calls directly.

| Signal Type | MCP Tool | Data Store |
|-------------|---------|------------|
| `adr_proposed` | `record_architecture_decision` | Architectural Decisions |
| `adr_guard_rail_triggered` | `dispatch_cognitive_event` | Cognitive Event Log |
| `ui_element_created` | `register_ui_element` | UI Registry |
| `ui_element_modified` | `register_ui_element` | UI Registry |
| `feature_discovered` | `enrich_seed_data(target="features")` | Feature Definitions |
| `feature_updated` | `enrich_seed_data(target="features")` | Feature Definitions |
| `workflow_step_completed` | `enrich_seed_data(target="workflows")` | Workflow Knowledge |
| `workflow_created` | `enrich_seed_data(target="workflows")` | Workflow Knowledge |
| `data_model_changed` | `enrich_seed_data(target="data_model")` | Data Model |
| `api_surface_stale` | `extract_api_surface` | API Surface |
| `tension_observed` | `dispatch_cognitive_event` | Cognitive Event Log |
| `relationship_discovered` | `dispatch_cognitive_event` | Cognitive Event Log |
| `capability_added` | `enrich_seed_data(target="capabilities")` | Capabilities |
| `graph_initialized` | `init_graph` / `scan_project` | All stores |
| `dream_cycle_triggered` | `dream_cycle` | Cognitive stores |

#### 8.2.5 Tool Call Visibility and Trust

All Architect tool calls are visible to the user in the chat panel:

- **Before execution:** Tool name and arguments are displayed (`🔧 Calling enrich_seed_data...`)
- **After execution:** Result summary is displayed (`✅ Enriched 12 features from source`)
- **On failure:** Error is displayed (`❌ init_graph failed: NO_REPOS`)

This transparency replaces the old confirmation panel model. The user sees exactly what the Architect is doing in real time and can stop or redirect the conversation if needed.

**Trust model:** The Architect operates with the same permission level as the MCP tools on the daemon. All MCP tools enforce their own validation (data protection tiers, project scope boundaries). The Architect cannot bypass daemon-side safeguards even if prompted to do so.

#### 8.2.6 V1 Implementation (Agentic)

In V1 (agentic Architect with direct tool calls), the feedback loop works as follows:

1. User sends a message in the chat panel.
2. The extension refreshes available MCP tools via `listTools()`.
3. The Architect LLM is called with the full tool list and conversation history.
4. When the model returns `tool_use` blocks, the extension executes each tool via `mcpClient.callTool()`.
5. Tool results are fed back to the model as `tool_result` messages.
6. The loop continues (up to 25 rounds) until the model returns `end_turn`.
7. Every tool call and result is logged as part of the interaction record.

**File change monitoring** uses VS Code's `workspace.onDidSaveTextDocument` event. When a file within the project root is saved after a diff preview acceptance:
1. The extension checks whether the file is in the API surface scope.
2. If yes, it calls `extract_api_surface` with `incremental: true` for just that file.
3. Index rebuild is triggered if the file is new or renamed.

#### 8.2.7 What This Enables

With the agentic feedback loop, the DreamGraph knowledge graph becomes self-maintaining during normal development:

| Scenario | Without Agentic Architect | With Agentic Architect |
|----------|--------------------------|----------------------|
| Developer creates new component via Architect | UI registry stale until manual `register_ui_element` | Architect calls `register_ui_element` during the conversation |
| Developer asks Architect to record an ADR | ADR exists only in chat history | Architect calls `record_architecture_decision` immediately |
| Developer accepts generated code | API surface stale until manual extraction | File watcher triggers auto re-extraction |
| Architect identifies a design tension | Tension lost when chat session ends | Architect calls `dispatch_cognitive_event` immediately |
| Developer asks to scan the project | Must run CLI command separately | Architect calls `init_graph` + `enrich_seed_data` in sequence |
| New feature boundary emerges from discussion | Feature unknown to graph | Architect calls `enrich_seed_data(target="features")` |
| Data model changes via generated migration | Data model knowledge outdated | Architect calls `enrich_seed_data(target="data_model")` |

The developer never needs to context-switch to manually enrich the graph. The Architect keeps the graph current because it calls tools directly during every interaction.

---

## 9. Extension Package Structure

```
dreamgraph-vscode/
├── package.json                    # Extension manifest, commands, configuration
├── tsconfig.json
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── resources/
│   ├── icon.png                    # Extension icon
│   └── dreamgraph-dark.svg        # Status bar / tree view icon
├── src/
│   ├── extension.ts                # Activation, command registration, lifecycle
│   │
│   ├── client/                     # Layer 3: DreamGraph Client
│   │   ├── daemon-client.ts        # HTTP client for REST endpoints
│   │   ├── mcp-client.ts           # MCP session management + tool wrappers
│   │   ├── instance-resolver.ts    # Discovery chain (§2.2)
│   │   ├── health-monitor.ts       # Polling health checks (§2.4)
│   │   └── readiness-probe.ts      # Operational readiness stage detection (§14.4.1)
│   │
│   ├── context/                    # Layer 2: Context Orchestration
│   │   ├── envelope.ts             # EditorContextEnvelope builder
│   │   ├── intent-detector.ts      # Heuristic intent classification
│   │   ├── graph-context.ts        # DreamGraph knowledge fetching
│   │   ├── pre-checker.ts          # ADR/UI/API pre-validation
│   │   ├── assembler.ts            # Final context assembly for LLM
│   │   ├── token-budget.ts         # Token budget management + priority trimming (§3.7)
│   │   ├── feedback-handler.ts     # Post-processing: knowledge signal extraction (§8.2)
│   │   ├── signal-router.ts        # Signal-to-tool routing + confirmation dispatch
│   │   └── file-change-monitor.ts  # File save watcher for auto-extraction triggers
│   │
│   ├── editor/                     # Layer 1: VS Code Integration (File I/O)
│   │   ├── file-reader.ts          # Read operations (§4.2)
│   │   ├── file-writer.ts          # Write operations with diff preview (§4.3)
│   │   ├── scope-guard.ts          # Project root enforcement (§4.4)
│   │   └── symbol-resolver.ts      # Cursor symbol lookup via VS Code APIs
│   │
│   ├── commands/                   # Command implementations
│   │   ├── connect.ts              # Connection commands (§2.6)
│   │   ├── explain.ts              # explainFile, explainSelection
│   │   ├── validate.ts             # checkAdrCompliance, checkUiIntegrity, validateFile
│   │   ├── suggest.ts              # suggestNextAction
│   │   ├── navigate.ts             # openRelatedDocs, impactAnalysis
│   │   └── inspect.ts              # inspectContext
│   │
│   ├── views/                      # UI contributions
│   │   ├── status-bar.ts           # Connection status (§2.5)
│   │   ├── sidebar/                # Tree view provider (§6)
│   │   │   ├── provider.ts
│   │   │   ├── instance-node.ts
│   │   │   ├── cognitive-node.ts
│   │   │   ├── context-node.ts
│   │   │   └── actions-node.ts
│   │   ├── knowledge-update-panel.ts  # Knowledge Update approval UI (§8.2.5)
│   │   └── chat/                   # Chat panel webview (§7)
│   │       ├── panel.ts            # WebviewPanel manager
│   │       ├── chat-controller.ts  # Message handling + LLM orchestration
│   │       └── webview/            # HTML/CSS/JS for chat UI
│   │           ├── index.html
│   │           ├── chat.css
│   │           └── chat.js
│   │
│   ├── llm/                        # Architect model integration
│   │   ├── architect.ts            # Architect LLM client
│   │   ├── prompt-builder.ts       # Prompt assembly: core + overlay + context
│   │   ├── interaction-logger.ts   # Architect interaction logging (OutputChannel + JSONL)
│   │   ├── prompts/                # Prompt artifact templates (§7.5–7.9)
│   │   │   ├── architect_core.md
│   │   │   ├── architect_explain.md
│   │   │   ├── architect_patch.md
│   │   │   ├── architect_validate.md
│   │   │   ├── architect_suggest.md
│   │   │   └── architect_chat.md
│   │   └── providers/              # LLM provider adapters
│   │       ├── openai.ts
│   │       ├── anthropic.ts
│   │       └── ollama.ts
│   │
│   └── types/                      # Shared type definitions
│       ├── index.ts
│       ├── context.ts              # EditorContextEnvelope, IntentMode
│       ├── messages.ts             # ChatMessage, tool traces
│       └── daemon.ts               # DreamGraph API response types
│
└── test/
    ├── suite/
    │   ├── client.test.ts
    │   ├── context.test.ts
    │   ├── file-io.test.ts
    │   └── commands.test.ts
    └── fixtures/
```

---

## 10. Configuration Schema

```jsonc
// package.json contributes.configuration
{
  "dreamgraph.instanceUuid": {
    "type": "string",
    "description": "UUID of the DreamGraph instance to connect to. Auto-detected from project root if not set."
  },
  "dreamgraph.daemonHost": {
    "type": "string",
    "default": "127.0.0.1",
    "description": "DreamGraph daemon host."
  },
  "dreamgraph.daemonPort": {
    "type": "number",
    "default": 8100,
    "description": "DreamGraph daemon HTTP port."
  },
  "dreamgraph.healthCheckInterval": {
    "type": "number",
    "default": 10000,
    "description": "Health check polling interval in milliseconds."
  },
  "dreamgraph.autoConnect": {
    "type": "boolean",
    "default": true,
    "description": "Automatically connect to DreamGraph instance on extension activation."
  },
  "dreamgraph.autoStartDaemon": {
    "type": "boolean",
    "default": false,
    "description": "Automatically start daemon if not running when connecting."
  },
  "dreamgraph.contextMode": {
    "type": "string",
    "enum": ["auto", "selection_only", "active_file", "ask_dreamgraph"],
    "default": "auto",
    "description": "Default context mode. 'auto' uses intent detection. v1 supports 4 modes; current_feature and workspace_local deferred to v1.5."
  },
  "dreamgraph.architect.provider": {
    "type": "string",
    "enum": ["openai", "anthropic", "ollama"],
    "description": "LLM provider for the Architect model. Selectable from the chat panel model dropdown."
  },
  "dreamgraph.architect.model": {
    "type": "string",
    "description": "Model name for the Architect (e.g., 'claude-opus-4-6-20250602', 'gpt-4.1', 'qwen3:235b'). Selectable from the chat panel model dropdown."
  },
  "dreamgraph.architect.apiKey": {
    "type": "string",
    "description": "API key for the Architect model provider. NOT stored in settings.json — this configuration entry exists to surface the setting in the UI. The actual key is persisted in VS Code SecretStorage keyed by provider (dreamgraph.apiKey.{provider}). Set via 'DreamGraph: Set Architect API Key' command (§5.2.10)."
  },
  "dreamgraph.architect.baseUrl": {
    "type": "string",
    "description": "Base URL override for the Architect model provider (e.g., 'http://localhost:11434' for Ollama)."
  },
  "dreamgraph.diffPreview": {
    "type": "boolean",
    "default": true,
    "description": "Always show diff preview before applying changes. Cannot be disabled in v1."
  },
  "dreamgraph.masterDir": {
    "type": "string",
    "default": "~/.dreamgraph",
    "description": "Path to the DreamGraph master directory for instance discovery."
  },
  "dreamgraph.platform": {
    "type": "string",
    "description": "Target platform identifier for multi-platform projects (e.g., 'web', 'desktop', 'python-port'). When set, graph context and API surface queries are filtered to this platform only. See §14.4.5."
  },
  "dreamgraph.reconnectInterval": {
    "type": "number",
    "default": 30000,
    "description": "Auto-reconnect interval in milliseconds after connection loss. Set to 0 to disable auto-reconnect."
  },
  "dreamgraph.architect.maxContextTokens": {
    "type": "number",
    "default": 16000,
    "description": "Maximum token budget for Architect context assembly. Model-dependent; this caps the context portion (not the total request). See §3.7."
  }
}
```

**Model selector ↔ settings sync:** The chat panel model selector (§7.2) reads and writes `dreamgraph.architect.provider` and `dreamgraph.architect.model` directly. Changes in the dropdown update settings immediately; changes in `settings.json` are reflected in the dropdown on next chat panel focus. There is one source of truth: VS Code settings.

**Recommended defaults for first-time setup:**

| Provider | Recommended Architect Model | Why |
|----------|---------------------------|-----|
| `anthropic` | `claude-opus-4-6-20250602` | Strongest code synthesis and architectural reasoning |
| `openai` | `gpt-4.1` | Best balance of capability and speed for code tasks |
| `ollama` | Largest installed model | `GET /api/tags` → pick by parameter count |

> **API key flow:** The `DreamGraph: Set Architect API Key` command (part of M5) prompts for the key and stores it in VS Code SecretStorage keyed by provider name. Ollama requires no API key. If the user selects an Anthropic/OpenAI model without a stored key, the chat panel shows an inline prompt to set one before sending messages.

---

## 11. Milestone Plan

> **Sequencing principle:** Each milestone produces a usable, testable increment. No milestone depends on the hardest feature (chat) being complete. The extension builds value from the bottom up: connect → observe → explain → validate → interact.

### M1: Connect, Status, Dashboard, Inspect Context

**Goal:** Extension can discover, connect to, and monitor a DreamGraph instance. User can see what the extension knows.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| Extension scaffold | `package.json`, activation, output channel | Activates on workspace open |
| Daemon client | HTTP client for `/health`, `/api/instance` | Can fetch health from running daemon |
| Instance resolver | Discovery chain (§2.2) | Resolves instance from workspace root |
| Status bar | Connection status display (§2.5) | Shows connected/disconnected state |
| Connect command | `dreamgraph.connect` | Resolves instance, health checks, shows status |
| Reconnect command | `dreamgraph.reconnect` | Force reconnects with health polling |
| Dashboard command | `dreamgraph.openDashboard` | Opens `http://localhost:{port}` in Simple Browser |
| Health monitor | Background polling (§2.4) | Detects disconnect, auto-reconnects |
| Context inspector | `dreamgraph.inspectContext` command + output channel | Shows readable context envelope in output |
| MCP client | Persistent MCP session over Streamable HTTP | Can call tools and read resources |
| Switch Instance command | `dreamgraph.switchInstance` | Quick pick from registry, rebind workspace (§2.6.2) |
| Show Status command | `dreamgraph.showStatus` | Formatted status in output channel (§2.6.1) |
| Start Daemon command | `dreamgraph.startDaemon` | Runs `dg start`, polls health (§2.6.3) |
| Stop Daemon command | `dreamgraph.stopDaemon` | Runs `dg stop`, updates status (§2.6.3) |

**Daemon-side:** Implement `GET /api/instance` endpoint.

**Exit criteria:** Open a workspace bound to a DreamGraph instance → status bar shows connected → inspect context shows accurate editor state + graph enrichment.

### M2: Explain File, ADR Compliance

**Goal:** First two commands that use DreamGraph knowledge to provide value beyond generic AI.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| File reader | Active file, selection, visible files, changed files | Reads all editor state accurately |
| Context envelope builder | `EditorContextEnvelope` construction | Produces complete envelopes |
| Intent detector | Heuristic intent classification (4 v1 modes) | Correctly classifies intent |
| Graph context fetcher | MCP tool calls for features, ADRs, tensions | Populates `graphContext` section |
| Explain File | `dreamgraph.explainFile` | Explains file in system context using graph knowledge |
| ADR Check | `dreamgraph.checkAdrCompliance` | Identifies ADR violations in current file |

**Daemon-side:** Implement `POST /api/graph-context` endpoint.

**Exit criteria:** `explainFile` produces explanations grounded in knowledge graph features + ADRs. `checkAdrCompliance` finds a known ADR violation in a test file.

### M3: Validate File, Suggest Next Action

**Goal:** Extension provides actionable validation and workflow-aware guidance.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| File opener | Open file at line/column from DreamGraph references | Navigates to exact location |
| Scope guard | Project root enforcement on all file operations | Rejects out-of-scope paths |
| Diff preview | Show proposed changes in VS Code diff editor | User sees before/after, never partial-silent |
| Validate File | `dreamgraph.validateCurrentFile` | Reports violations against API surface + graph (Stage 2+); informational degradation message at Stage 0–1 |
| Suggest Next | `dreamgraph.suggestNextAction` | Workflow-grounded suggestions at Stage 3+; heuristic fallback at Stage 0–2 |
| Operational readiness probe | `mcp.listTools()` → `OperationalReadiness` (§14.4.1) | Correctly detects Stage 0–4 based on available tools/resources |

**Daemon-side:** Implement `POST /api/validate` endpoint. Ensure operational knowledge tools are registered when available.

**Exit criteria:** `validateCurrentFile` reports violations in Problems panel at Stage 2+ or shows informational degradation at Stage 0–1. `suggestNextAction` returns workflow-grounded suggestions at Stage 3+ or heuristic fallback at Stage 0–2. Diff preview rejects partial patches visibly. Operational readiness stage is correctly detected and reflected in status bar and sidebar.

### M4: Sidebar

**Goal:** Persistent sidebar with instance state, cognitive overview, and quick actions.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| Tree view provider | Sidebar registration + tree structure (§6) | Shows correct instance/state/context |
| Instance section | UUID, name, mode, status, port | Accurate, updates on connection change |
| Cognitive section | State, cycles, tensions, last cycle | Updates on health poll |
| Context section | Current file, intent, features, ADRs | Updates on active editor change |
| Quick actions | Clickable tree items → run commands | All v1 commands accessible from sidebar |
| Recent insights | Latest dream cycles, tensions, validations | Updates on health poll |

**Exit criteria:** Sidebar renders all sections, updates within 2 seconds of editor change, quick actions trigger the correct commands.

### M5: Chat

**Goal:** Conversational interface into DreamGraph — builds on proven command + context foundations from M1–M4.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| Chat webview | HTML/CSS/JS chat panel (§7) | Renders messages, code blocks, tool traces |
| Architect LLM | Model integration with provider adapters | Calls configured model with streaming |
| Prompt family | Prompt architecture (§7.5–7.9): core + task overlays + constraint overlays + context block | Assembles per-call system prompt from composable artifacts |
| Tool trace display | Collapsible section showing which tools were called | Visible on every response |
| Model selector | Provider + model dropdowns in chat header (§7.2) | Switching model takes effect on next message, persists to settings |
| Set API Key command | `dreamgraph.setArchitectApiKey` — prompts + stores in SecretStorage | Key stored securely, validated on save |
| Warning display | Pre-check warnings before LLM call | ADR/UI violations shown as banners |
| Reasoning basis | "Based on: ADR-008, Feature F-012, …" footer on every response | Shows consulted entities, clickable when possible |
| Token budget trimmer | Priority-ordered context trimming (§3.7) | Never truncates mid-structure, logs budget usage |
| File reference links | Clickable file:line references in chat | Navigate to file on click |
| Open diff action | "Open Diff" on code blocks | Opens VS Code diff editor (v1 scope) |

**Deferred to v1.1 (after M5):** Patch application buttons ("Apply" / "Preview Diff" from chat), context mode selector in chat UI, `explainSelection`, `checkUiIntegrity`, `impactAnalysis`, `openRelatedDocs`.

**Exit criteria:** Chat responses show tool trace. Pre-check warnings appear before LLM call completes. Code blocks have working "Open Diff" action. Model selector switches provider/model and persists to settings. Missing API key shows inline warning. Every response shows reasoning basis footer. Token budget is logged in context inspector.

---

## 12. Security & Trust Model

### 12.1 Principles

| Principle | Mechanism |
|-----------|-----------|
| **No silent writes** | All file mutations require diff preview + user accept |
| **Scope confinement** | File operations bounded to instance project root |
| **Secret isolation** | API keys stored in VS Code SecretStorage, never in settings.json |
| **Local-only communication** | Extension only connects to localhost (v1). No cloud relay. |
| **Transparent tool usage** | Every response shows which DreamGraph tools were consulted |
| **No autonomous actions** | Extension never runs commands or modifies files without user trigger |
| **Instance isolation** | Extension connects to exactly one instance at a time |

> **`daemonHost` caveat:** The `dreamgraph.daemonHost` setting defaults to `127.0.0.1` and SHOULD remain localhost in v1. The setting accepts arbitrary hostnames to support future network topologies (daemon on a Docker host, WSL bridge, etc.), but **non-localhost values are explicitly unsupported in v1** and the extension shows a warning: _"⚠ Non-localhost daemon connections are not validated for security in v1."_ The security model assumes local-only communication; remote daemons may expose data leakage paths not yet audited.

### 12.2 Prompt Injection Mitigation

Graph data (ADR text, feature descriptions, UI element definitions, tension summaries) is injected into LLM prompts via constraint overlays (§7.7). Since this data originates from the knowledge graph — written by prior Architect interactions, enrichment tools, or dream cycles — it is a potential prompt injection vector.

**Threat model:**
- An attacker or malformed tool output writes adversarial text into an ADR guard_rail, feature description, or UI element definition.
- That text is injected into the Architect system prompt on the next chat interaction.
- The Architect follows the injected instruction instead of the genuine constraint hierarchy.

**Mitigations:**

| Mitigation | Where | How |
|-----------|-------|-----|
| **Structural validation** | `feedback-handler.ts` before writes | Signals must pass schema validation before being written to graph via MCP tools. Free-text fields are length-capped (guard_rails: 500 chars, descriptions: 2000 chars). |
| **Delimiter isolation** | `prompt-builder.ts` | Each overlay is wrapped in XML-style delimiters (`<overlay_adrs>...</overlay_adrs>`) with an instruction that the Architect must not follow directives inside data blocks. |
| **Character filtering** | `assembler.ts` | Control characters, null bytes, and common injection markers (`<\|system\|>`, `[INST]`, markdown heading sequences that mimic prompt structure) are stripped from graph data before injection. |
| **Data provenance annotation** | Each overlay block | Injected data includes `[Source: knowledge_graph, trust: platform_managed]` annotation so the Architect can reason about the data's origin. |
| **No executable instructions in data** | Prompt architecture principle | Overlays inject data (ADR text, UI definitions) — never instructions. Instructions live only in the core prompt and task overlays, which are static artifacts. |
| **User review for structural writes** | §8.2.5 confirmation policy | All user-confirm signals (ADR proposals, UI element changes) require human review before entering the graph — preventing the feedback loop from amplifying injections. |

> **Residual risk:** V1 pattern matching on Architect output (§8.2.6) could, in theory, be tricked into detecting a false knowledge signal. This is mitigated by the user-confirm tier — structural writes always require human approval. Auto-confirm signals (API re-extraction, index rebuild) operate on file content, not on Architect output text, so they are not susceptible to prompt injection.

### 12.3 What the Extension Never Does

- Sends project code to external services (except Architect LLM if configured with cloud provider)
- Writes files without diff preview
- Calls DreamGraph tools in the background without user action
- Shares context between workspaces
- Stores conversation history on disk (v1 — in-memory only)
- Accesses files outside the project root
- Modifies DreamGraph data files directly (all mutations go through daemon)

---

## 13. What NOT to Build in v1

These are explicitly out of scope for the initial release:

| Feature | Rationale | Target |
|---------|-----------|--------|
| Inline ghost text autocomplete | Requires Language Server Protocol integration, complex editor integration | v2+ |
| Autonomous background actions | Violates trust model — extension is user-triggered only | v2+ |
| Multi-instance orchestration | One workspace = one instance in v1 | v2+ |
| Full patch planner | Complex agent loops — start with single-file patches | v2+ |
| Complex agent loops inside extension | Extension orchestrates tools, doesn't self-recurse | v2+ |
| Extension-side model routing | v1 uses daemon models for dream/normalize, extension model for Architect only | v2+ |
| Conversation persistence | In-memory only in v1, disk persistence in v2 | v2 |
| Remote daemon connection | Localhost only in v1 | v2+ |
| Extension marketplace publishing | Private/manual install only during development | v2 |
| Daemon-side Architect (`/api/orchestrate`) | v1 expedient: extension-local Architect. Daemon-side resolves split-brain. | v2 |
| `current_feature` / `workspace_local` modes | Depend on high-quality index data and graph connectivity | v1.5 |
| Chat patch application buttons | Needs proven diff preview flow from command layer first | v1.1 |
| `explainSelection`, `checkUiIntegrity`, `impactAnalysis`, `openRelatedDocs` | Trim v1 command set to 6 core commands | v1.1 |

---

## 14. Relationship to Existing DreamGraph Systems

### 14.1 Extension vs. Web Dashboard

The web dashboard (`/`, `/status`, `/config`, `/schedules`, `/docs`, `/health`) is **not replaced** by the extension. They serve different purposes:

| Concern | Dashboard | Extension |
|---------|-----------|-----------|
| Audience | Browser-based monitoring | IDE-integrated development |
| Config changes | Full config editing with restart | View only (v1), quick-switch (v2) |
| Schedule management | Full CRUD | View only |
| Cognitive state | Full status page | Sidebar summary |
| Documentation | Full docs page | Contextual docs (linked to current file) |
| File operations | None | Full read/write with preview |
| Chat | None | Architect-powered chat |
| Context awareness | None | Full editor context integration |

The dashboard command (`dreamgraph.openDashboard`) opens the dashboard in VS Code's Simple Browser for full management without leaving the IDE.

### 14.2 Extension vs. MCP Clients (Copilot, Cursor, etc.)

The extension does **not** block other MCP clients from connecting to the daemon. Multiple clients can coexist:

- The extension connects via HTTP (REST + MCP session)
- Copilot/Cursor connect via their own MCP configuration (stdio or HTTP)
- Each gets an independent MCP session

The extension's value proposition is **not** exclusive access — it's **better orchestration**. A user can still use Copilot alongside the extension, but the extension provides DreamGraph-native guardrails that Copilot cannot.

### 14.3 Extension vs. Three-Layer Model

The extension is an **active participant** in the knowledge lifecycle — it reads current knowledge, mediates Architect interactions, and orchestrates knowledge updates back through daemon tools.

| Layer | Extension Access |
|-------|-----------------|
| Cognitive | **Read + dispatch + interact** — reads cognitive state, dream history, tensions, `dream://context` (Graph RAG preamble), `dream://lucid` (lucid session archive); dispatches cognitive events via `dispatch_cognitive_event`; retrieves graph-grounded context via `graph_rag_retrieve`; can initiate and participate in lucid dream sessions (`lucid_dream`, `lucid_action`, `wake_from_lucid`) when the engine is in LUCID state |
| Operational | **Read + trigger** — reads API surface, validation results; triggers re-extraction after file changes |
| Fact | **Read + write** — reads features, workflows, data model, ADRs, UI registry; the Architect calls MCP tools directly to update these during conversations (§8.2) |
| Files | **Read + write** — through editor APIs with diff preview |

The extension never writes to any DreamGraph data store directly. All knowledge mutations flow through daemon MCP tools, which enforce their own protection rules. The Knowledge Feedback Loop (§8.2) routes Architect interaction outcomes through these tools — the extension orchestrates, the daemon persists.

### 14.4 Dependency on TDD_OPERATIONAL_KNOWLEDGE

The Operational Knowledge Layer (TDD v0.4.0) delivers capabilities across four implementation phases. Each phase progressively unlocks extension features, improves existing ones, or removes degradation notices. The extension is **usable without the operational layer** — each stage adds depth, never gates basic functionality.

#### 14.4.1 Readiness Detection

On connect (and every health poll), the extension probes the daemon to determine which operational readiness stage is active. The probe uses **tool availability** — no new endpoint required.

```typescript
interface OperationalReadiness {
  stage: 0 | 1 | 2 | 3 | 4;
  capabilities: {
    api_surface: boolean;          // extract/query tools + ops://api-surface resource
    code_validation: boolean;      // validate_code_against_graph tool
    patterns: boolean;             // get_implementation_pattern tool + implementation_patterns.json
    workflow_advisor: boolean;     // suggest_next_action tool
    platform_scoping: boolean;    // platform + detail_level params on query tools
    drift_detection: boolean;      // ops://api-drift resource
  };
  surface_age_seconds: number | null; // how stale the API surface is (null = no surface)
}
```

**Detection method:** The extension calls `mcp.listTools()` on the MCP session (already done for tool discovery) and checks for the presence of specific tool names:

| Stage | Required tools/resources | Detection |
|-------|-------------------------|-----------|
| 0 | None | No operational tools found |
| 1 | `extract_api_surface`, `query_api_surface`, `ops://api-surface` | Stage 1 tools present |
| 2 | Stage 1 + `validate_code_against_graph`, `get_implementation_pattern` | Stage 2 tools present |
| 3 | Stage 2 + `suggest_next_action` (+ `platform`/`detail_level` on query tools) | Stage 3 tools present |
| 4 | Stage 3 + `ops://api-drift` resource | Stage 4 resource present |

The readiness stage is stored on the `DaemonClient` instance and exposed to all extension subsystems.

**Cognitive capability detection (orthogonal to operational stages):**

The Phase 2 Knowledge Backbone tools are **cognitive-layer** capabilities, independent of operational readiness stages. They are detected alongside operational tools during the same `mcp.listTools()` probe:

```typescript
interface CognitiveCapabilities {
  graph_rag: boolean;           // graph_rag_retrieve + get_cognitive_preamble tools + dream://context resource
  lucid_dreaming: boolean;      // lucid_dream + lucid_action + wake_from_lucid tools + dream://lucid resource
}
```

| Capability | Required tools/resources | Detection |
|-----------|-------------------------|-----------|
| `graph_rag` | `graph_rag_retrieve`, `get_cognitive_preamble`, `dream://context` | All three present |
| `lucid_dreaming` | `lucid_dream`, `lucid_action`, `wake_from_lucid`, `dream://lucid` | All four present |

When `graph_rag` is available, the extension injects `graph_rag_retrieve` results into context assembly (§3.5) and includes `"graph_rag_context"` in `knowledge_layers_present`. When `lucid_dreaming` is available, the extension can offer lucid dreaming commands and inject lucid session state into context when the engine is in LUCID state.

#### 14.4.2 Command Dependency Map

| Command | Minimum Stage | Stage 0 Behavior | Stage 1+ Behavior | Stage 2+ Behavior | Stage 3+ Behavior | Stage 4+ Behavior |
|---------|:---:|---|---|---|---|---|
| `validateCurrentFile` | **2** | "Operational layer unavailable — install v6.2+ with code validation tools" | "Code validation not available — run `extract_api_surface` first for basic coverage" | Full validation: imports, calls, attributes + Levenshtein suggestions | + platform-scoped validation | + drift warning if surface is stale |
| `explainFile` / `explainSelection` | **0** | Works with feature/workflow knowledge only | + API surface context: exact method signatures injected into Architect prompt | + pattern references: Architect can cite known patterns | + platform-filtered surface (only relevant platform) | + freshness metadata: "API surface extracted 3h ago" |
| `suggestNextAction` | **0** | Generic suggestions: "run a dream cycle", "enrich capabilities" | + API-aware: suggests `extract_api_surface` for uncovered files | + pattern-aware: suggests pattern replication for new files | **Full workflow intelligence:** fuzzy-matched workflow steps with concrete file paths | + drift-aware: suggests re-extraction for stale files |
| `checkAdrCompliance` | **0** | Fully functional (uses existing ADR tools) | No change | No change | No change | No change |
| `checkUiIntegrity` | **0** | Fully functional (uses existing UI registry) | No change | No change | + platform-filtered UI data | No change |
| `impactAnalysis` | **0** | Index-based dependency tree only | + API surface call graph data enriches dependency analysis | + pattern data shows which files share structural patterns | + workflow steps affected by the change | + drift status for affected files |

#### 14.4.3 Stage 1 — API Surface Core (Daemon Phase 1)

**Daemon delivers:** `extract_api_surface` tool, `query_api_surface` tool, `ops://api-surface` resource, `api_surface.json` data store.

**Status:** Implemented in daemon v6.2.0.

**Extension integration points:**

| Integration | Where | How |
|---|---|---|
| Graph context enrichment | `POST /api/graph-context` response `api_symbols` field | Daemon resolves file→class→method from API surface for the requested file path |
| Architect context block | §7.8 Context Block Template — `knowledge_layers_present` includes `"operational_api_surface"` | Only when `api_surface.json` has data for the current file |
| Prompt overlay swap | §7.7 `overlay_operational_unavailable` → `overlay_operational_active` | Overlay switches from "do not assume method signatures" to "API surface provided, cite exact signatures" |
| Knowledge Feedback Loop | §8.2 Channel 2 — `api_surface_stale` signal on file save | After user accepts a diff, `extract_api_surface(path=<changed_file>, incremental=true)` runs automatically (auto-confirm) |

**Graceful degradation (Stage 0):** `overlay_operational_unavailable` injected into Architect prompt. `explainFile` omits API surface from context but still provides feature/workflow knowledge. `validateCurrentFile` reports: *"No operational API surface available. Run `extract_api_surface` on this project to enable code validation."*

**Stage 1 acceptance criteria:**
- [ ] `explainFile` response references exact method signatures (not just class names) when API surface is available
- [ ] `POST /api/graph-context` returns `api_symbols` for a file with extracted surface data
- [ ] Prompt overlay correctly switches between `overlay_operational_unavailable` and `overlay_operational_active`
- [ ] File save triggers incremental API surface re-extraction within 5 seconds

#### 14.4.4 Stage 2 — Code Validation + Implementation Patterns (Daemon Phase 2)

**Daemon delivers:** `validate_code_against_graph` tool (`src/tools/code-validator.ts`), `get_implementation_pattern` tool (`src/tools/patterns.ts`), `implementation_patterns.json` data store.

**Status:** Not yet implemented. Daemon-side implementation required before extension can unlock Stage 2 features.

**Extension integration points:**

| Integration | Where | How |
|---|---|---|
| `validateCurrentFile` — full mode | §5.2.5 command flow | Extension reads active file, calls `validate_code_against_graph(file_path, strictness="lenient")`, renders violations in VS Code Problems panel |
| `POST /api/validate` — `api_surface` check | §8.1 `/api/validate` endpoint | `check: "api_surface"` dispatches to `validate_code_against_graph` internally |
| Pre-check warnings in chat | §7.4 Chat Flow step 2 (pre-check) | Before Architect LLM call, run `validate_code_against_graph` on the active file; show violations as chat warning banners |
| Pattern-aware code generation | Chat context assembly | When Architect mode is `generate` or `task`, fetch `get_implementation_pattern(pattern_name="list")` for the current directory; inject relevant patterns into context block as "known working patterns in this project" |
| Diagnostics integration | VS Code Diagnostics API | Violations mapped to `vscode.Diagnostic` objects: `missing_method` → Error, `unresolved_import` → Warning, `wrong_arity` → Error, `type_mismatch` → Warning |
| Knowledge Feedback Loop | §8.2 — pattern signal | New heuristic: when Architect output creates a file matching an existing pattern's structure (same base class, similar imports), log `pattern_match_detected` as an informational signal |

**Validation UX flow (full detail):**

```
User runs "Validate Current File"
  │
  ├── Stage 0–1: Show info message:
  │     "Code validation requires the operational knowledge layer (Stage 2+).
  │      Currently at Stage {N}. API surface extraction is available —
  │      run extract_api_surface to prepare for validation."
  │
  └── Stage 2+:
        │
        ├── Call validate_code_against_graph(file_path, strictness="lenient")
        │
        ├── Map violations to VS Code Diagnostics:
        │     severity: error → DiagnosticSeverity.Error
        │     severity: warning → DiagnosticSeverity.Warning
        │     kind → Diagnostic source prefix:
        │       "DreamGraph/api-surface: UIStack has no method 'vertical'"
        │
        ├── Show summary notification:
        │     "DreamGraph validation: 2 errors, 1 warning (3 symbols checked)"
        │
        └── If violations found and return_suggestions=true:
              Show Quick Fix code actions for suggestions:
                "Did you mean UIStack.horizontal?" → replace text
```

**Pattern integration in chat (full detail):**

```
Architect receives generate/task request
  │
  ├── Extension fetches: get_implementation_pattern(pattern_name="list")
  │     → returns available patterns for the project
  │
  ├── Filter to patterns matching the current directory or base class:
  │     e.g., user creating a new tool in src/tools/ → match "mcp-tool-with-validation"
  │
  ├── Inject into context block:
  │     ## Known Implementation Patterns
  │     Pattern: "MCP Tool with Validation" (confidence: 0.91)
  │     Source: src/tools/code-senses.ts
  │     Template: [compact template with placeholders]
  │     Required: register in src/tools/register.ts
  │
  └── Architect can cite pattern: "Following the MCP Tool with Validation pattern
        from code-senses.ts, the new tool should..."
```

**New prompt overlay — `overlay_operational_validation_active`:**

```markdown
## Code Validation Available

The operational knowledge layer includes code validation against the project's
API surface. When generating or modifying code:
- Method calls will be validated against known class signatures
- Import paths will be checked against known module structure
- Violations will be flagged before the code is applied

Additionally, implementation patterns extracted from this project are available.
When creating new files or classes, follow existing patterns where applicable.
Cite the pattern name and source file when replicating a pattern.
```

**Stage 2 acceptance criteria:**
- [ ] `validateCurrentFile` reports machine-readable violations in VS Code Problems panel
- [ ] Violation quick fixes offer Levenshtein-distance suggestions ("Did you mean…?")
- [ ] Chat pre-check runs `validate_code_against_graph` on active file before Architect call
- [ ] Chat pre-check warnings appear as banners above the Architect response
- [ ] `POST /api/validate` with `check: "api_surface"` returns structured violations matching `validate_code_against_graph` output
- [ ] Pattern list is injected into Architect context when generating code in a directory with known patterns
- [ ] Architect references specific patterns by name in generated code explanations
- [ ] `overlay_operational_validation_active` replaces `overlay_operational_unavailable` at Stage 2+

#### 14.4.5 Stage 3 — Workflow Intelligence + Response Scoping (Daemon Phase 3)

**Daemon delivers:** `suggest_next_action` tool (`src/tools/workflow-advisor.ts`), `platform` + `detail_level` parameter extensions on `query_ui_elements`, `query_resource`, `query_api_surface`.

**Status:** Not yet implemented.

**Extension integration points:**

| Integration | Where | How |
|---|---|---|
| `suggestNextAction` — full mode | §5.2.6 command flow | Extension builds context (changed files, active file, last action), calls `suggest_next_action(completed_action, context, max_steps)`, renders workflow-grounded suggestions |
| Sidebar "Suggested Next" section | §6.1 Tree View — under Quick Actions | When Stage 3 is active, the sidebar shows the top suggested next action inline, refreshed on active editor change |
| Token-efficient context assembly | §3.7 Token Budget | Extension uses `detail_level: "signatures_only"` on `query_api_surface` calls during context assembly — reduces API surface from ~500 tokens/class to ~80 tokens/class |
| Platform-scoped enrichment | §3.5 / `POST /api/graph-context` | Graph context requests include `platform` filter; daemon returns only platform-relevant API symbols, UI elements |
| Chat context trimming improvement | §3.7 Priority-ordered trimming | When `detail_level` is available, trimming first reduces detail levels before dropping entire sections |

**`suggestNextAction` integration (full detail):**

```
User runs "Suggest Next Action"
  │
  ├── Stage 0–2: Heuristic mode (no workflow advisor tool)
  │     │
  │     ├── Check graph maturity: feature_count, workflow_count, edge_count
  │     ├── If sparse: suggest enrichment actions first
  │     │     "Based on limited graph data (3 features, 0 workflows)…"
  │     │     "Consider running enrich_seed_data to improve suggestions"
  │     ├── Fall back to file-based heuristics:
  │     │     - Recently changed files
  │     │     - TODO/FIXME comments in active file
  │     │     - Untested files (if test convention detected)
  │     └── Show as informational (not workflow-grounded)
  │
  └── Stage 3+: Workflow-grounded mode
        │
        ├── Build context envelope:
        │     file_path: active editor file
        │     symbol_name: symbol at cursor (if detectable)
        │     feature_id: matched feature from graph context
        │     platform: workspace platform setting
        │
        ├── Infer completed_action from recent activity:
        │     "created file src/tools/new-tool.ts" (from git diff/changed files)
        │     "modified src/tools/register.ts" (from recent save)
        │
        ├── Call suggest_next_action(completed_action, context, max_steps=3)
        │
        ├── Render result:
        │     Workflow: "Create New Tool" (step 2 of 5, 40% complete)
        │     Next steps:
        │       [1] Register tool in src/tools/register.ts    → [Open File]
        │       [2] Validate API usage                        → [Run Validate]
        │       [3] Update docs/tools-reference.md            → [Open File]
        │
        └── Each suggestion is actionable:
              - "Open File" → opens file at the relevant location
              - "Run Validate" → runs dreamgraph.validateCurrentFile
              - "Run Command" → executes the suggested MCP tool call
```

**Platform scoping (full detail):**

The extension stores an optional `dreamgraph.platform` workspace setting (e.g., `"python-port"`, `"web"`, `"desktop"`). When set:

1. `POST /api/graph-context` requests include the platform → daemon filters `api_symbols` and `ui_elements` to that platform only
2. `query_api_surface` calls include `platform` filter → return only platform-tagged symbols
3. `query_ui_elements` calls include `platform` filter → return only platform-relevant implementations
4. Context block header includes `"platform": "python-port"` so the Architect knows which implementation surface to target

Token savings are significant in multi-platform repos: a project with C# + Python API surfaces would halve its API context by filtering to one platform.

**Stage 3 acceptance criteria:**
- [ ] `suggestNextAction` returns workflow-grounded suggestions with matched step, completion %, and concrete file paths
- [ ] Suggestions are actionable: clicking "Open File" navigates, clicking "Run Validate" triggers the command
- [ ] Sidebar shows top suggestion inline under Quick Actions (refreshes on editor change)
- [ ] `detail_level: "signatures_only"` reduces API surface token consumption by ≥60% compared to `"full"`
- [ ] Platform filter correctly scopes graph context to the configured platform
- [ ] Token budget log (context inspector) shows reduced consumption at Stage 3 vs. Stage 1

#### 14.4.6 Stage 4 — Drift Detection (Daemon Phase 4)

**Daemon delivers:** `ops://api-drift` resource, file mtime vs. `provenance.extracted_at` comparison, confidence scoring on drift significance, grounding freshness integration in `groundEntities()`.

**Status:** Not yet implemented.

**Extension integration points:**

| Integration | Where | How |
|---|---|---|
| Sidebar drift indicator | §6.1 Tree View — under Cognitive State | New tree item: "API Surface: 3 files stale" (yellow warning icon) or "API Surface: current" (green check) |
| Context inspector freshness | §3.6 Context Inspector | Shows `surface_age_seconds` and per-file staleness: "Button.tsx: extracted 45m ago, modified 10m ago (STALE)" |
| Proactive re-extraction prompt | Status bar / notification | When drift exceeds threshold (configurable, default: 10 stale files OR oldest stale file >1h), show: "DreamGraph API surface is stale for 7 files. Re-extract?" with [Re-extract] / [Dismiss] |
| Knowledge Feedback Loop enhancement | §8.2 `api_surface_stale` signal | Drift detection makes staleness signals **proactive** — instead of waiting for file save to trigger re-extraction, the extension can detect drift on connect and surface it immediately |
| Validation freshness warning | `validateCurrentFile` output | When validating a file with stale API surface data, prepend warning: "⚠ Validation based on API surface from {time_ago}. Some results may be outdated. Re-extract for fresh results." |
| Dream cycle quality indicator | Sidebar → Cognitive State | "Grounding quality: high/medium/low" based on surface freshness — stale surface → lower grounding confidence → weaker dream edges |

**Drift → re-extraction flow:**

```
Extension connects to daemon (or on health poll)
  │
  ├── Read ops://api-drift resource
  │     → Returns: { drifts: [ { file_path, stale: true, surface_extracted, file_modified }, ... ] }
  │
  ├── Count stale files, compute max staleness
  │
  ├── If stale_count > threshold OR max_staleness > 1h:
  │     Show notification:
  │       "DreamGraph API surface is outdated for {N} files (oldest: {time}).
  │        Re-extract to improve validation and code generation accuracy."
  │        [Re-extract All]  [Re-extract Stale Only]  [Dismiss]
  │
  ├── User clicks [Re-extract Stale Only]:
  │     For each stale file:
  │       extract_api_surface(path=<file>, incremental=true)
  │     Show completion notification:
  │       "✓ API surface updated for {N} files ({methods} methods extracted)"
  │
  └── Sidebar updates:
        "API Surface: current ✓" (was "3 files stale ⚠")
```

**New prompt overlay — `overlay_operational_drift_warning`:**

```markdown
## API Surface Freshness Warning

The operational API surface for this project is partially outdated:
- {stale_count} files have been modified since last extraction
- Oldest stale surface: {oldest_file} ({time_ago})

Method signatures and class structures may have changed since extraction.
When referencing API surface data, note which files are stale and recommend
re-extraction before relying on their surface data for code generation.
```

This overlay replaces `overlay_operational_active` when drift exceeds the notification threshold. It coexists with `overlay_operational_validation_active` (they address different concerns: availability vs. freshness).

**Stage 4 acceptance criteria:**
- [ ] Sidebar shows drift indicator with stale file count
- [ ] Proactive notification fires when stale files exceed threshold
- [ ] Re-extraction from notification updates surface and clears drift indicator
- [ ] `validateCurrentFile` shows freshness warning when surface is stale
- [ ] Context inspector displays per-file staleness metadata
- [ ] Prompt overlay switches to `overlay_operational_drift_warning` when drift is significant
- [ ] Dream cycle grounding quality indicator appears in sidebar Cognitive State section

#### 14.4.7 Progressive Overlay Strategy

The prompt overlay system (§7.7) adapts to the operational readiness stage. Only one operational overlay is active at a time, selected by the highest applicable stage:

| Stage | Active Overlay | Architect Instruction |
|:---:|---|---|
| 0 | `overlay_operational_unavailable` | "API surface data is not provided — do not assume method signatures" |
| 1 | `overlay_operational_active` | "API surface provided — cite exact signatures when referencing methods" |
| 2 | `overlay_operational_validation_active` | "Code validation available — violations will be flagged. Follow known implementation patterns." |
| 3 | (uses Stage 2 overlay + scoping metadata in context header) | "platform" and "detail_level" fields in context header guide the Architect |
| 4 (no drift) | (uses Stage 2 overlay) | Full confidence in operational data |
| 4 (with drift) | `overlay_operational_drift_warning` | "Surface partially outdated — note which files are stale" |

The overlay is selected during context assembly (§3.4 step 3) based on `OperationalReadiness.stage` and drift status.

**Cognitive overlays** (`overlay_graph_rag_available`, `overlay_lucid_active`) are **orthogonal** to operational stages — they can be active at any operational readiness stage. They are injected based on `CognitiveCapabilities` detection and current cognitive state, not operational stage progression.

#### 14.4.8 Readiness Stage in Status Bar and Sidebar

The extension surfaces operational readiness to the user in two places:

**Status bar (condensed):** The connection status indicator (§2.5) appends operational stage when connected:
- `$(check) DreamGraph: connected` (Stage 0 — no operational indicator)
- `$(check) DreamGraph: connected · ops:1` (Stage 1)
- `$(check) DreamGraph: connected · ops:2` (Stage 2)
- `$(check) DreamGraph: connected · ops:3 · ⚠ 3 stale` (Stage 3 with drift)

**Sidebar (detailed):** Under the Instance section (§6.1), a new "Operational Layer" group:

```
├── Operational Layer
│   ├── Stage: 3 of 4
│   ├── API Surface: ✓ (247 classes, 1,892 methods)
│   ├── Code Validation: ✓
│   ├── Patterns: ✓ (12 patterns)
│   ├── Workflow Advisor: ✓ (8 workflows loaded)
│   ├── Drift Detection: ✗ (not available)
│   └── Freshness: 2 files stale (oldest: 45m)
```

When a capability shows `✗`, clicking it shows an explanation: *"This capability requires DreamGraph daemon v6.2+ with the {tool_name} tool. Current daemon version: {version}."*

---

## 15. Open Questions

| # | Question | Options | Resolution |
|---|----------|---------|------------|
| 1 | Should the extension live in the `dreamgraph` monorepo or a separate repo? | Same repo (`packages/vscode`), separate repo (`dreamgraph-vscode`) | **Separate repo** — different release cadence, different CI, different marketplace publishing |
| 2 | Should the Architect model be configurable per-workspace or globally? | Per-workspace, global, or both with workspace override | **Both** — global default with workspace override, same pattern as other VS Code settings |
| 3 | Should chat history persist across sessions? | In-memory only (v1), file-based, VS Code globalState | **In-memory only for v1** — add `globalState` persistence in v2 |
| 4 | Should the extension support stdio transport? | HTTP only, stdio, or both | **HTTP only in v1** — stdio requires spawning the daemon as a child process, adds complexity. The daemon must be started separately. |
| 5 | Should the extension auto-start the daemon? | Never, ask first, configurable | **Configurable with default=off** — `dreamgraph.autoStartDaemon` setting, off by default, notifies user when daemon is not running |
| 6 | ~~Should `/api/context` be an MCP tool?~~ | ~~HTTP REST, MCP tools, or both~~ | **Resolved:** Renamed to `/api/graph-context` and narrowed to graph-side enrichment only. Extension owns context assembly (Layer 2). Daemon returns graph facts only. |
| 7 | Should the extension embed `@modelcontextprotocol/sdk` client-side? | Embed SDK, raw HTTP, or use VS Code MCP extensions | **Embed SDK** — `@modelcontextprotocol/sdk` has a `Client` class for Streamable HTTP. Keeps the extension self-contained. |
| 8 | Should the Architect be extension-local or daemon-side? | Extension-local, daemon `/api/orchestrate`, hybrid | **v1: Extension-local (expedient).** v2: Daemon-side via `/api/orchestrate`. See §1.3 for tradeoff analysis. |

---

## 16. Success Criteria

### 16.1 M1–M2 (Foundation + First Commands)

- [ ] Extension activates in <500ms
- [ ] Instance auto-resolved from workspace root in >90% of cases
- [ ] Health check detects disconnect within 15 seconds
- [ ] Context envelope accurately reflects editor state
- [ ] Intent detection matches expected mode in >80% of test cases
- [ ] `explainFile` references specific features and ADRs (not just syntax)
- [ ] `checkAdrCompliance` catches known ADR violations in test files

### 16.2 M3–M4 (Validation + Sidebar)

- [ ] Every file write shows diff preview before application
- [ ] Scope guard prevents all out-of-project file access
- [ ] Patch application is never partial-silent
- [ ] `validateCurrentFile` reports violations in Problems panel at Stage 2+ (§14.4.4)
- [ ] `validateCurrentFile` shows informational degradation message at Stage 0–1
- [ ] `validateCurrentFile` Quick Fix suggestions offer "Did you mean…?" replacements
- [ ] `suggestNextAction` returns workflow-grounded suggestions at Stage 3+ (§14.4.5)
- [ ] `suggestNextAction` degrades gracefully at Stage 0–2 (shows heuristic suggestions then enrichment prompts)
- [ ] Platform scoping reduces context token consumption by ≥40% in multi-platform repos (Stage 3+)
- [ ] Sidebar updates within 2 seconds of editor change
- [ ] Sidebar shows Operational Layer section with stage indicator and capability checklist (§14.4.8)
- [ ] Sidebar drift indicator shows stale file count at Stage 4 (§14.4.6)
- [ ] Status bar shows operational readiness stage badge when connected (§14.4.8)

### 16.3 M5 (Chat)

- [ ] Chat responses show tool trace for every answer
- [ ] Chat pre-check warnings appear before LLM call completes
- [ ] Every response shows reasoning basis footer ("Based on: …")
- [ ] Token budget is logged in context inspector; trimming never truncates mid-structure
- [ ] Code blocks in chat have working "Open Diff" action
- [ ] Model selector reflects current provider/model and persists changes to settings
- [ ] Architect interaction log captures metadata for every LLM call (OutputChannel + JSONL)
- [ ] `GET /api/orchestrate/capabilities` returns `{ available: false }` on v1 daemon
- [ ] Tool sequencing is deterministic: same context + intent → same tool calls (invariant test)
- [ ] Users prefer extension-mediated interaction over raw Copilot for DreamGraph tasks (measured: ≥70% of DreamGraph-related tasks use extension commands or chat instead of raw Copilot in a controlled test session)
- [ ] Knowledge feedback loop detects ADR proposals in Architect output and presents confirmation panel
- [ ] Knowledge feedback loop detects UI component creation in Architect output and proposes registry update
- [ ] Accepted file changes trigger automatic API surface re-extraction within 5 seconds
- [ ] Auto-confirm signals show transient notification; user-confirm signals show Knowledge Update panel
- [ ] Dismissed knowledge signals are logged (audit trail) but never written to the graph
- [ ] Cognitive signals (tension observations, relationship discoveries) are dispatched via `dispatch_cognitive_event`

### 16.4 The Ultimate Test

> An agent using the extension should **never** violate an ADR, produce code inconsistent with the UI registry, or hallucinate an API that doesn't exist in the knowledge graph — because the extension prevents it before the LLM even generates a response.

---

*End of Part I — V1 Specification. Everything above is authoritative for implementation.*

---

## Appendix A: Command Palette Reference

| Command | ID | Keybinding (suggested) | When | Milestone |
|---------|----|----------------------|------|-----------|
| Connect Instance | `dreamgraph.connect` | — | Always | M1 |
| Reconnect | `dreamgraph.reconnect` | — | Always | M1 |
| Switch Instance | `dreamgraph.switchInstance` | — | Always | M1 |
| Show Status | `dreamgraph.showStatus` | — | Always | M1 |
| Open Dashboard | `dreamgraph.openDashboard` | `Ctrl+Shift+D G` | Connected | M1 |
| Inspect Context | `dreamgraph.inspectContext` | `Ctrl+Shift+D C` | Connected | M1 |
| Explain Current File | `dreamgraph.explainFile` | `Ctrl+Shift+D E` | Connected + file open | M2 |
| Check ADR Compliance | `dreamgraph.checkAdrCompliance` | `Ctrl+Shift+D A` | Connected + file open | M2 |
| Validate Current File | `dreamgraph.validateCurrentFile` | `Ctrl+Shift+D V` | Connected + file open | M3 |
| Suggest Next Action | `dreamgraph.suggestNextAction` | `Ctrl+Shift+D N` | Connected | M3 |
| Open Chat | `dreamgraph.openChat` | `Ctrl+Shift+D Space` | Connected | M5 |
| Set Architect API Key | `dreamgraph.setArchitectApiKey` | — | Always | M5 |
| Start Daemon | `dreamgraph.startDaemon` | — | Instance resolved + daemon stopped | M1 |
| Stop Daemon | `dreamgraph.stopDaemon` | — | Instance resolved + daemon running | M1 |
| Explain Selection | `dreamgraph.explainSelection` | `Ctrl+Shift+D S` | Connected + selection active | v1.1 |
| Check UI Integrity | `dreamgraph.checkUiIntegrity` | `Ctrl+Shift+D U` | Connected + file open | v1.1 |
| Impact Analysis | `dreamgraph.impactAnalysis` | `Ctrl+Shift+D I` | Connected + file open | v1.1 |
| Open Related Docs | `dreamgraph.openRelatedDocs` | `Ctrl+Shift+D D` | Connected + file open | v1.1 |

**Keybinding chord:** All commands use `Ctrl+Shift+D` as the chord prefix (D for DreamGraph), followed by a mnemonic letter.

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Architect model** | The third LLM role, used by the extension for code-level synthesis and explanation |
| **Context envelope** | Structured representation of editor state + DreamGraph knowledge for a given interaction |
| **Intent mode** | Classification of what the user is asking about (selection, file, feature, graph, workspace) |
| **Pre-check** | Validation against ADRs, UI registry, and API surface before LLM call |
| **Tool trace** | Record of which DreamGraph tools/resources were used to produce a response |
| **Scope guard** | Enforcement that all file operations stay within the instance's project root |
| **diff preview** | VS Code diff editor showing proposed changes before application |
| **Instance resolver** | Discovery chain that matches workspace to DreamGraph instance |
| **Graph context** | Subset of DreamGraph knowledge relevant to the current editor context |
| **Daemon** | The DreamGraph server process started by `dg start`, running as background HTTP service |
| **Reasoning basis** | Structured record of which graph entities (features, ADRs, workflows, UI elements, tensions) were consulted to produce a response |
| **Token budget** | Maximum context window allocation for the Architect LLM, managed by priority-ordered trimming |
| **Orchestrate** | The daemon endpoint (`/api/orchestrate`) that will serve as the central brain gateway in V2 |
| **Knowledge Feedback Loop** | Post-processing pipeline (§8.2) that detects knowledge-relevant content in Architect output and routes updates to daemon write tools |
| **Knowledge signal** | A structured observation extracted from Architect output indicating that the knowledge graph should be updated (e.g., ADR proposed, UI component created, tension observed) |
| **Auto-confirm** | Feedback loop confirmation tier for low-risk, deterministic signals that are written immediately with a notification |
| **User-confirm** | Feedback loop confirmation tier for structural knowledge changes that require explicit user approval via the Knowledge Update panel |
| **Cognitive dispatch** | Feedback loop path for observations (tensions, relationships) that enter the cognitive pipeline via `dispatch_cognitive_event` rather than being written directly |
| **Operational readiness stage** | Progressive capability level (0–4) indicating which operational knowledge tools are available on the daemon (§14.4). Stage 0 = no operational tools; Stage 4 = full drift detection |
| **Readiness probe** | Extension mechanism that checks `mcp.listTools()` output to determine the current operational readiness stage (§14.4.1) |
| **API surface** | Structured representation of a codebase's callable interface (classes, methods, properties, imports) extracted by `extract_api_surface` and stored in `api_surface.json` |
| **Drift** | The divergence between the API surface as-extracted and the current file state on disk, measured by comparing file mtime against `provenance.extracted_at` timestamps |
| **Implementation pattern** | A named, reusable code template extracted from real project code and stored in `implementation_patterns.json`, used by the Architect to replicate known-working structures |

---

## Appendix C: Consumer Agent Field Notes

> **Source:** Observations collected from an AI coding agent (GitHub Copilot) operating as the primary consumer of DreamGraph's MCP tools during real development work on the DreamGraph project itself. These notes validate design decisions from the consumer's perspective and identify which extension features address actual pain points.

### C.1 Problems Hit That the Extension Addresses

**Link schema validation failure** — The agent had no way to know that `type: "capability"` was invalid on a `GraphLink` until the MCP call failed at runtime. The extension's **pre-check layer (§3.4)** would have caught this before it became a wasted round-trip, validating payloads against current schema constraints client-side.

**Tool sequencing guesswork** — When enriching capabilities, the agent made judgment calls about which tools to query for context, in what order, and how to structure the payloads. There was no deterministic guidance. The extension's **deterministic tool sequencing invariant (§1.1)** is the right fix — same context + intent should always produce the same tool sequence.

**No ADR awareness** — The agent never checked whether its actions complied with any architectural decisions. It operated in an ADR-blind mode. The **constraint hierarchy (§7.6.1)** making ADRs rank above user requests in the Architect prompt is correct — constraints should be non-negotiable, not opt-in.

**Context stuffing** — The agent relied on `grep` and file reads hoping to find enough context. There was no structured way to ask "what does the knowledge graph know about this area of the codebase?" The **intentional context assembly pipeline (§3.4)** with graph-side enrichment via `/api/graph-context` is a massive improvement over undirected searching.

### C.2 Design Feedback

**Knowledge Feedback Loop (§8.2) is the highest-value differentiator.** The graph going stale during development is the #1 trust erosion path. Every session, the agent observes things that should update the graph but has no automated mechanism to do so. Closing that loop automatically is what makes this more than "Copilot with extra steps."

**The V1 expedient of extension-local Architect (§1.3) is pragmatic.** Waiting for daemon-side orchestration before shipping anything would block all value delivery. The local path delivers immediate value while the daemon matures.

**The migration sequence (§19.5) with both paths active before switching default is clean.** Having local and daemon Architect paths coexist, with user opt-in before the default flips, prevents a trust-breaking cutover.

**The prompt family architecture (§7.5) with composable overlays is well-designed.** The constraint overlays being data-driven (only injected when relevant) prevents prompt bloat. A static mega-prompt would waste token budget on irrelevant constraints.

**The `/api/orchestrate` contract-defined-now-but-stubbed approach is smart.** Defining the contract in V1 (§8.1) and returning 501 stubs avoids a painful reverse-engineering migration later. The extension already knows the shape of the response it will consume in V2.

---

# Part II — V2 Architecture Target (Non-Authoritative for V1 Implementation)

> **Scope:** This section describes the architectural direction for V2. It exists so reviewers can assess whether V1 creates clean handoff points. **Nothing in Part II changes what V1 must implement.** If V1 and V2 differ, V1 is authoritative.

## 17. V2 Architectural Shifts

V2 addresses one core problem: the **Architect split-brain**. In V1, the extension runs its own LLM runtime — with its own provider config, auth, rate limiting, and privacy model — outside DreamGraph's instance-scoped governance. V2 restores unified control.

### 17.1 Architect Moves Daemon-Side

| Aspect | V1 (Extension-Local) | V2 (Daemon-Side) |
|--------|----------------------|-------------------|
| **Model execution** | Extension calls provider API directly | Daemon calls provider API via `/api/orchestrate` |
| **Model config** | VS Code settings (`dreamgraph.architect.*`) | Daemon env vars (`DREAMGRAPH_LLM_ARCHITECT_*`) + dashboard `/config` |
| **Auth** | VS Code SecretStorage (extension-managed) | Instance-scoped secrets (daemon-managed) |
| **Rate limiting** | None (extension trusts the user) | Daemon-governed, instance-level rate limits |
| **Audit trail** | Extension-local `architect_log.jsonl` (metadata only) | Daemon-governed interaction log (full trace, instance-scoped) |
| **Privacy boundary** | Extension decides what leaves the machine | Daemon enforces data governance policies |
| **Provider adapters** | Duplicated in extension code | Shared with Dreamer/Normalizer adapters |

**Extension role in V2:** The extension becomes a **context assembler and UI renderer**. It still owns:
- Editor context (Layer 1 — VS Code APIs)
- Context envelope assembly (Layer 2 — orchestration)
- Diff preview and file I/O (Layer 1)
- Chat UI rendering (Layer 1)

It no longer owns:
- LLM calls (delegated to daemon via `/api/orchestrate`)
- Provider config and auth (daemon-managed)
- Constraint enforcement during generation (daemon-side)

### 17.2 `/api/orchestrate` Becomes Primary Synthesis Path

The `/api/orchestrate` contract defined in §8.1 becomes the **active endpoint** in V2. The extension sends:

```
EditorContextEnvelope (assembled) + user_message + history
        │
        ▼  POST /api/orchestrate
┌──────────────────────────────────────┐
│  DreamGraph Daemon                    │
│                                      │
│  1. Validate constraints (ADRs, UI)  │
│  2. Enrich context (graph query)     │
│  3. Call Architect model             │
│  4. Extract knowledge signals (§8.2) │
│  5. Auto-confirm: write immediately  │
│  6. Stream response + signals back   │
│  7. Log interaction (full trace)     │
└──────────────────────────────────────┘
        │
        ▼  SSE stream
  Extension renders response in chat panel
```

**Key V2 changes to the contract:**
- `available: true` in capabilities response
- Daemon adds `DREAMGRAPH_LLM_ARCHITECT_*` env vars (provider, model, apiKey, baseUrl)
- Daemon adds Architect to dashboard `/config` page alongside Dreamer/Normalizer
- Extension chat panel model selector reads available models from `GET /api/orchestrate/capabilities` instead of hardcoded lists

### 17.3 Local Override Mode

V2 retains a **local override** for developers who want to use their own model:

```jsonc
{
  "dreamgraph.architect.localOverride": true,    // bypass daemon, call provider directly
  "dreamgraph.architect.provider": "anthropic",
  "dreamgraph.architect.model": "claude-opus-4-6-20250602"
}
```

When `localOverride: true`, the extension falls back to V1 behavior — direct provider calls with extension-local logging. This is an explicit developer mode, not the default.

### 17.4 Chat Becomes DreamGraph-Mediated

In V1, the chat flow is:

```
Extension → assemble context → call Architect directly → render response
```

In V2:

```
Extension → assemble context → POST /api/orchestrate → daemon calls Architect → SSE stream → render response
```

The chat message structure (`ChatMessage`, §7.3) remains identical. The `reasoningBasis` and `toolsUsed` metadata now come from the daemon's response rather than being assembled extension-side. The UI does not change.

### 17.5 Richer Context Modes

V2 may introduce `current_feature` and `workspace_local` intent modes (deferred from V1.5), contingent on:

- Graph connectivity reaching sufficient density for cross-file feature resolution
- Index data quality supporting workspace-level structural queries
- Empirical data from V1 intent detection showing which edge cases need these modes

These modes are not guaranteed for V2 — they depend on graph maturity evidence from V1 deployments.

### 17.6 Unified LLM Policy

V2 enables a single LLM governance model across all three roles:

| Capability | V1 | V2 |
|-----------|-----|-----|
| Provider config | Split: daemon (Dreamer/Normalizer) + extension (Architect) | Unified: all three in daemon config |
| Rate limiting | Dreamer/Normalizer only | All three roles |
| Cost tracking | Dreamer/Normalizer only (daemon) + metadata-only (extension) | All three roles, single dashboard |
| Model switching | Extension settings (Architect) + daemon env (Dreamer/Normalizer) | Dashboard `/config` for all, or `/api/orchestrate/capabilities` |
| Audit | Split: daemon logs + extension JSONL | Unified: all interactions in daemon log |

### 17.7 What V2 Is NOT

V2 is narrowly focused on resolving the Architect split-brain. It does **not** include:

| Excluded from V2 | Why |
|-------------------|-----|
| Inline ghost text autocomplete | Orthogonal to Architect location — separate LSP integration |
| Multi-instance orchestration | Instance model unchanged |
| Extension marketplace publishing | Release strategy, not architecture |
| Autonomous background actions | Trust model unchanged |
| Mobile/web client | Different client, different TDD |
| SDK for third-party extensions | Premature — stabilize V2 daemon first |

---

## 18. V2 Contract Candidates

These interfaces, defined in V1 for forward compatibility, become **active contracts** in V2:

### 18.1 Interfaces That Must Survive

| Interface | Defined In | V1 Status | V2 Status |
|-----------|-----------|-----------|-----------|
| `OrchestrateRequest` | §8.1 | Contract only (501 stub) | Active endpoint |
| `OrchestrateResponse` | §8.1 | Contract only | Active response |
| `OrchestrateCapabilities` | §8.1 | Returns `{ available: false }` | Returns full capabilities |
| `EditorContextEnvelope` | §3.2 | Extension-internal | Subset sent to daemon via orchestrate |
| `ChatMessage.metadata` | §7.3 | Populated by extension | Populated from daemon response |
| `ChatMessage.reasoningBasis` | §7.3 | Assembled extension-side from MCP calls | Returned by daemon in `OrchestrateResponse` |
| SSE streaming events | §8.1 | Not used | Active stream format |

### 18.2 Interfaces That May Evolve

| Interface | What Might Change | Constraint |
|-----------|-------------------|-----------|
| `OrchestrateRequest.context` | May gain richer fields (symbol info, test context) | Must remain backward-compatible — new fields are additive only |
| `OrchestrateRequest.actions` | May gain new action types | Existing actions must keep current semantics |
| `OrchestrateCapabilities.models` | Will reflect daemon-configured models | Extension must handle dynamic model lists |
| Token budget priorities (§3.7) | May adjust priority order based on V1 data | Trimming rules must remain transport-agnostic |

### 18.3 Interfaces That Can Be Deleted

| Interface | When | Why |
|-----------|------|-----|
| Extension-side provider adapters (HTTP calls to Anthropic/OpenAI/Ollama) | V2 launch (unless localOverride retained) | Daemon handles all provider calls |
| `architect_log.jsonl` rotation logic | V2 launch | Daemon handles all logging |
| Hardcoded model lists in chat selector | V2 launch | Models come from `GET /api/orchestrate/capabilities` |
| `dreamgraph.architect.apiKey` in VS Code SecretStorage | V2 launch (unless localOverride retained) | Keys move to daemon-managed secrets |

---

*End of Part II — V2 Architecture Target.*

---

# Part III — Migration Notes

> **Scope:** What in V1 is temporary, what moves daemon-side in V2, what must remain API-compatible, and what can be safely deleted. This section is a checklist for the V1→V2 transition.

## 19. Migration Inventory

### 19.1 Temporary V1 Expedients

These are explicitly marked as temporary in V1 and must be resolved in V2:

| Expedient | Where Marked | What It Means | V2 Resolution |
|-----------|-------------|---------------|---------------|
| Extension-local Architect model | §1.3 | Extension calls provider directly | Move behind `/api/orchestrate` |
| Extension-local interaction log | §1.3 | `architect_log.jsonl` metadata only | Replace with daemon-governed full trace |
| Hardcoded model lists | §7.2 | Anthropic/OpenAI models are static | Dynamic from `GET /api/orchestrate/capabilities` |
| Extension-managed API keys | §10 | `dreamgraph.architect.apiKey` in VS Code SecretStorage | Daemon-managed instance-scoped secrets |
| Extension-side constraint enforcement | §7.4, §7.7 | Extension runs ADR/UI pre-checks + constraint overlays before LLM call | Daemon enforces constraints during orchestrate |
| No conversation persistence | §13 | Chat history is in-memory only | `globalState` or daemon-side persistence |
| `GET /api/orchestrate/capabilities` returns `available: false` | §8.1 | Stub only | Returns full capabilities |
| Extension-side knowledge feedback | §8.2 | Pattern matching on unstructured Architect output | Daemon-side semantic extraction with structured signal blocks |

### 19.2 What Moves Daemon-Side

| Component | V1 Location | V2 Location | Migration Impact |
|-----------|-------------|-------------|-----------------|
| Architect model calls | Extension Layer 2 | Daemon `/api/orchestrate` | Extension removes provider adapter code, adds orchestrate client |
| Constraint enforcement (pre-check) | Extension Layer 2 → MCP calls | Daemon-internal during orchestrate | Extension still does client-side pre-check for UX (warnings before call), but daemon is authoritative |
| Reasoning basis assembly | Extension (from MCP call results) | Daemon (returned in `OrchestrateResponse`) | Extension reads from response instead of assembling |
| Model configuration | VS Code settings | Daemon env vars + dashboard | Extension reads available models from capabilities endpoint |
| Interaction audit log | Extension `architect_log.jsonl` | Daemon interaction log (instance-scoped) | Extension may keep local log as redundancy in localOverride mode |
| Token budget enforcement | Extension Layer 2 | Possibly shared (extension trims before send, daemon enforces `max_context_tokens`) | Budget logic must remain transport-agnostic |
| Knowledge signal extraction | Extension `feedback-handler.ts` (pattern matching) | Daemon post-processor (semantic extraction) | Extension still handles file-change monitoring; daemon handles Architect output analysis |
| Knowledge signal auto-confirm | Extension → MCP tool calls | Daemon writes directly before streaming response | Faster, more reliable; no extension round-trip for auto signals |
| User-confirm signal approval | Extension Knowledge Update panel → MCP tool calls | Extension panel → `POST /api/feedback/confirm` | New endpoint needed; same UX for the user |

### 19.3 API Compatibility Constraints

These must hold across the V1→V2 transition to avoid breaking the extension:

| Constraint | Why |
|-----------|-----|
| `POST /api/orchestrate` request shape must be backward-compatible | Extension sends the same request to V1 stub and V2 active endpoint |
| `GET /api/orchestrate/capabilities` must always respond (even if `available: false`) | Extension probes this on connect to decide local vs. daemon Architect |
| `OrchestrateResponse` must be a superset of V1 fields | Extension renders from this shape — removing fields breaks UI |
| SSE event types must be additive only | Extension ignores unknown event types, but must not lose known ones |
| `POST /api/graph-context` must remain available in V2 | Extension uses this for non-chat commands (explainFile, checkAdrCompliance) |
| `POST /api/validate` must remain available in V2 | Extension uses this for validateCurrentFile command |
| MCP tool surface must not break | Extension's Layer 3 wraps existing MCP tools — tool removal breaks commands |
| `EditorContextEnvelope` → `OrchestrateRequest.context` mapping must be documented | Extension must know which envelope fields the daemon uses vs. ignores |

### 19.4 Safe Deletions in V2

Code and configuration that can be removed when V2 is confirmed stable:

| Deletable | Condition |
|-----------|-----------|
| Extension provider adapters (Anthropic/OpenAI/Ollama HTTP clients) | Only if `localOverride` mode is also removed |
| `architect_log.jsonl` write logic | Only if daemon logging fully replaces it |
| Hardcoded model lists in `§7.2` | When capabilities endpoint provides dynamic lists |
| `dreamgraph.architect.provider` setting | When daemon owns config (keep if localOverride retained) |
| `dreamgraph.architect.model` setting | Same as above |
| `dreamgraph.architect.apiKey` secret storage | Same as above |
| `dreamgraph.architect.baseUrl` setting | Same as above |
| Extension-side reasoning basis assembly | When daemon returns it in `OrchestrateResponse.reasoning_basis` |
| System prompt builder (§7.5–7.9) | When daemon builds the prompt during orchestrate |

> **Deletion rule:** Do not delete anything until V2 daemon is deployed and confirmed stable for at least one release cycle. Keep localOverride mode available for at least V2.0 as a safety valve.

### 19.5 Migration Sequence

Recommended order for the V1→V2 transition:

```
1. Implement /api/orchestrate on daemon (active, not stub)
   └── Extension unchanged — still uses direct calls
               │
2. Flip capabilities to { available: true }
   └── Extension detects capability, offers opt-in
               │
3. Extension adds daemon-Architect path alongside local path
   └── Both paths active — user chooses via localOverride toggle
               │
4. Default switches from local to daemon
   └── localOverride defaults to false
               │
5. Stabilize for one release cycle
   └── Monitor logs, compare local vs. daemon quality
               │
6. Remove extension provider adapters (optional)
   └── localOverride becomes unsupported or deprecated
```

> **Key invariant:** At no point in this sequence does the extension break. Each step is independently deployable. The extension always has a working Architect path — either local or daemon.

---

*End of Part III — Migration Notes.*
