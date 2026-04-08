# TDD: Operational Knowledge Layer

**Version:** 0.4.0 (Architecture-Validated — Contradiction-Free)
**Target Release:** DreamGraph v6.2.0
**Date:** 2026-04-08
**Origin:** Two independent Claude agents used DreamGraph as MCP server for a large-scale DevToys transcompilation (C#/Blazor → Python/Qt). Both agents independently identified the same core gap: **DreamGraph knows _what exists_ and _how things relate_, but not _what things can do_ at the method-signature level.** A third review pass contributed implementation-ready schema refinements. A fourth pass (v0.4.0) pressure-tested every addition against the real codebase, resolved three architectural contradictions, and introduced the Operational Overlay as a named layer.

---

## Executive Summary

DreamGraph excels at structural inventory and relational reasoning. Both consumer agents confirm: `system://features`, `query_ui_elements`, `cognitive_status`, and URI-based resources are excellent. The single-query inventory pattern (65 UI elements in one call, full feature catalog in one resource read) is exactly how AI agents want to consume knowledge.

The gap is **operational resolution** — the code surface as-implemented. Every runtime error in the DevToys port originated in the space between "the graph says this component exists" and "the code doesn't expose the method I assumed it had."

This TDD proposes **6 new tools**, **2 new resources**, **2 new data stores**, and **3 extensions** to existing features. Prioritized by triple-agent consensus, validated against the actual DreamGraph v6.0.0 codebase. All schemas in this document are implementation-ready with structured output contracts.

---

## Architectural Foundation: The Three-Layer Model

DreamGraph v6.2.0 has three explicitly named layers. Every data store, tool, and resource belongs to exactly one.

| Layer | Role | Data files | Mutation rules | Tools prefix |
|-------|------|------------|----------------|--------------|
| **Cognitive** | Abstract relationships between named entities. Dream edges, tensions, validated promotions. | `dream_graph.json`, `candidate_edges.json`, `validated_edges.json`, `tension_log.json`, `dream_history.json`, `meta_log.json` | Only the dream/normalize/tension pipeline writes. Never stores source code or signatures. | `dream_cycle`, `normalize_dreams`, `query_dreams`, `cognitive_status` |
| **Operational** | Code surface as-implemented. API signatures, validation results, reusable patterns. Structured data extracted from source by deterministic tools — never by the dreamer. | `api_surface.json`, `implementation_patterns.json` | Only extraction tools and manual enrichment write. Cognitive layer may **read** for grounding but never **write**. | `extract_api_surface`, `query_api_surface`, `validate_code_against_graph`, `get_implementation_pattern` |
| **Fact** | Named entities, workflows, data models, UI registry, system overview. The seed graph. | `features.json`, `workflows.json`, `data_model.json`, `ui_registry.json`, `system_overview.json`, `index.json`, `capabilities.json`, `adr_log.json` | `init_graph`, `scan_project`, `enrich_seed_data`, UI registry tools. Cognitive layer never writes. | `query_resource`, `query_ui_elements`, `search_data_model`, `suggest_next_action` |

**Interface layer** (MCP tools and resources) spans all three — it is the capability surface, not a data layer.

### Why This Matters

The v0.3.0 TDD proposed that the dreamer could detect and propose implementation patterns. The architectural evaluation identified this as a **cognitive layer writing operational data** — a boundary violation. The three-layer model makes the rule explicit:

> **Invariant: Data flows upward for reads, never downward for writes.**
>
> - The cognitive layer may **read** operational data (API surface for grounding) and fact data (features/workflows for dream context).
> - The cognitive layer **never writes** to operational or fact stores.
> - The operational layer may **read** fact data (workflows for `suggest_next_action`).
> - The operational layer **never writes** to fact or cognitive stores.

This preserves DreamGraph's core property: the abstract knowledge graph is never contaminated by implementation details, and implementation details are never hallucinated by the dreamer.

### Resource URI Conventions

Resources follow the layer model:

| URI prefix | Layer | Semantics |
|------------|-------|-----------|
| `system://` | Fact | Named entities and seed graph data |
| `dream://` | Cognitive | Dream state, edges, tensions, history |
| `ops://` | Operational | API surface, validation, patterns, drift |

The new `ops://` prefix distinguishes operational data from cognitive data. Previous drafts incorrectly placed operational resources under `dream://`.

---

## Triple Agent Feedback Synthesis

### What Both Agents Agree On (Strongest Signal)

| Finding | Agent A (session partner) | Agent B (converter) | Confidence |
|---------|------------------------|---------------------|------------|
| API surface is the #1 gap | "The single feature that would change my workflow the most" | "Closing that gap at the method-signature level would be the single highest-impact improvement" | **CONFIRMED** |
| Code validation against graph | "I can't validate my own output against the knowledge graph" | "`validate_code_against_graph` would have caught all three errors in one pass" | **CONFIRMED** |
| Pattern-based scaffolding | "Pattern replication is my most common coding activity" | "`get_implementation_pattern` — real code that compiles, not pseudocode" | **CONFIRMED** |
| Single-query inventory works | "I can orient myself in a codebase in one call" | "I could load the entire UI vocabulary into context once" | **CONFIRMED** |

### Refinement Evolution (v0.1 → v0.2 → v0.3 → v0.4)

| Finding | TDD v0.1 | Agent B | Agent C | v0.4 Validation |
|---------|----------|---------|---------|-----------------|
| API query should be symbol-generic | `system://api-surface` (full dump) | `query_api_surface(class_name)` | `symbol_name` + `symbol_kind` | ✅ Fits as operational tool |
| Validation as on-demand tool | Nightmare strategy (periodic) | `validate_code_against_graph(file_path)` | Granular `check_*` + `kind` enum | ✅ Fits; `dream://api-violations` **dropped** (see §Resolved Contradictions) |
| Patterns as named recipes | Parametric generator | Named lookup | Provenance + confidence | ✅ Fits; dream-extraction **removed** (see §Resolved Contradictions) |
| API drift detection | Not covered | `dream://api-drift` | Confidence scoring | ✅ Fits; **moved to `ops://api-drift`**, tension via grounding pipeline |
| Response scoping | Not covered | `context="python-port"` | `platform` + `detail_level` | ✅ Trivial param extensions |
| Next-action suggestion | Not covered | `suggest_next_action` | `max_steps` + structured context | ✅ Fits; uses existing workflows.json |
| Incremental extraction | Not covered | Not covered | `incremental: true` default | ✅ Fits; aligns with mtime-aware cache |
| Provenance tracking | Not covered | Not covered | `Provenance` interface | ✅ Fits; `dream_proposed` kind **restricted to DreamEdge only** |

### Feedback Assessment

| # | Feedback | Source | Verdict | Rationale |
|---|----------|--------|---------|-----------|
| 1 | `query_api_surface(symbol_name)` | All | **BUILD THIS — CRITICAL** | All agents' #1 request. Symbol-generic query covers classes, functions, modules. |
| 2 | `extract_api_surface(path)` | All | **BUILD THIS — CRITICAL** | Feeds #1. Incremental extraction avoids rescanning unchanged files. |
| 3 | `validate_code_against_graph(file_path)` | Agent B, confirmed by all | **BUILD THIS — HIGH** | On-demand self-check with machine-friendly violation `kind` values. |
| 4 | `get_implementation_pattern(pattern_name)` | Agent B, refined by C | **BUILD THIS — HIGH** | Named pattern lookup with provenance + confidence tracking. Population via extraction + manual only. |
| 5 | `suggest_next_action(completed_action)` | Agent B, refined by C | **BUILD THIS — MEDIUM** | Workflow-aware next-step with `max_steps` constraint. |
| 6 | `ops://api-drift` | Agent B | **BUILD THIS — MEDIUM** | Graph-vs-code divergence detection. Feeds dream cycle grounding. |
| 7 | Response scoping (`platform`/`detail_level`) | Agent B + C | **EXTEND EXISTING** | Add `platform` + `detail_level` filters across all query tools. |
| 8 | Port coverage tracking | Agent A | **ALREADY EXISTS** | UI registry `missing_platform` + `generate_ui_migration_plan`. |
| 9 | Presenter-to-component mapping | Agent A | **ALREADY EXISTS** | UI registry `platforms` field. Needs population. |
| 10 | Workflow templates | All | **ALREADY EXISTS** | `system://workflows`. Just add project-specific workflows. |
| 11 | `compare_api_surfaces` (cross-language diff) | Agent A | **PHASE 2** | Depends on #2. Trivial once both projects have `api_surface.json`. |
| 12 | Full AST / LSP integration | Agent A | **OUT OF SCOPE** | Language server territory. Future `lsp_senses.ts` in v7+. |
| 13 | Provenance tracking on all artifacts | Agent C | **CROSS-CUTTING** | Extracted vs. inferred. Trust degrades with distance from source. |
| 14 | Confidence on inferred artifacts only | Agent C | **CROSS-CUTTING** | Fits DreamGraph's philosophy. Not on raw extraction (that's stale-or-not). |

---

## Resolved Contradictions

Three design decisions in v0.3.0 violated DreamGraph's architectural invariants. All resolved in v0.4.0.

### Contradiction 1: `dream://api-violations` mixed operational output with cognitive resources

**v0.3.0 proposed:** A `dream://api-violations` resource showing latest validation results.

**Problem:** `dream://` resources are cognitive outputs — graph state, edges, tensions, history. Validation violations are operational tool output (line numbers, method names, suggestions). Mixing them under the same URI prefix blurs the layer boundary.

**Resolution:** **Dropped entirely.** The `validate_code_against_graph` tool returns violations directly in its response. A persisted resource adds no value — violations are ephemeral (stale the moment the file is edited) and no cognitive consumer needs them. If persistence is ever needed, it would be `ops://api-violations` with a `validation_results.json` data store.

### Contradiction 2: Dream-extracted implementation patterns violated the cognitive/operational boundary

**v0.3.0 proposed:** The dreamer could "detect repeated structural patterns across files" and propose `ImplementationPattern` entries via `code_insight` tensions.

**Problem:** The dreamer produces `DreamEdge` entries (relationship hypotheses between named entities) and `DreamNode` entries (entity hypotheses). It builds a `FactSnapshot` from `features.json`, `workflows.json`, `data_model.json` — it does NOT analyze source code structure. An `ImplementationPattern` is a code template with placeholders — neither a relationship nor an entity. Producing one would require the cognitive layer to:
1. Read and compare source file structures (violates "no source code in cognitive model")
2. Output a non-edge/non-node artifact type (violates the dream pipeline's type contract)
3. Write to `implementation_patterns.json` (violates "cognitive layer never writes to operational stores")

**Resolution:** Patterns are populated **exclusively** through:
1. **Manual enrichment** — developer or agent adds patterns via `enrich-graph.mjs`-style scripts
2. **Extraction-time inference** — `extract_api_surface` with `include_patterns=true` groups structurally similar files during the extraction pass (deterministic, operational-layer logic)

The `Provenance.kind` enum drops `"dream_proposed"` for patterns. It remains valid for `DreamEdge` artifacts (which already track their strategy origin). The promotion gate integration for patterns is removed — unnecessary without dream origin.

### Contradiction 3: `dream://api-drift` resource implied side effects on read

**v0.3.0 proposed:** "Large drift creates a `code_insight` tension" when the drift resource is read.

**Problem:** Every `dream://` and `system://` resource in DreamGraph is a pure read. Creating tensions during a resource read would break this convention and introduce unpredictable side effects.

**Resolution:** Drift feeds into the cognitive pipeline through the **existing grounding mechanism**, not through resource side effects:
1. `ops://api-drift` is a **pure read** — compares file mtimes against extraction timestamps, returns stale files
2. During dream cycles, `groundEntities()` checks `api_surface.json` freshness as part of evidence gathering. Stale surface data reduces grounding confidence for affected entities.
3. The dreamer naturally produces weaker edges for poorly-grounded entities → normalizer rejects them → rejection pipeline creates tensions via the existing mechanism.
4. No new tension creation path needed. The existing pipeline handles it.

The resource is renamed from `dream://api-drift` to **`ops://api-drift`** — it's operational data (file timestamps vs. extraction timestamps), not cognitive state.

---

## Tier 1: Build This — Critical Priority

### 1A. API Surface Extraction & Query

**Priority:** CRITICAL (both agents' #1)
**Effort:** Medium
**Layer:** Operational
**Delivers:** 2 new tools + 1 new resource + 1 new data store

#### The Problem

Agent A: "When I need to call `engine.recordTension()`, I need its exact parameter signature. That means reading the file, finding the function, reading the params. Every time."

Agent B: "I got the conceptual data contract ('inputs: orientation, children'). What I needed was the programmatic surface: `UIStack.vertical() → UIStack`, `UIStack.with_children(*UIElement) → UIStack`."

Both agents independently hit the identical gap: the knowledge graph describes *capabilities* but not *interfaces*. For coding agents, the interface IS the capability.

#### Design

**Tool 1: `extract_api_surface`** — Grounding/population tool (not for frequent agent polling)

```typescript
{
  name: "extract_api_surface",
  description: "Extract programmatic API surface from source files and store it as operational knowledge. Use when onboarding a repo, after major code changes, or before validation if no API surface exists yet.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File or directory path relative to repo root."
      },
      language: {
        type: "string",
        enum: ["auto", "python", "typescript", "javascript", "csharp"],
        default: "auto",
        description: "Language to extract. Auto-detect from file extension."
      },
      scope: {
        type: "string",
        enum: ["public", "all"],
        default: "public",
        description: "Whether to extract only public APIs or all detectable members."
      },
      incremental: {
        type: "boolean",
        default: true,
        description: "Only re-extract changed files when possible (compares file mtime against last extraction). Set false to force full rescan."
      },
      include_patterns: {
        type: "boolean",
        default: false,
        description: "Whether to also infer candidate implementation patterns from extracted files. See §Pattern Inference Rules for what qualifies."
      },
      platform: {
        type: "string",
        description: "Optional platform tag (e.g., 'python-port', 'web', 'desktop', 'mobile'). Tags all extracted symbols for platform-filtered queries."
      }
    },
    required: ["path"]
  }
}
```

**Expected output:**

```json
{
  "ok": true,
  "repo_root": "/repo",
  "path_scanned": "src/ui",
  "files_scanned": 42,
  "files_updated": 9,
  "files_skipped_incremental": 33,
  "classes_found": 28,
  "functions_found": 54,
  "properties_found": 31,
  "patterns_inferred": 0,
  "warnings": [
    "Skipped 2 files with unsupported multiline signatures."
  ],
  "surface_version": "2026-04-08T12:34:56Z"
}
```

**Design rationale:** `incremental` defaults to `true` because agents should never rescan 500 files for 3 changes. `include_patterns` defaults to `false` because pattern inference is heavier and only useful during initial onboarding or periodic enrichment. `platform` enables multi-project repos (C# source + Python port in the same tree) to coexist in one surface.

**Tool 2: `query_api_surface`** — Targeted symbol query (highest-value operational tool)

```typescript
{
  name: "query_api_surface",
  description: "Return the exact callable/programmatic surface for a class, function, or module. Use before writing code that calls methods or accesses properties.",
  inputSchema: {
    type: "object",
    properties: {
      symbol_name: {
        type: "string",
        description: "Class, function, or module symbol to look up (e.g., 'UIStack', 'CognitiveEngine', 'ui.layouts')."
      },
      symbol_kind: {
        type: "string",
        enum: ["auto", "class", "function", "module"],
        default: "auto",
        description: "Optional symbol type hint. Auto-detect when omitted."
      },
      member_name: {
        type: "string",
        description: "Optional: filter to one specific method or property."
      },
      include_inherited: {
        type: "boolean",
        default: true,
        description: "Include inherited members when querying classes. Inherited members include a 'defined_in' field showing their origin class."
      },
      detail_level: {
        type: "string",
        enum: ["summary", "full", "signatures_only"],
        default: "full",
        description: "summary: name + purpose. signatures_only: method names, params, return types. full: everything including decorators, line numbers, visibility."
      },
      platform: {
        type: "string",
        description: "Optional platform filter (e.g., 'python-port', 'web')."
      },
      language: {
        type: "string",
        enum: ["any", "python", "typescript", "javascript", "csharp"],
        default: "any",
        description: "Optional language filter for multi-language repos."
      }
    },
    required: ["symbol_name"]
  }
}
```

**Expected output:**

```json
{
  "ok": true,
  "symbol_name": "UIStack",
  "symbol_kind": "class",
  "language": "python",
  "file_path": "src/ui/layouts.py",
  "line_number": 120,
  "bases": ["UIElement"],
  "methods": [
    {
      "name": "horizontal",
      "parameters": [],
      "return_type": "UIStack",
      "is_static": true,
      "is_async": false,
      "visibility": "public",
      "defined_in": "UIStack"
    },
    {
      "name": "with_children",
      "parameters": [
        { "name": "children", "type": "UIElement[]" }
      ],
      "return_type": "UIStack",
      "is_static": false,
      "is_async": false,
      "visibility": "public",
      "defined_in": "UIElement"
    }
  ],
  "properties": [
    {
      "name": "spacing",
      "type": "int",
      "readonly": false,
      "defined_in": "UIStack"
    }
  ]
}
```

**Key design decisions:**
- `symbol_name` instead of `class_name` — covers functions and modules without needing a separate tool. One query surface for all symbol types.
- `member_name` instead of `method_name` — covers properties too.
- `defined_in` on inherited members — critical for understanding *where* a method lives. When `UIStack.with_children()` is inherited from `UIElement`, the agent needs to know that so it can read the actual source or understand override semantics.
- `detail_level` gives agents token-budget control. `signatures_only` is the 80% case when coding.
- Unresolvable bases (external libraries not in the surface) show the base class name but no inherited methods — the tool never fabricates signatures.

**Resource: `ops://api-surface`** — Full cached surface for dream cycle grounding and bulk analysis.

#### Data Store: `api_surface.json`

```typescript
interface ApiSurface {
  extracted_at: string;           // ISO timestamp of last extraction
  repo_root: string;              // which repo this covers
  modules: ApiModule[];
}

interface ApiModule {
  file_path: string;              // relative path from repo root
  module_name?: string;           // dotted module name (e.g., "ui.layouts") — more useful than file path for imports
  language: string;               // detected language
  platform?: string;              // tagged platform (if extracted with platform param)
  classes: ApiClass[];
  functions: ApiFreeFunction[];   // module-level functions
  provenance: Provenance;         // how this module was extracted
}

interface ApiClass {
  name: string;
  bases: string[];                // parent classes / interfaces
  methods: ApiMethod[];
  properties: ApiProperty[];
  decorators: string[];           // @property, @staticmethod, etc.
  file_path: string;              // redundant for fast lookup
  line_number: number;
}

interface ApiMethod {
  name: string;
  parameters: ApiParam[];         // structured params
  return_type?: string;
  signature_text?: string;        // human-readable one-liner (e.g., "horizontal() → UIStack")
  is_static: boolean;
  is_async: boolean;
  visibility: "public" | "protected" | "private";
  line_number: number;
  decorators: string[];
}

interface ApiParam {
  name: string;
  type?: string;                  // if extractable
  default_value?: string;         // if has default
}

interface ApiProperty {
  name: string;
  type?: string;
  is_readonly: boolean;           // @property without setter
  line_number: number;
}

interface ApiFreeFunction {
  name: string;
  parameters: ApiParam[];
  return_type?: string;
  signature_text?: string;        // human-readable one-liner
  is_async: boolean;
  is_exported: boolean;           // export keyword (TS) or __all__ (Python)
  line_number: number;
}
```

**Schema additions vs. v0.2:**
- `module_name` — dotted import path is what agents actually type (`from ui.layouts import UIStack`). More useful than bare file path.
- `signature_text` — optional human-readable one-liner per method/function. Compact enough for LLM context windows when `detail_level=signatures_only`.
- `platform` on ApiModule — enables multi-platform repos to coexist in one surface file.
- `provenance` on ApiModule — tracks extraction source and timestamp per file (see §Cross-Cutting Concerns).

#### Extraction Strategy

Language-aware regex patterns — same sophistication as `adversarial.ts` security scanning:

```typescript
// Python
const PYTHON_CLASS = /^class\s+(\w+)(?:\((.*?)\))?:\s*$/gm;
const PYTHON_METHOD = /^(\s+)(?:async\s+)?def\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?:/gm;
const PYTHON_PROPERTY = /^\s+@property\s*\n\s*def\s+(\w+)/gm;
const PYTHON_DECORATOR = /^\s+@(\w+(?:\.\w+)*)/gm;

// TypeScript
const TS_CLASS = /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+(.+?))?/gm;
const TS_METHOD = /^\s+(?:async\s+)?(?:(?:public|private|protected)\s+)?(?:static\s+)?(\w+)\s*(?:<.*?>)?\s*\((.*?)\)(?:\s*:\s*(.+?))?/gm;
const TS_INTERFACE = /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+(.+?))?/gm;

// C#
const CS_CLASS = /^\s*(?:public|internal|private|protected)\s+(?:partial\s+)?(?:abstract\s+)?(?:sealed\s+)?class\s+(\w+)(?:\s*(?:<.*?>))?\s*(?::\s*(.+?))?$/gm;
const CS_METHOD = /^\s*(?:public|private|protected|internal)\s+(?:async\s+)?(?:static\s+)?(?:virtual\s+)?(?:override\s+)?(\w+(?:<.*?>)?)\s+(\w+)\s*\((.*?)\)/gm;
const CS_PROPERTY = /^\s*(?:public|private|protected)\s+(?:static\s+)?(\w+(?:<.*?>)?)\s+(\w+)\s*\{/gm;
```

#### Inheritance Resolution

When `query_api_surface(symbol_name="UIStack", include_inherited=true)`:
1. Look up the class in `api_surface.json`
2. Resolve `bases` recursively (within the same surface data)
3. Merge methods/properties from base classes (child overrides win)
4. Annotate each inherited member with `defined_in` showing origin class
5. If a base class is not in the surface (external library), include its name in `bases` but do not fabricate inherited members
6. Return the complete effective API

This is critical for Agent B's use case: `UIStack` may inherit `.with_children()` from `UIElement` base class. Without inheritance resolution, the agent sees an incomplete surface.

#### Integration with Dream Cycle Grounding

Wire into `senses.ts` / `groundEntities()`:
- If `api_surface.json` exists for the target repo, include relevant class signatures in `## Source Code Evidence`
- Dreamer can cite specific methods as evidence for edges
- More precise than raw file reading — structured data vs. raw text
- This **improves** the cognitive/operational boundary: the dreamer receives structured summaries ("UIStack has methods: horizontal(), with_children()") rather than raw source code excerpts

---

### 1B. Code Validation Against Graph

**Priority:** HIGH (both agents confirm)
**Effort:** Medium
**Layer:** Operational
**Depends On:** 1A (API surface extraction)
**Delivers:** 1 new tool

#### The Problem

Agent A: "After I write code, I have no way to ask 'does this code call methods that actually exist?' I just submit it and hope."

Agent B: "I write a tool file, then call this. It cross-references my imports, method calls, and attribute access against the known API surface and returns violations. This would have caught all three errors in one pass."

#### Design

**Tool: `validate_code_against_graph`** — On-demand post-write correctness check

```typescript
{
  name: "validate_code_against_graph",
  description: "Validate a source file against DreamGraph's known operational API surface. Cross-references imports, method calls, and attribute access against extracted class signatures. Returns machine-readable violations with suggestions. Call this AFTER writing or modifying code to catch API mismatches before runtime.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Source file to validate."
      },
      strictness: {
        type: "string",
        enum: ["lenient", "strict"],
        default: "lenient",
        description: "lenient: only flag mismatches against known symbols. strict: flag all unresolved calls."
      },
      check_imports: {
        type: "boolean",
        default: true,
        description: "Validate imports against known symbols."
      },
      check_calls: {
        type: "boolean",
        default: true,
        description: "Validate method/function calls."
      },
      check_attributes: {
        type: "boolean",
        default: true,
        description: "Validate attribute/property access."
      },
      platform: {
        type: "string",
        description: "Optional platform context for filtering API surface."
      },
      return_suggestions: {
        type: "boolean",
        default: true,
        description: "Include Levenshtein-distance replacement suggestions when a mismatch is found. Set false for pass/fail-only checks."
      }
    },
    required: ["file_path"]
  }
}
```

**Expected output:**

```json
{
  "ok": true,
  "file_path": "src/tools/json_tool.py",
  "summary": {
    "errors": 2,
    "warnings": 1,
    "imports_checked": 8,
    "calls_checked": 24,
    "attributes_checked": 12
  },
  "violations": [
    {
      "severity": "error",
      "kind": "missing_method",
      "line": 47,
      "column": 18,
      "symbol": "UIStack.vertical",
      "message": "UIStack has no method 'vertical'.",
      "suggestions": ["UIStack.horizontal"],
      "known_on_symbol": ["horizontal", "with_children", "spacing"]
    },
    {
      "severity": "warning",
      "kind": "unresolved_import",
      "line": 3,
      "column": 1,
      "symbol": "UINumberInput",
      "message": "Import could not be resolved from known API surface."
    }
  ]
}
```

**Violation kinds** (machine-friendly enum agents can switch on):
- `missing_method` — class IS known, method IS NOT
- `missing_property` — class IS known, property IS NOT
- `unresolved_import` — import target not in API surface
- `wrong_arity` — method exists but parameter count doesn't match
- `type_mismatch` — parameter type doesn't match (when extractable)

**Note:** v0.3.0 proposed a `dream://api-violations` resource alongside this tool. That has been **dropped** — see §Resolved Contradictions. The tool's direct response is the primary interface. Violations are ephemeral (stale the moment the file is edited) and no cognitive consumer needs them.

#### How It Works

1. **Read the target file** via `readSourceFile()`
2. **Extract method calls** via regex:
   ```typescript
   // Python: obj.method() or Class.method()
   const PY_CALL = /(\w+)\.(\w+)\s*\(/g;
   // TypeScript: obj.method() or Class.method()
   const TS_CALL = /(\w+)\.(\w+)\s*[(<]/g;
   ```
3. **Resolve class names** from imports:
   ```typescript
   // "from ui.stack import UIStack" → UIStack maps to class UIStack
   const PY_IMPORT = /from\s+([\w.]+)\s+import\s+(.+)/g;
   ```
4. **Cross-reference** each `className.methodName` against `api_surface.json`
5. **Produce violations** with machine-friendly `kind` values and optional Levenshtein-distance suggestions
6. **Return summary** (error/warning counts + items checked) so agents can react to pass/fail without reading every violation

#### Strictness Modes

- **Lenient** (default): Only flags calls where the class IS in `api_surface.json` but the method is NOT. This is the sweet spot — no false positives from external libraries.
- **Strict**: Flags ALL unresolved method calls. Noisy but thorough.

Agent B's insight shapes this: "incorporates the knowledge graph's understanding of intent vs. implementation." The lenient mode does exactly this — it only speaks up about things the graph *knows* about.

---

## Tier 2: Build This — High Priority

### 2A. Implementation Pattern Library

**Priority:** HIGH
**Effort:** Small-Medium
**Layer:** Operational
**Delivers:** 1 new tool + 1 new data store

#### The Problem

Agent A: "When I created `senses.ts`, I copied the `resolveSafePath()` pattern from `code-senses.ts`. Every time I create something new, I: find a reference, read it, extract the pattern, adapt it."

Agent B: "Return a concrete, copy-pasteable code template with the actual working API calls. Pattern names like 'encoder-decoder-tool', 'split-grid-input-output'. I wrote 8 tools that all followed 3 patterns."

#### Design

Agent B's feedback reframes this from a parametric generator to a **named pattern library**. The tool stores known-working patterns extracted from actual code, returns them by name:

**Tool: `get_implementation_pattern`**

```typescript
{
  name: "get_implementation_pattern",
  description: "Return a named, working implementation pattern extracted from real project code. Use to replicate a known structure safely instead of inventing one from scratch. Use 'list' as pattern_name to enumerate available patterns.",
  inputSchema: {
    type: "object",
    properties: {
      pattern_name: {
        type: "string",
        description: "Named implementation pattern (e.g., 'encoder-decoder-tool', 'mcp-tool-with-validation', 'safe-file-reader'). Use 'list' to see all available patterns."
      },
      target_language: {
        type: "string",
        enum: ["auto", "python", "typescript", "javascript", "csharp"],
        default: "auto",
        description: "Filter to a target language when applicable."
      },
      platform: {
        type: "string",
        description: "Optional platform context filter."
      },
      customize: {
        type: "object",
        additionalProperties: { type: ["string", "number", "boolean"] },
        description: "Optional placeholder substitutions (e.g., {name: 'MyTool', group: 'encoders'})."
      },
      include_source_reference: {
        type: "boolean",
        default: true,
        description: "Include file/path provenance for the pattern. Set false when you just want the template."
      }
    },
    required: ["pattern_name"]
  }
}
```

**Expected output:**

```json
{
  "ok": true,
  "pattern": {
    "id": "encoder-decoder-tool",
    "name": "Encoder/Decoder Tool Pattern",
    "language": "python",
    "platform": "desktop",
    "description": "Two-pane tool with input, transform action, and output display.",
    "source_file": "src/tools/base64_tool.py",
    "confidence": 0.91,
    "required_imports": [
      "from ui.layouts import UISplitGrid",
      "from ui.text_inputs import UITextInput"
    ],
    "required_registrations": [
      "src/tools/__init__.py"
    ],
    "template": "class {{name}}(...):\n    ...",
    "placeholders": {
      "name": { "description": "Tool class name" },
      "group": { "description": "Tool group identifier", "default": "encoders" }
    },
    "ui_elements_used": ["UISplitGrid", "UITextInput", "UIButton", "UITextOutput"],
    "provenance": {
      "kind": "pattern_inference",
      "source_files": ["src/tools/base64_tool.py", "src/tools/url_encoder_tool.py"],
      "inferred_at": "2026-04-08T12:34:56Z"
    }
  }
}
```

**Data Store: `implementation_patterns.json`**

```typescript
interface PatternLibrary {
  patterns: ImplementationPattern[];
}

interface ImplementationPattern {
  id: string;                     // "encoder-decoder-tool"
  name: string;                   // "Encoder/Decoder Tool Pattern"
  description: string;            // When to use this pattern
  language: string;               // "python", "typescript", etc.
  platform?: string;              // "desktop", "web", "mobile", etc.
  source_file: string;            // Actual file this was extracted from
  template: string;               // The code template with {{placeholders}}
  placeholders: {                 // What can be customized
    [key: string]: {
      description: string;
      default?: string;
    }
  };
  required_imports: string[];     // Import lines needed
  required_registrations: string[]; // Files that need updating (e.g., "__init__.py")
  ui_elements_used: string[];     // UI registry IDs this pattern uses
  tags: string[];
  confidence: number;             // 0.0-1.0 — higher for manually curated, lower for extraction-inferred
  provenance: Provenance;         // How this pattern was derived (see §Cross-Cutting Concerns)
}
```

#### Population Strategy

Patterns are populated through **two paths only** (see §Resolved Contradictions for why dream-extraction was removed):

1. **Manual enrichment** — developer or agent adds patterns to `implementation_patterns.json` via enrichment scripts or direct editing. Provenance: `kind: "manual"`, `confidence: 1.0`.
2. **Extraction-time inference** — `extract_api_surface` with `include_patterns=true` runs the pattern inference engine during operational extraction. Provenance: `kind: "pattern_inference"`, confidence calculated from structural similarity score. See §Pattern Inference Rules for the exact criteria.

**The cognitive layer never writes to `implementation_patterns.json`.** The dreamer may *read* pattern data for grounding (same as it reads any fact/operational data), but it produces DreamEdges, not patterns.

---

### 2B. Next-Action Recommender

**Priority:** MEDIUM-HIGH
**Effort:** Small
**Layer:** Fact (reads `workflows.json`)
**Delivers:** 1 new tool

#### The Problem

Agent B: "After I create a tool file, the graph knows I also need to update `__init__.py` for registration. An agent-facing 'what should I do next' tool that reasons over the graph's workflow knowledge would prevent me from forgetting steps."

#### Design

**Tool: `suggest_next_action`**

```typescript
{
  name: "suggest_next_action",
  description: "Suggest the next development step using known project workflows and the current work state. Use after creating, editing, or registering something to avoid missed follow-up steps.",
  inputSchema: {
    type: "object",
    properties: {
      completed_action: {
        type: "string",
        description: "Natural-language description of what was just completed (e.g., 'created tool file src/tools/new-tool.ts', 'added UI element to registry')."
      },
      workflow_id: {
        type: "string",
        description: "Optional: specific workflow identifier. If omitted, auto-detects from completed_action."
      },
      context: {
        type: "object",
        properties: {
          file_path: { type: "string" },
          symbol_name: { type: "string" },
          feature_id: { type: "string" },
          platform: { type: "string" }
        },
        additionalProperties: true,
        description: "Optional structured context for resolving concrete file paths in suggestions."
      },
      max_steps: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        default: 3,
        description: "Maximum number of next steps to return."
      }
    },
    required: ["completed_action"]
  }
}
```

**Expected output:**

```json
{
  "ok": true,
  "workflow": {
    "id": "create-new-tool",
    "name": "Create New Tool"
  },
  "matched_step": {
    "order": 2,
    "name": "Create tool file"
  },
  "next_steps": [
    {
      "order": 3,
      "name": "Register tool",
      "description": "Add the new tool export to src/tools/__init__.py",
      "files": ["src/tools/__init__.py"]
    },
    {
      "order": 4,
      "name": "Validate API usage",
      "description": "Run validate_code_against_graph on the new tool file",
      "files": ["src/tools/my_tool.py"]
    }
  ],
  "completion_percentage": 40
}
```

#### How It Works

1. **Load all workflows** from `system://workflows`
2. **Fuzzy match** `completed_action` against workflow step descriptions
3. **Identify current position** in the best-matching workflow
4. **Return next steps** (up to `max_steps`) with concrete file paths resolved from context

This is lightweight — no LLM needed, purely workflow + fuzzy text matching. The value is connecting the agent's ad-hoc actions to the graph's procedural knowledge.

---

## Tier 3: Build This — Medium Priority

### 3A. API Drift Detection

**Priority:** MEDIUM
**Effort:** Medium
**Layer:** Operational
**Depends On:** 1A (API surface extraction)
**Delivers:** 1 new resource

#### The Problem

Agent B: "When I add `.vertical()` to `UIStack`, the knowledge graph should know that the API surface changed. A resource that shows where the graph's model of the codebase has diverged from the actual code would help me (and your internal dream cycles) stay synchronized."

#### Design

**Resource: `ops://api-drift`**

```typescript
interface ApiDrift {
  last_extraction: string;        // When api_surface.json was last updated
  drifts: DriftEntry[];
}

interface DriftEntry {
  file_path: string;
  file_modified: string;          // File's mtime
  surface_extracted: string;      // When the surface for this file was captured
  stale: boolean;                 // file_modified > surface_extracted
  changes_detected?: {            // If we re-scanned to check
    new_methods: string[];
    removed_methods: string[];
    new_classes: string[];
    removed_classes: string[];
    confidence: number;           // How confident we are this drift is significant (0.0-1.0)
  }
}
```

#### How It Works

1. On resource read, compare `api_surface.json` timestamps against file mtimes
2. Flag files modified since last extraction
3. Optionally re-extract stale files to show specific changes
4. **Pure read, no side effects** — see §Resolved Contradictions

#### Integration with Cognitive Pipeline (Read-Only)

Drift does NOT create tensions directly. Instead, it influences the cognitive pipeline through the existing grounding mechanism:

1. `groundEntities()` in `senses.ts` checks `api_surface.json` freshness when providing evidence
2. Stale surface data → lower grounding confidence for affected entities
3. Dreamer produces weaker edges for poorly-grounded entities
4. Normalizer rejects more → rejection pipeline may create tensions via existing mechanism
5. No new code path needed — the existing pipeline handles it naturally

---

### 3B. Response Scoping (Extension)

**Priority:** MEDIUM
**Effort:** Small
**Delivers:** Parameter extension to existing tools

#### The Problem

Agent B: "`query_ui_elements` returned full Blazor implementation details that I didn't need (I'm in the Python port). A parameter like `context='python-port'` or `layer='api'` that filters out irrelevant implementation details would reduce my context consumption."

#### Design

Add optional `platform` filter to existing query tools:

```typescript
// Extend query_ui_elements
{
  // existing params...
  platform: {
    type: "string",
    description: "Filter platform implementations to only this platform (e.g., 'python', 'web', 'ios'). Reduces response size by omitting irrelevant platform details."
  },
  detail_level: {
    type: "string",
    enum: ["full", "api_only", "summary"],
    default: "full",
    description: "full: everything. api_only: name, methods, properties only. summary: name and purpose only."
  }
}
```

This applies to:
- `query_ui_elements` — filter by platform, reduce platform implementation noise
- `query_api_surface` — already addressable via parameter targeting
- `query_resource` — add optional `detail_level` parameter

Agent B's token-budget concern is real: AI agents have finite context windows. Every irrelevant Blazor implementation detail in a Python porting session is wasted tokens.

---

## Tier 4: Already Exists — Needs Awareness

### 4A. Generalized Type Registry

The UI registry already supports cross-platform gap detection. The converter agent loaded 65 elements in one call — that pattern works. What's needed:
- Document that UI registry should be used for ALL cross-platform types, not just visual components
- Consider adding `scope: "ui" | "service" | "model" | "utility"` field in a future version
- Rename consideration: "Component Registry" instead of "UI Registry"

### 4B. Project-Specific Workflows

Both agents needed procedural knowledge ("which files to create, which registries to update"). This exists in `system://workflows` — just needs project-specific workflow entries in each instance's `workflows.json`.

### 4C. Tool Discoverability

Agent A: "I see 55 tools and I gravitate toward obvious names. `generate_ui_migration_plan` sounds like a reporting tool, not something that would help me find 'where is the Python equivalent of this C# class.'"

**Action:** Review all tool descriptions to include use-case triggers, not just mechanism descriptions. Example:
- Before: "Generate a migration plan between source and target platforms"
- After: "Find which classes/components are missing in a target platform and estimate porting complexity. Use when you need to know 'what C# types have Python equivalents and which are missing.'"

---

## Tier 5: Out of Scope

### Full AST / LSP Integration

Full cross-language AST mapping requires Roslyn (C#), tree-sitter (multi), Pylance (Python). This is language server territory. DreamGraph should *consume* LSP output as a sense in the future (`lsp_senses.ts`), not reimplement it. v7+ consideration.

---

## Pattern Inference Rules

When `extract_api_surface` runs with `include_patterns=true`, the extraction pass may infer candidate implementation patterns. This section defines the exact boundaries to prevent hidden code analysis or cognitive leakage.

### What Counts as a Pattern

A pattern is a **structural template** — a repeating arrangement of classes, methods, imports, and registrations that multiple source files share. It is NOT:
- Semantic analysis ("these files do similar things")
- LLM-inferred groupings
- Anything requiring understanding of what the code *means*

A pattern is purely syntactic: "these files have the same shape."

### Structural Similarity Rules

Two or more files qualify as instances of the same pattern when they share **all** of the following:

| Rule | Threshold | Rationale |
|------|-----------|-----------|
| **Minimum repetition** | ≥ 3 files must match | Two files sharing structure might be coincidence. Three is a pattern. |
| **Class hierarchy match** | Same base class or same set of implemented interfaces | The strongest structural signal. If `ToolA(BaseTool)`, `ToolB(BaseTool)`, `ToolC(BaseTool)` all exist, that's a pattern. |
| **Method signature shape** | ≥ 70% of method names overlap (normalized: strip numeric suffixes, lowercase) | Files that implement the same interface will have overlapping method names. |
| **Import overlap** | ≥ 50% of import sources overlap | Files using the same libraries for the same structure. |
| **File path locality** | All files in the same directory or sibling directories (max 2 levels apart) | Patterns are local to a module, not scattered across the tree. |

### What the Inference Produces

For each detected pattern group, the inference engine produces:

```typescript
{
  id: string;                     // auto-generated: "{base_class}-{directory}" e.g., "BaseTool-src-tools"
  name: string;                   // auto-generated: "{base_class} Pattern in {directory}"
  source_file: string;            // the most representative file (most methods, best documented)
  template: string;               // extracted from source_file with class/method names replaced by {{placeholders}}
  placeholders: object;           // derived from the varying parts across matched files
  confidence: number;             // calculated: (matched_criteria / total_criteria) * file_count_factor
  provenance: {
    kind: "pattern_inference",
    source_files: string[],       // all files that matched
    inferred_at: string
  }
}
```

### Confidence Calculation

```
base_score = (criteria_matched / 5) where criteria are: repetition, hierarchy, methods, imports, locality
file_factor = min(matched_files / 5, 1.0)  — more files = more confidence, caps at 5+
confidence = base_score * 0.7 + file_factor * 0.3
```

Maximum possible confidence for inferred patterns: **1.0** (all criteria met, 5+ files). In practice, most inferred patterns score 0.65–0.85.

### What Inference Does NOT Do

| Forbidden operation | Why |
|--------------------|----|
| Read file contents beyond import lines and class/method signatures | Pattern inference operates on the **same data already extracted** for the API surface. No additional file reads. |
| Use LLM for grouping or naming | Inference is deterministic. Same input → same output. No temperature, no creativity. |
| Write to cognitive stores | Patterns go to `implementation_patterns.json` (operational layer) only. |
| Run during dream cycles | Inference only runs when `extract_api_surface` is called with `include_patterns=true`. The dreamer never triggers it. |
| Propose patterns with confidence < 0.5 | Below 50% match quality, the grouping is noise, not signal. Silently discarded. |

### Guard Rails

1. **Extraction log:** Every inference run logs to the tool's output: `patterns_inferred: N`, `patterns_rejected_low_confidence: M`. Full transparency.
2. **Source traceability:** Every inferred pattern's `provenance.source_files` lists exactly which files produced it. An agent can verify by reading those files.
3. **Manual override:** A pattern added manually (`provenance.kind: "manual"`) always takes precedence over an inferred pattern with the same `id`. Manual patterns are never overwritten by inference.
4. **No accumulation:** Each `include_patterns=true` run **replaces** all inferred patterns for the scanned path. Patterns don't silently grow across runs.

---

## Implementation Roadmap

### Phase 1: API Surface Core (v6.2 — Keystone)

This is the keystone: everything else depends on it.

- [ ] Create `src/tools/api-surface.ts`
  - [ ] `extract_api_surface` tool — incremental extraction with language-aware regex
  - [ ] `query_api_surface` tool — symbol-generic query with inheritance resolution + `defined_in`
  - [ ] `ops://api-surface` resource — full cached surface
- [ ] Create `data/api_surface.json` schema + persistence
- [ ] Language extractors: Python, TypeScript, JavaScript, C# (regex-based)
- [ ] Incremental mode: compare file mtime against `provenance.extracted_at` per module
- [ ] `module_name` extraction (dotted import path, not just file path)
- [ ] `signature_text` generation (compact one-liners per method)
- [ ] Inheritance resolution for `include_inherited=true` with `defined_in` annotation
- [ ] Unresolvable base class handling (show name, no fabricated members)
- [ ] `platform` tagging on extracted modules
- [ ] Wire into `senses.ts` / `groundEntities()` as grounding source (read-only from cognitive layer)
- [ ] Register tools + resource in `src/tools/register.ts`
- [ ] Add `ops://api-surface` to `URI_TO_FILE` in `query-resource.ts`
- [ ] Update `enrich-graph.mjs` with `api_surface` feature entity

### Phase 2: Code Validation + Patterns (v6.2)

- [ ] Create `src/tools/code-validator.ts`
  - [ ] `validate_code_against_graph` tool — on-demand file validation
  - [ ] Lenient/strict modes with granular `check_imports`/`check_calls`/`check_attributes` toggles
  - [ ] Machine-friendly violation `kind` enum (`missing_method`, `unresolved_import`, etc.)
  - [ ] Levenshtein-distance "did you mean" suggestions (toggleable via `return_suggestions`)
  - [ ] Summary output: error/warning counts + items checked
- [ ] Create `src/tools/patterns.ts`
  - [ ] `get_implementation_pattern` tool — named pattern lookup with provenance + confidence
  - [ ] `implementation_patterns.json` data store with `platform` and `provenance` fields
  - [ ] Pattern template engine with `{{placeholder}}` substitution
  - [ ] Pattern inference engine with rules from §Pattern Inference Rules
  - [ ] `include_patterns` integration: extract infers candidate patterns during extraction

### Phase 3: Workflow Intelligence + Scoping (v6.2)

- [ ] Create `src/tools/workflow-advisor.ts`
  - [ ] `suggest_next_action` tool — workflow-aware next-step recommendation with `max_steps` constraint
  - [ ] Structured `context` input (file_path, symbol_name, feature_id, platform)
  - [ ] Fuzzy matching of completed actions to workflow steps
- [ ] Extend `query_ui_elements` with `platform` and `detail_level` filters
- [ ] Extend `query_resource` with optional `detail_level`
- [ ] Add `platform` and `language` filters to `query_api_surface` (already in schema)
- [ ] Update all tool descriptions for discoverability (use-case triggers)

### Phase 4: Drift Detection (v6.2)

- [ ] Add `ops://api-drift` resource to `api-surface.ts`
- [ ] File mtime comparison against `provenance.extracted_at` timestamps
- [ ] Incremental re-extraction of stale files
- [ ] Confidence scoring on drift significance
- [ ] Grounding freshness integration: stale surface → lower grounding confidence in `groundEntities()`
- [ ] Optional: `compare_api_surfaces` cross-language diff tool

---

## New Tool Count Impact

| Category | Current (v6.0) | After Phase 1-3 (v6.2) | After Phase 4 (v6.2) |
|----------|----------------|------------------------|----------------------|
| MCP Tools | 55 | 60 (+5) | 60 |
| MCP Resources | 16 | 17 (+1) | 18 (+2) |
| Data Stores | 11 | 13 (+2) | 13 |

New tools: `extract_api_surface`, `query_api_surface`, `validate_code_against_graph`, `get_implementation_pattern`, `suggest_next_action`

New resources: `ops://api-surface`, `ops://api-drift` (Phase 4)

New data stores: `api_surface.json`, `implementation_patterns.json`

**Removed from v0.3.0:** `dream://api-violations` resource (dropped — see §Resolved Contradictions), `compare_api_surfaces` tool deferred to post-v6.2.

---

## Documentation Updates Required

Per `.github/copilot-instructions.md`:

| File | Updates |
|------|---------|
| `package.json` | Version bump to 6.2.0 |
| `src/config/config.ts` | Version bump to 6.2.0 |
| `docs/tools-reference.md` | 5 new tool entries with parameter tables, 2 new resource entries, `ops://` URI prefix |
| `docs/data-model.md` | 2 new data store schemas (`api_surface.json`, `implementation_patterns.json`) |
| `docs/architecture.md` | Three-layer model diagram, source layout (new files), data directory listing, Mermaid diagrams |
| `docs/cognitive-engine.md` | Grounding freshness integration (API surface as evidence source), three-layer invariant |
| `docs/workflows.md` | New workflow: API surface extraction + validation |
| `README.md` | Tool/resource counts, capabilities list, source layout, data dir, three-layer model |
| `docs/README.md` | Version + counts |

---

## Architecture Decision

**ADR-XX: Regex-Based API Surface Extraction Over AST Parsing**

**Context:** Two independent AI agents performing cross-language porting with DreamGraph identified the same #1 gap: method-level API surface knowledge. Full AST parsing requires language-specific parsers adding significant dependency weight.

**Decision:** Use language-aware regex patterns for signature extraction, accepting ~90% accuracy. This matches the existing pattern used by `adversarial.ts` (security regex scanning) and `init-graph.ts` (heuristic file classification).

**Consequences:**
- (+) Zero new dependencies
- (+) Same architectural pattern as existing features
- (+) Good enough for knowledge graph grounding (not compilation)
- (+) Covers 100% of the actual bugs both agents encountered (all were obvious method-name mismatches)
- (-) Will miss complex multi-line signatures, generics, extension methods
- (-) No type inference across method calls

**Guard Rails:**
- API surface is advisory, not authoritative — never block operations based on it
- Always show extraction coverage (files scanned / total files) in resource output
- Document known blind spots per language in tool descriptions
- `validate_code_against_graph` defaults to lenient mode to minimize false positives

---

**ADR-XX: Three-Layer Data Model with Unidirectional Read Flow**

**Context:** The v0.3.0 TDD proposed features where the cognitive layer would write implementation patterns and where resources would create tensions as side effects. Architectural evaluation identified these as layer boundary violations.

**Decision:** Formalize three data layers (Cognitive, Operational, Fact) with an explicit invariant: data flows upward for reads, never downward for writes. Resources are always pure reads.

**Consequences:**
- (+) Clear ownership — every data file belongs to exactly one layer
- (+) Prevents cognitive contamination — the dreamer never writes structured code data
- (+) Prevents side-effect surprises — resources are always safe to read
- (+) Simplifies testing — each layer's mutation surface is small and predictable
- (-) Pattern inference cannot benefit from dream-cycle creativity (accepted trade-off)
- (-) API drift cannot directly create tensions (must flow through grounding → dream → normalize → tension pipeline, which adds latency)

**Guard Rails:**
- New data files must declare their layer in the creating PR
- `ops://` URI prefix for operational resources, `dream://` for cognitive, `system://` for fact
- Code review flag: any cognitive function importing from `src/tools/` is a boundary violation

---

## Cross-Cutting Concerns: Provenance & Confidence

These two concepts apply across all operational knowledge artifacts. They distinguish DreamGraph from a dumb cache.

### Provenance

Every artifact in the operational knowledge layer tracks *how it got there*:

```typescript
interface Provenance {
  kind: "extracted" | "pattern_inference" | "manual";
  source_files: string[];         // files that produced this artifact
  extracted_at?: string;          // for "extracted" kind
  inferred_at?: string;           // for "pattern_inference" kind
}
```

**Where provenance appears:**
- `ApiModule.provenance` — always `"extracted"`, tracks which files and when
- `ImplementationPattern.provenance` — `"extracted"` (from one file template), `"pattern_inference"` (from structural similarity across files), or `"manual"` (developer-curated)

**Note:** v0.3.0 included a `"dream_proposed"` provenance kind for patterns. This has been **removed** — the cognitive layer does not produce patterns (see §Resolved Contradictions). The `"dream_proposed"` concept remains valid for `DreamEdge` artifacts, which already track their origin strategy via the `strategy` field on `DreamEdge`.

**Why provenance matters:** When an agent queries `query_api_surface("UIStack")` and gets a method list, it needs to know whether that data was extracted 5 minutes ago from real source code vs. inferred from structural similarity. Trust degrades with provenance distance.

### Confidence

Confidence scores apply only to **inferred** artifacts — not to directly extracted API surfaces (which are either correct-by-extraction or stale-by-time):

| Artifact | Has confidence? | Rationale |
|---------|----------------|-----------|
| API surface (extracted methods) | **No** | Extracted from source — either accurate or stale, not uncertain |
| Implementation patterns (manual) | **1.0** (implicit) | Developer-curated — highest trust |
| Implementation patterns (inferred) | **Yes** | Inferred from structural similarity — confidence calculated per §Pattern Inference Rules |
| Drift `changes_detected` | **Yes** | "Is this drift significant?" is a judgment call |

**Confidence scale:** 0.0–1.0, consistent with DreamGraph's existing edge confidence model.

---

## Summary

Two AI agents, same conclusion: **DreamGraph's conceptual layer is excellent for planning; the gap is at the implementation layer.** Every runtime error in the DevToys port originated between "the graph says this exists" and "the code doesn't expose the method I assumed."

Five new tools and two new resources close this gap across three layers:

| Layer | Tool/Resource | Purpose |
|-------|--------------|---------|
| **Operational** | `extract_api_surface` | Batch-extract what methods actually exist |
| **Operational** | `query_api_surface` | "What can I call on this class?" |
| **Operational** | `validate_code_against_graph` | "Does my code call real methods?" |
| **Operational** | `get_implementation_pattern` | "Give me the working code for this pattern" |
| **Fact** | `suggest_next_action` | "What should I do next?" |
| **Operational** | `ops://api-surface` | Full cached surface for grounding and bulk analysis |
| **Operational** | `ops://api-drift` | "Where has the code changed since I last looked?" |

All follow DreamGraph's existing patterns (regex analysis, JSON data stores, MCP tools, grounding for dream cycles) and require zero new external dependencies. The three-layer model ensures the cognitive engine stays abstract, the operational layer stays deterministic, and the fact graph stays authoritative.
