# TDD: DreamGraph VS Code Extension — The DreamGraph Agent

**Version:** 0.1.0 (Base Design)  
**Target Release:** DreamGraph v7.0.0  
**Date:** 2026-04-09  
**Author:** Mika Jussila, Siteledger Solutions Oy  
**Status:** Planned  
**Predecessor:** DreamGraph v6.2.0 "La Catedral" (57 MCP tools, 22 resources, web dashboard, instance architecture)

**Origin:** Every consumer agent so far — DevToys transcompiler, Copilot sessions, Claude sessions — reaches DreamGraph through the MCP layer. MCP is powerful for tool discovery, but generic MCP clients (Copilot, Cursor, Claude Desktop) have no awareness of DreamGraph's architectural rules. They can bypass ADR constraints, ignore UI consistency, violate the Three-Layer Model, and hallucinate knowledge that already exists in the graph. The extension closes this gap: **a DreamGraph-native client that mediates every interaction with the knowledge graph and the filesystem, ensuring architectural discipline from prompt to patch.**

---

## Executive Summary

DreamGraph today is a headless intelligence substrate. The `dg` CLI manages instances, the daemon exposes 57 MCP tools over stdio/HTTP, and the web dashboard provides observability. What is missing is a **first-party development interface** — one that understands DreamGraph's knowledge model, enforces its architectural rules, and makes the AI coding loop trustworthy.

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
| Agent may hallucinate APIs | Extension grounds responses against `api_surface.json` |
| No UI consistency checks before coding | Extension warns when changes would violate UI registry patterns |

### Deliverables Summary

| Category | Count | Details |
|----------|-------|---------|
| Extension commands | 12 | Connect, status, dashboard, explain, validate, ADR check, UI check, suggest, docs, context inspect, chat, settings |
| New daemon endpoints | 3 | `/api/context`, `/api/validate`, `/api/orchestrate` |
| New data stores | 0 | Uses existing DreamGraph data exclusively |
| New MCP tools | 0 | Extension consumes existing tools — does not add new ones in v1 |
| VS Code UI contributions | 4 | Status bar, sidebar view, chat panel (webview), output channel |

---

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
User prompt → Extension Context Engine → DreamGraph orchestration → Architect LLM → response
     ↑              ↓                          ↓                         ↓
  Editor state   Intent detection         Tool sequencing          Grounded output
     ↑              ↓                          ↓                         ↓
  File system    Mode selection            ADR/UI pre-check        Diff preview
```

The extension owns the orchestration. The LLM is downstream of context assembly and validation — not upstream.

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
│  │  Response Grounding · Confidence Scoring                      │  │
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

**v1 design:** The Architect model is configured exclusively in the extension settings. It does NOT affect the daemon's Dreamer/Normalizer configuration. The extension calls the Architect model directly (via provider API), not through DreamGraph's LLM pipeline.

**v2 consideration:** Add Architect as a third daemon-side model role, configurable via `DREAMGRAPH_LLM_ARCHITECT_*` and the dashboard `/config` page. Extension uses daemon's Architect config by default, with local override option.

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
  cognitiveState: string;      // "AWAKE" | "REM" | "NORMALIZING" | etc.
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
  | "current_feature"      // question spans a feature boundary
  | "workspace_local"      // question about project structure
  | "ask_dreamgraph"       // question requires graph knowledge
  | "manual";              // user explicitly chose context
```

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
        ├── current_feature ──► { feature metadata, related files, workflows, ADRs }
        │
        ├── workspace_local ──► { file tree, system overview, data model summary }
        │
        ├── ask_dreamgraph ──► { graph query results, tensions, dream insights }
        │
        └── manual ──► { user-pinned files + selected context }
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
[2026-04-09T14:22:01Z] Token budget: 4,200 / 8,000
```

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
7. Show result in output panel or chat panel

**Why this is DreamGraph-native:** The explanation is grounded in the knowledge graph, not just the file content. A generic LLM would explain syntax. This explains *purpose within the system*.

#### 5.2.2 `dreamgraph.explainSelection`

**Purpose:** Explain selected code in system context.

**Flow:** Same as `explainFile` but scoped to selection. Uses `selection_only` intent mode. If the selection contains a function/class name, also queries `query_api_surface` for its signature context.

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

#### 5.2.4 `dreamgraph.checkUiIntegrity`

**Purpose:** Check if the current file's UI code matches registered patterns.

**Flow:**
1. Read active file
2. Query `query_ui_elements` for elements declared in or related to this file
3. Compare code against registered element patterns, properties, and platform declarations
4. Report mismatches: unknown components, missing required properties, platform inconsistencies

#### 5.2.5 `dreamgraph.validateCurrentFile`

**Purpose:** Validate the current file against the operational knowledge graph.

**Flow:**
1. Read active file
2. Call `validate_code_against_graph(file_path=<active_file>)` (when operational layer is available)
3. Check API surface for method calls that don't exist
4. Check imports against known module structure
5. Show violations in problems panel

**Depends on:** TDD_OPERATIONAL_KNOWLEDGE implementation (api_surface.json, validate_code_against_graph tool).

#### 5.2.6 `dreamgraph.suggestNextAction`

**Purpose:** Based on current context, suggest what to work on next.

**Flow:**
1. Build context envelope with changed files, active file
2. Call `suggest_next_action(completed_action=<last_change_description>)`
3. Show ordered suggestion list with rationale
4. Each suggestion is actionable: click to open the relevant file, run the relevant command, or view the relevant documentation

#### 5.2.7 `dreamgraph.openRelatedDocs`

**Purpose:** Open DreamGraph documentation relevant to the current context.

**Flow:**
1. Identify features/workflows related to active file (via index)
2. Open dashboard `/docs` page filtered to relevant entries
3. Alternatively: inline webview showing graph documentation

#### 5.2.8 `dreamgraph.impactAnalysis`

**Purpose:** "What changes if this file changes?"

**Flow:**
1. Read active file path
2. Query `index.json` for all entities referencing this file
3. Query `dream_graph.json` for edges involving those entities
4. Query `ui_registry.json` for UI elements in this file
5. Build dependency tree using graph edges
6. Show impact summary: affected features, workflows, UI elements, downstream files

#### 5.2.9 `dreamgraph.inspectContext`

**Purpose:** Show the current context envelope in the output panel for debugging/transparency.

**Flow:** Build the full `EditorContextEnvelope`, format as readable text, show in output channel.

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
│   └── Last cycle: 2h ago
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

### 6.2 Refresh Strategy

| Section | Refresh Trigger |
|---------|----------------|
| Instance | On connection state change |
| Cognitive State | On health check poll (every 10s) |
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

### 7.2 Chat Message Structure

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

    /** Proposed changes (if any) */
    proposedChanges: {
      path: string;
      description: string;
      patch: Patch[];
    }[];
  };
}
```

### 7.3 Chat Flow

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
  Pre-Check: Query ADRs, UI registry, API surface
        │
        ├── Violations found ──► Show warnings BEFORE LLM call
        │                         ("⚠ ADR-008 constrains layout changes in this area")
        │
        ▼
  Assemble Architect LLM prompt:
    - System prompt with DreamGraph awareness rules
    - Context envelope (graph knowledge + editor state)
    - Pre-check results
    - User message
        │
        ▼
  Stream response to chat panel
        │
        ├── Text chunks ──► Render progressively
        ├── File references ──► Render as clickable links
        ├── Code blocks ──► Render with "Apply" / "Preview Diff" buttons
        └── Tool trace ──► Render in collapsible "DreamGraph Activity" section
```

### 7.4 System Prompt Template

The Architect LLM receives a system prompt that grounds it in DreamGraph:

```
You are the DreamGraph Architect — an AI assistant deeply integrated with the
DreamGraph knowledge system for the project "{project_name}".

You have access to the following verified knowledge:
{graph_context_summary}

Architectural decisions that constrain your recommendations:
{applicable_adrs}

UI consistency patterns in effect:
{ui_patterns}

Active tensions (unresolved architectural concerns):
{active_tensions}

Rules:
1. NEVER recommend code that violates an accepted ADR.
2. NEVER recommend UI patterns inconsistent with the UI registry.
3. ALWAYS cite specific features, workflows, or ADRs when making claims about the system.
4. If you are uncertain about system structure, say so — do not hallucinate.
5. When proposing code changes, include enough context for diff preview.
6. Prefer explaining in terms of the knowledge graph (features, workflows, entities)
   rather than just files and line numbers.

Current context:
- File: {active_file}
- Intent: {intent_mode}
- Cognitive state: {cognitive_state}
```

---

## 8. Daemon-Side Extensions

### 8.1 New REST Endpoints

The extension benefits from three new REST endpoints on the daemon (not MCP tools — these are extension-specific HTTP routes):

#### `POST /api/context`

**Purpose:** Given a file path, return relevant graph context (features, workflows, ADRs, UI elements, API surface) in one call.

**Why:** Avoids N+1 MCP tool calls from the extension. One HTTP request returns everything the extension needs for context assembly.

```typescript
// Request
interface ContextRequest {
  file_path: string;           // relative to project root
  include_adrs?: boolean;      // default: true
  include_ui?: boolean;        // default: true
  include_api_surface?: boolean; // default: true
  include_tensions?: boolean;  // default: true
}

// Response
interface ContextResponse {
  ok: boolean;
  file_path: string;
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
│   │   └── health-monitor.ts       # Polling health checks (§2.4)
│   │
│   ├── context/                    # Layer 2: Context Orchestration
│   │   ├── envelope.ts             # EditorContextEnvelope builder
│   │   ├── intent-detector.ts      # Heuristic intent classification
│   │   ├── graph-context.ts        # DreamGraph knowledge fetching
│   │   ├── pre-checker.ts          # ADR/UI/API pre-validation
│   │   └── assembler.ts            # Final context assembly for LLM
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
│   │   ├── prompt-builder.ts       # System prompt + context formatting
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
    "enum": ["auto", "selection_only", "active_file", "current_feature", "workspace_local", "ask_dreamgraph"],
    "default": "auto",
    "description": "Default context mode. 'auto' uses intent detection."
  },
  "dreamgraph.architect.provider": {
    "type": "string",
    "enum": ["openai", "anthropic", "ollama"],
    "description": "LLM provider for the Architect model."
  },
  "dreamgraph.architect.model": {
    "type": "string",
    "description": "Model name for the Architect (e.g., 'claude-sonnet-4-20250514', 'gpt-4.1', 'qwen3:32b')."
  },
  "dreamgraph.architect.apiKey": {
    "type": "string",
    "description": "API key for the Architect model provider. Stored in VS Code secrets, not settings."
  },
  "dreamgraph.architect.baseUrl": {
    "type": "string",
    "description": "Base URL override for the Architect model provider (e.g., Ollama endpoint)."
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
  }
}
```

---

## 11. Milestone Plan

### Milestone 1: Connect and Observe (Week 1)

**Goal:** Extension can discover, connect to, and monitor a DreamGraph instance.

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

**Daemon-side:** Implement `GET /api/instance` endpoint.

### Milestone 2: Context Capture (Week 2)

**Goal:** Extension can build rich context envelopes from editor state + DreamGraph knowledge.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| File reader | Active file, selection, visible files, changed files | Reads all editor state accurately |
| Context envelope builder | `EditorContextEnvelope` construction | Produces complete envelopes |
| Intent detector | Heuristic intent classification | Correctly classifies 5 intent modes |
| Graph context fetcher | MCP tool calls for features, ADRs, UI, API surface | Populates `graphContext` section |
| Context inspector | `dreamgraph.inspectContext` command + output channel | Shows readable envelope in output |
| MCP client | Persistent MCP session over Streamable HTTP | Can call tools and read resources |

**Daemon-side:** Implement `POST /api/context` endpoint.

### Milestone 3: Safe File Operations (Week 3)

**Goal:** Extension can open, navigate to, and apply changes with diff preview.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| File opener | Open file at line/column from DreamGraph references | Navigates to exact location |
| Scope guard | Project root enforcement on all file operations | Rejects out-of-scope paths |
| Diff preview | Show proposed changes in VS Code diff editor | User sees before/after |
| Selection replace | Replace selection with preview | Preview → accept flow works |
| Patch apply | Apply multi-range patches with preview | Preview → accept flow works |
| File create | Create new file with preview | Shows content in untitled editor |

### Milestone 4: DreamGraph-Native Commands (Week 3–4)

**Goal:** First commands that use DreamGraph knowledge to provide value beyond generic AI.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| Explain File | `dreamgraph.explainFile` | Explains file in system context using graph knowledge |
| Explain Selection | `dreamgraph.explainSelection` | Explains selected code with graph context |
| Validate File | `dreamgraph.validateCurrentFile` | Reports violations against API surface + graph |
| ADR Check | `dreamgraph.checkAdrCompliance` | Identifies ADR violations in current file |
| UI Check | `dreamgraph.checkUiIntegrity` | Identifies UI registry inconsistencies |
| Suggest Next | `dreamgraph.suggestNextAction` | Workflow-aware next-step suggestion |
| Impact Analysis | `dreamgraph.impactAnalysis` | Shows what's affected by current file changes |
| Related Docs | `dreamgraph.openRelatedDocs` | Opens graph docs for current context |

**Daemon-side:** Implement `POST /api/validate` endpoint.

### Milestone 5: Sidebar View (Week 4)

**Goal:** Persistent sidebar with instance state, cognitive overview, and quick actions.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| Tree view provider | Sidebar registration + tree structure (§6) | Shows correct instance/state/context |
| Instance section | UUID, name, mode, status, port | Accurate, updates on connection change |
| Cognitive section | State, cycles, tensions, last cycle | Updates on health poll |
| Context section | Current file, intent, features, ADRs | Updates on active editor change |
| Quick actions | Clickable tree items → run commands | All commands accessible from sidebar |
| Recent insights | Latest dream cycles, tensions, validations | Updates on health poll |

### Milestone 6: Chat Panel (Week 5+)

**Goal:** Conversational interface into DreamGraph.

| Deliverable | Description | Acceptance Criteria |
|-------------|-------------|---------------------|
| Chat webview | HTML/CSS/JS chat panel (§7) | Renders messages, code blocks, tool traces |
| Architect LLM | Model integration with provider adapters | Calls configured model with streaming |
| System prompt builder | Context-aware prompt construction (§7.4) | Includes graph knowledge + ADRs + tensions |
| Tool trace display | Collapsible section showing which tools were called | Visible on every response |
| Warning display | Pre-check warnings before LLM call | ADR/UI violations shown as banners |
| File reference links | Clickable file:line references in chat | Navigate to file on click |
| Apply patch buttons | "Preview Diff" / "Apply" on code blocks | Uses diff preview flow (§4.3) |
| Context mode selector | UI to override intent detection | User can force context mode |

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

### 12.2 What the Extension Never Does

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

The extension is a **consumer**, not a participant, in the Three-Layer Model:

| Layer | Extension Access |
|-------|-----------------|
| Cognitive | **Read only** — cognitive state, dream history, tensions (via resources) |
| Operational | **Read only** — API surface, validation results (via tools) |
| Fact | **Read only** — features, workflows, data model, ADRs, UI registry (via resources/tools) |
| Files | **Read + write** — but only through editor APIs with diff preview |

The extension never writes to any DreamGraph data store. All data mutations flow through daemon tools, which enforce their own protection rules.

### 14.4 Dependency on TDD_OPERATIONAL_KNOWLEDGE

Several extension commands depend on the Operational Knowledge Layer (TDD v0.4.0):

| Command | Dependency | Graceful Degradation |
|---------|------------|---------------------|
| `validateCurrentFile` | `validate_code_against_graph` tool + `api_surface.json` | Reports "No API surface available — run extract_api_surface first" |
| `explainFile` / `explainSelection` | `query_api_surface` for symbol context | Omits API surface from context, still works with feature/workflow knowledge |
| `checkAdrCompliance` | None (uses existing ADR tools) | Fully functional without operational layer |
| `checkUiIntegrity` | None (uses existing UI registry) | Fully functional without operational layer |
| `impactAnalysis` | Better with `api_surface.json` call graph data | Falls back to index-based dependency tree only |

The extension is **usable without the operational layer** — it just provides richer context when operational data is available.

---

## 15. Open Questions

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Should the extension live in the `dreamgraph` monorepo or a separate repo? | Same repo (`packages/vscode`), separate repo (`dreamgraph-vscode`) | **Separate repo** — different release cadence, different CI, different marketplace publishing |
| 2 | Should the Architect model be configurable per-workspace or globally? | Per-workspace, global, or both with workspace override | **Both** — global default with workspace override, same pattern as other VS Code settings |
| 3 | Should chat history persist across sessions? | In-memory only (v1), file-based, VS Code globalState | **In-memory only for v1** — add `globalState` persistence in v2 |
| 4 | Should the extension support stdio transport? | HTTP only, stdio, or both | **HTTP only in v1** — stdio requires spawning the daemon as a child process, adds complexity. The daemon must be started separately. |
| 5 | Should the extension auto-start the daemon? | Never, ask first, configurable | **Configurable with default=off** — `dreamgraph.autoStartDaemon` setting, off by default, notifies user when daemon is not running |
| 6 | Should the `POST /api/context` and `/api/validate` endpoints be MCP tools instead? | HTTP REST, MCP tools, or both | **HTTP REST** — these are extension-specific optimized endpoints, not general-purpose MCP capabilities. Other MCP clients don't need batch context assembly. |
| 7 | Should the extension embed `@modelcontextprotocol/sdk` client-side? | Embed SDK, raw HTTP, or use VS Code MCP extensions | **Embed SDK** — `@modelcontextprotocol/sdk` has a `Client` class for Streamable HTTP. Keeps the extension self-contained. |

---

## 16. Success Criteria

### 16.1 Milestone 1–2 (Foundation)

- [ ] Extension activates in <500ms
- [ ] Instance auto-resolved from workspace root in >90% of cases
- [ ] Health check detects disconnect within 15 seconds
- [ ] Context envelope accurately reflects editor state
- [ ] Intent detection matches expected mode in >80% of test cases

### 16.2 Milestone 3–4 (Core Value)

- [ ] Every file write shows diff preview before application
- [ ] Scope guard prevents all out-of-project file access
- [ ] `explainFile` references specific features and ADRs (not just syntax)
- [ ] `checkAdrCompliance` catches known ADR violations in test files
- [ ] `suggestNextAction` returns workflow-grounded suggestions

### 16.3 Milestone 5–6 (Full Experience)

- [ ] Sidebar updates within 2 seconds of editor change
- [ ] Chat responses show tool trace for every answer
- [ ] Chat pre-check warnings appear before LLM call completes
- [ ] Code blocks in chat have working "Preview Diff" buttons
- [ ] Users prefer extension-mediated interaction over raw Copilot for DreamGraph tasks

### 16.4 The Ultimate Test

> An agent using the extension should **never** violate an ADR, produce code inconsistent with the UI registry, or hallucinate an API that doesn't exist in the knowledge graph — because the extension prevents it before the LLM even generates a response.

---

## Appendix A: Command Palette Reference

| Command | ID | Keybinding (suggested) | When |
|---------|----|----------------------|------|
| Connect Instance | `dreamgraph.connect` | — | Always |
| Reconnect | `dreamgraph.reconnect` | — | Always |
| Switch Instance | `dreamgraph.switchInstance` | — | Always |
| Show Status | `dreamgraph.showStatus` | — | Always |
| Open Dashboard | `dreamgraph.openDashboard` | `Ctrl+Shift+D G` | Connected |
| Explain Current File | `dreamgraph.explainFile` | `Ctrl+Shift+D E` | Connected + file open |
| Explain Selection | `dreamgraph.explainSelection` | `Ctrl+Shift+D S` | Connected + selection active |
| Check ADR Compliance | `dreamgraph.checkAdrCompliance` | `Ctrl+Shift+D A` | Connected + file open |
| Check UI Integrity | `dreamgraph.checkUiIntegrity` | `Ctrl+Shift+D U` | Connected + file open |
| Validate Current File | `dreamgraph.validateCurrentFile` | `Ctrl+Shift+D V` | Connected + file open |
| Suggest Next Action | `dreamgraph.suggestNextAction` | `Ctrl+Shift+D N` | Connected |
| Impact Analysis | `dreamgraph.impactAnalysis` | `Ctrl+Shift+D I` | Connected + file open |
| Open Related Docs | `dreamgraph.openRelatedDocs` | `Ctrl+Shift+D D` | Connected + file open |
| Inspect Context | `dreamgraph.inspectContext` | `Ctrl+Shift+D C` | Connected |
| Open Chat | `dreamgraph.openChat` | `Ctrl+Shift+D Space` | Connected |

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
