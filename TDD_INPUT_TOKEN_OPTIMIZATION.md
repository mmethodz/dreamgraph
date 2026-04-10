# TDD: Input Token Optimization

**Version:** 1.0  
**Status:** Draft  
**Priority:** Critical — directly impacts operating cost and user adoption  
**Author:** DreamGraph Team  
**Date:** 2026-04-10

---

## 1. Problem Statement

### 1.1 Current State

A 5-minute test session with `claude-opus-4-6` cost **$8 USD**. The root cause is
unbounded input token growth across every API call. Only the context block is
budgeted — everything else is sent at full size on every round-trip.

### 1.2 Per-Call Input Breakdown (Measured)

| Component | Est. Tokens | Budgeted? | Growth Pattern |
|---|---|---|---|
| System prompt (core + overlay) | 2,200 – 2,900 | **No** | Static per session |
| Tool definitions (62 tools) | 5,000 – 6,000 | **No** | Static per session |
| History window (last 10 messages) | **Unbounded** | **No** | **Linear per turn** |
| Context block (file + graph data) | up to 16,000 | Yes | Bounded |
| Current user message | Variable | **No** | Per turn |
| Tool-use round-trip messages | **Unbounded** | **No** | **Multiplicative per round** |
| **Minimum first-call overhead** | **~23,000+** | | |
| **After 5 agentic rounds** | **~80,000+** | | |
| **After 10 turns of conversation** | **~200,000+** | | |

### 1.3 Why It Gets Worse

The agentic loop (up to 25 rounds per user message) re-sends the **entire**
`rawApiMessages` array on every iteration. Each round adds:

1. An assistant message (text + tool_use blocks) → ~200–800 tokens
2. A user message (tool_result blocks) → ~400 tokens per tool (post-truncation)
3. Prior rounds accumulated in the array

After 10 rounds: the array contains ~20 messages×~500 tokens = **10,000 tokens**
of tool round-trip history, **plus** the original history window, **plus** system
prompt and tool definitions — all re-sent every time.

### 1.4 The DreamGraph Advantage

DreamGraph already maintains **abstracted link data** in the knowledge graph:

- **`source_files`** on every entity → maps files to features/workflows/data models
- **`GraphLink`** edges → typed relationships between entities with strength/description
- **`LinkMeta.see_also`** → second-hop reachability
- **`keywords`** and **`domain`** → semantic clustering

This graph structure can power **heuristic relevance filtering** — determining
which tools, history, and context are relevant to a given prompt — without needing
expensive embedding models or vector databases.

---

## 2. Design Goals

| Goal | Target | Current |
|---|---|---|
| First-call input tokens | < 8,000 | ~23,000 |
| Agentic round N input tokens | < 12,000 | 23,000 + N×1,200 |
| 10-turn conversation cost (Opus) | < $0.50 | ~$8.00 |
| "Hello DreamGraph" prompt cost | < $0.01 | ~$0.35 |
| Tool definitions sent | 5–15 relevant | 62 (all) |
| History tokens | Capped at 4,000 | Unbounded |

---

## 3. Architecture: Five Optimization Layers

```
User prompt
    │
    ▼
┌─────────────────────────────────────────────┐
│  L1: Intent-Based Tool Filtering            │  62 → 5-15 tools
│      (graph links + keyword match)          │  saves ~4,000 tokens
├─────────────────────────────────────────────┤
│  L2: Conversation History Compression       │  unbounded → 4,000 cap
│      (rolling summary + recent 3 turns)     │  saves ~10,000+ tokens
├─────────────────────────────────────────────┤
│  L3: System Prompt Tiering                  │  2,900 → 800-2,900
│      (slim prompt for simple queries)       │  saves ~2,000 tokens
├─────────────────────────────────────────────┤
│  L4: Agentic Loop Windowing                 │  full replay → window
│      (keep last 3 rounds, summarize rest)   │  saves ~5,000+ tokens
├─────────────────────────────────────────────┤
│  L5: Context Block Relevance                │  16,000 budget → smart
│      (graph-driven file/section selection)  │  no token savings, but
│                                             │  better signal/noise
└─────────────────────────────────────────────┘
    │
    ▼
  API call: ~6,000–12,000 tokens (vs ~23,000–200,000 today)
```

---

## 4. Layer 1: Intent-Based Tool Filtering

### 4.1 Problem

All 62 tool definitions (~5,400 tokens) are sent on every API call, even when the
user says "Hello" or asks a simple question. Most calls use 0–3 tools.

### 4.2 Solution: Graph-Aware Tool Selector

Use the knowledge graph's link data and the user's prompt to select only relevant
tools. The 62 tools fall into natural clusters:

| Cluster | Tools | When Relevant |
|---|---|---|
| **Core query** | `query_resource`, `search_data_model` | Always (lightweight) |
| **Scan/enrich** | `init_graph`, `scan_project`, `enrich_seed_data` | "scan", "enrich", "build graph" |
| **Code senses** | `read_source_code`, `git_log`, `git_blame` | File references, code questions |
| **Cognitive** | `dream_cycle`, `normalize_dreams`, `nightmare_cycle`, `metacognitive_analysis` | "dream", "analyze", cognitive verbs |
| **ADR** | `record_architecture_decision`, `query_architecture_decisions`, `deprecate_architecture_decision` | "decision", "ADR", architecture questions |
| **UI** | `register_ui_element`, `query_ui_elements`, `generate_ui_migration_plan` | UI/component questions |
| **Data model** | `query_db_schema`, `search_data_model` | Database, schema, entity questions |
| **Discipline** | `discipline_start_session`, `discipline_submit_plan`, etc. | "session", "plan", "verify" |
| **Scheduling** | `schedule_dream`, `list_schedules`, `run_schedule_now` | "schedule", "cron", "automate" |
| **Export** | `export_living_docs`, `export_dream_archetypes`, `generate_visual_flow` | "export", "document", "diagram" |
| **Web/runtime** | `fetch_web_page`, `query_runtime_metrics` | "fetch", "metrics", URLs |

### 4.3 Algorithm: `selectRelevantTools(prompt, graphContext)`

```
Input:  user prompt (string), graph context (features, active file, intent)
Output: subset of ToolDefinition[] (5-15 tools)

1. ALWAYS include: query_resource, search_data_model (cheap, universal)

2. Keyword match against prompt:
   - Extract verbs/nouns from prompt
   - Match against tool cluster keywords (map above)
   - Include matching clusters

3. Graph-link relevance:
   - If active file → look up source_files in features/workflows/data_model
   - Follow GraphLink edges from matched entities
   - If linked entity is a workflow with steps → include code senses
   - If linked entity is a data model → include db senses
   - If linked entity has ADR links → include ADR tools

4. Intent-mode boost:
   - ask_dreamgraph → include cognitive cluster
   - active_file → include code senses
   - selection_only → include code senses + patch tools

5. Fallback: if < 5 tools selected, add scan/enrich cluster

6. Cap: never send more than 20 tool definitions
```

### 4.4 Implementation

New file: `extensions/vscode/src/tool-selector.ts`

```typescript
export interface ToolSelectionContext {
  prompt: string;
  intentMode: IntentMode;
  activeFile: string | null;
  graphFeatures: string[];    // feature IDs linked to active file
  graphWorkflows: string[];   // workflow IDs linked to active file
  graphDataModel: string[];   // data model IDs linked to active file
}

export function selectRelevantTools(
  allTools: ToolDefinition[],
  context: ToolSelectionContext,
): ToolDefinition[] { ... }
```

### 4.5 Expected Savings

| Scenario | Before | After | Savings |
|---|---|---|---|
| "Hello DreamGraph" | 62 tools (5,400 tok) | 2 tools (180 tok) | **5,220 tokens** |
| "scan the project" | 62 tools (5,400 tok) | 8 tools (700 tok) | **4,700 tokens** |
| "explain this file" | 62 tools (5,400 tok) | 12 tools (1,050 tok) | **4,350 tokens** |
| "run a dream cycle" | 62 tools (5,400 tok) | 10 tools (870 tok) | **4,530 tokens** |

---

## 5. Layer 2: Conversation History Compression

### 5.1 Problem

The last 10 messages are sent verbatim on every call. An assistant message from a
tool-using turn can be 2,000+ tokens (tool status, results, summaries). After 5
conversation turns, history alone can exceed 15,000 tokens.

### 5.2 Solution: Rolling Summary + Recent Window

```
History storage:
  ┌──────────────────────────────────┐
  │  Rolling Summary (1 paragraph)   │  ~200 tokens, updated after each turn
  │  "User scanned the project,     │
  │   enriched 12 features, asked   │
  │   about the ADR for auth..."    │
  ├──────────────────────────────────┤
  │  Recent Turn N-2                 │  ~400 tokens (compressed)
  │  Recent Turn N-1                 │  ~400 tokens (compressed)
  │  Recent Turn N (current)         │  Full content
  └──────────────────────────────────┘
  Total: ~1,400 tokens (vs ~15,000 unbounded)
```

### 5.3 Algorithm

```
On each new user message:
  1. If history has > 3 turns:
     a. Take turns [0..N-3]
     b. Summarize into 1-paragraph rolling summary (local model or heuristic)
     c. Store as _historySummary
  2. Build rawApiMessages:
     a. If _historySummary exists, prepend as system message:
        "Previous conversation summary: {_historySummary}"
     b. Include last 2 full turns (user + assistant pairs)
     c. Add current user message
```

### 5.4 Turn Compression

Even within the "recent 2 turns" window, compress assistant messages:

- Strip tool status lines (`🔧 **Calling tool:** ...`, `✅ ... completed`)
- Keep only the final summary paragraph
- Cap each assistant message at 800 tokens

### 5.5 Heuristic Summarization (No LLM Needed)

For the rolling summary, use **extractive heuristics** — no expensive LLM call:

```
1. From each old turn, extract:
   - Tool names used (from metadata.toolsUsed)
   - Resource types mentioned ("features", "workflows", "ADR")
   - Entity IDs/names mentioned
   - Action verbs ("scanned", "enriched", "queried", "recorded")
2. Compose: "Conversation so far: {actions}. Entities discussed: {entities}.
   Tools used: {tools}. Key decisions: {decisions}."
```

This leverages `ChatMessage.metadata` which already stores `toolsUsed`,
`intentMode`, and `reasoningBasis` — no parsing needed.

### 5.6 Expected Savings

| Scenario | Before | After | Savings |
|---|---|---|---|
| Turn 1 (no history) | 0 | 0 | — |
| Turn 3 | ~3,000 | ~1,400 | **1,600 tokens** |
| Turn 5 | ~7,500 | ~1,400 | **6,100 tokens** |
| Turn 10 | ~15,000+ | ~1,400 | **13,600+ tokens** |

---

## 6. Layer 3: System Prompt Tiering

### 6.1 Problem

The full system prompt (~2,900 tokens including overlay) is sent on every call,
even for "Hello DreamGraph" or simple questions that don't need the constraint
hierarchy, data protection tiers, or code change policy.

### 6.2 Solution: Three Prompt Tiers

| Tier | When | Content | Est. Tokens |
|---|---|---|---|
| **Slim** | Simple chat, greetings, questions | Identity + delegation + tool reference | ~800 |
| **Standard** | Graph operations, code questions | Slim + constraint hierarchy + output policy | ~1,600 |
| **Full** | Code changes, ADR work, validation | Everything (current prompt) | ~2,900 |

### 6.3 Tier Selection Heuristic

```
if prompt matches greeting/simple question patterns:
  tier = "slim"
elif intent is "patch" or "validate":
  tier = "full"
elif tools selected include ADR or code-change tools:
  tier = "full"
else:
  tier = "standard"
```

### 6.4 Implementation

Split `ARCHITECT_CORE` into composable sections:

```typescript
// architect-core.ts
export const CORE_IDENTITY = `...`;        // ~300 tokens
export const CORE_DELEGATION = `...`;      // ~400 tokens
export const CORE_TOOL_REF = `...`;        // ~250 tokens (enrich_seed_data ref)
export const CORE_CONSTRAINTS = `...`;     // ~500 tokens
export const CORE_DATA_PROTECTION = `...`; // ~300 tokens
export const CORE_POLICIES = `...`;        // ~400 tokens (output + code change)

export function buildCorePrompt(tier: "slim" | "standard" | "full"): string {
  switch (tier) {
    case "slim":
      return [CORE_IDENTITY, CORE_DELEGATION, CORE_TOOL_REF].join("\n\n");
    case "standard":
      return [CORE_IDENTITY, CORE_DELEGATION, CORE_TOOL_REF,
              CORE_CONSTRAINTS, CORE_POLICIES].join("\n\n");
    case "full":
      return [CORE_IDENTITY, CORE_DELEGATION, CORE_TOOL_REF,
              CORE_CONSTRAINTS, CORE_DATA_PROTECTION, CORE_POLICIES].join("\n\n");
  }
}
```

### 6.5 Expected Savings

| Scenario | Before | After | Savings |
|---|---|---|---|
| "Hello DreamGraph" | 2,900 | 800 | **2,100 tokens** |
| "what features exist?" | 2,900 | 1,600 | **1,300 tokens** |
| "scan & enrich" | 2,900 | 1,600 | **1,300 tokens** |
| Code patch / ADR | 2,900 | 2,900 | 0 (needs full prompt) |

---

## 7. Layer 4: Agentic Loop Windowing

### 7.1 Problem

The agentic tool loop (up to 25 rounds) replays the **entire** `rawApiMessages`
array on every API call. Round N sends rounds 1 through N-1 in full.

Tokens per round: ~1,200 (assistant tool_use + user tool_result, post-truncation)
After 10 rounds: ~12,000 tokens of loop history alone.

### 7.2 Solution: Sliding Window with Digest

```
rawApiMessages structure for round N:

  [0] Initial history (rolling summary + recent turns)     ~1,400 tok
  [1] Current user message                                 ~100 tok
  [2] Loop digest: "Rounds 1-7 summary: called            ~200 tok
       init_graph (ok), scan_project (ok, 45 files),
       enrich features (12 inserted), ..."
  [3] Round N-2: assistant + tool_result                   ~1,200 tok
  [4] Round N-1: assistant + tool_result                   ~1,200 tok
  ── API call for round N ──
  Total: ~4,100 tok (vs ~14,000 unbounded at round 10)
```

### 7.3 Algorithm

```
After each agentic round completes:
  if rawApiMessages has > 6 entries (beyond initial + user):
    1. Extract tool rounds older than the last 2
    2. For each old round, extract:
       - Tool name
       - Success/failure
       - Key metric from truncated result (entity count, status)
    3. Compose digest string
    4. Replace old round messages with single digest message
    5. Keep last 2 rounds intact
```

### 7.4 Digest Format

```
Previous tool rounds:
- Round 1: init_graph → success (instance initialized)
- Round 2: scan_project → success (45 files, 12 features detected)
- Round 3: enrich_seed_data(features) → success (12 inserted, 0 updated)
- Round 4: enrich_seed_data(workflows) → success (8 inserted)
```

This is ~100 tokens regardless of how many rounds preceded it.

### 7.5 Expected Savings

| Agentic Round | Before | After | Savings |
|---|---|---|---|
| Round 1 | ~23,000 | ~10,000 | — (baseline) |
| Round 5 | ~29,000 | ~12,000 | **17,000 tokens** |
| Round 10 | ~35,000 | ~12,000 | **23,000 tokens** |
| Round 25 (max) | ~53,000 | ~12,000 | **41,000 tokens** |

---

## 8. Layer 5: Graph-Driven Context Relevance

### 8.1 Problem

The context block budget (16,000 tokens) is used efficiently for a single file
but doesn't leverage graph knowledge to select **which** information matters.

### 8.2 Solution: Graph Walk for Context Selection

When building the context block, use graph links to determine relevance:

```
1. Start from active file
2. Look up entities with matching source_files
3. Follow GraphLink edges (1-hop)
4. Follow see_also LinkRef (2-hop)
5. Collect: related features, workflows, data model entities
6. Priority-rank by:
   a. Direct source_file match (highest)
   b. GraphLink with strength="strong"
   c. GraphLink with strength="moderate"
   d. see_also references (lowest)
7. Include only top-ranked entities in context
```

### 8.3 Keyword Boost from Graph

Entity `keywords` and `domain` fields provide free relevance signals:

```
If user prompt contains "authentication":
  - Find entities where keywords include "auth" or "authentication"
  - Boost those entities and their 1-hop links
  - Include their ADRs in the constraint context
```

This replaces expensive embedding-based retrieval with **graph traversal** —
the abstraction work was already done by `enrich_seed_data`.

### 8.4 Selective File Content

Instead of including the full active file (up to 16,000 tokens), use graph
knowledge to include only relevant functions:

```
1. From matched entities, collect source_files entries
2. If source_file has line ranges (e.g., "src/foo.ts:45-120"), use them
3. If not, use entity keywords to grep for relevant functions
4. Include only matched function bodies, not full file
```

---

## 9. Implementation Plan

### Phase 1: Quick Wins (Immediate — saves ~70% of waste)

| Task | Layer | Effort | Token Savings |
|---|---|---|---|
| History compression (heuristic summary) | L2 | 1 day | ~6,000–13,000/turn |
| Agentic loop windowing | L4 | 1 day | ~17,000–41,000/session |
| Cap raw history at 4,000 tokens | L2 | 2 hours | Guaranteed cap |

### Phase 2: Tool Filtering (High Impact)

| Task | Layer | Effort | Token Savings |
|---|---|---|---|
| Tool cluster definitions | L1 | 0.5 day | — (prep) |
| Keyword-based tool selector | L1 | 1 day | ~4,000–5,000/call |
| Graph-link tool boosting | L1 | 1 day | Improved relevance |

### Phase 3: Prompt Intelligence

| Task | Layer | Effort | Token Savings |
|---|---|---|---|
| Split ARCHITECT_CORE into sections | L3 | 0.5 day | — (prep) |
| Tier selection heuristic | L3 | 0.5 day | ~1,300–2,100/call |
| Graph-driven context selection | L5 | 2 days | Better signal/noise |

### Phase 4: Advanced (Future)

| Task | Layer | Effort | Benefit |
|---|---|---|---|
| Per-model token counting (tiktoken) | All | 1 day | Accurate budgets |
| Semantic caching of tool results | L4 | 2 days | Avoid re-calling tools |
| Prompt caching (Anthropic) | All | 1 day | 90% off cached prefix |
| Function-level file inclusion | L5 | 3 days | Precise context |

---

## 10. Token Budget Specification

### 10.1 Global Budget

```typescript
interface TokenBudget {
  /** Maximum total input tokens per API call */
  maxInputTokens: number;       // default: 12,000

  /** Budget allocation */
  systemPrompt: number;         // 800–2,900 (tier-dependent)
  toolDefinitions: number;      // 1,500 (filtered tools)
  conversationHistory: number;  // 4,000 cap
  agenticLoopHistory: number;   // 2,500 (window + digest)
  contextBlock: number;         // remainder (~2,000–6,000)
  currentMessage: number;       // 500 (typical)
}
```

### 10.2 Budget Enforcement

```
On each API call:
  1. Calculate fixed costs: system prompt + current message
  2. Allocate tool budget → select tools within budget
  3. Allocate history budget → compress/summarize to fit
  4. Allocate loop budget → window/digest to fit
  5. Remaining budget → context block assembly
  6. If over budget: trim context block (existing logic)
  7. Log: { allocated, used, per_component } for monitoring
```

### 10.3 Budget Monitoring

Add to the chat panel's message metadata:

```typescript
interface TokenUsageMetadata {
  inputTokens: number;           // from API response
  outputTokens: number;          // from API response
  estimatedInputBreakdown: {
    systemPrompt: number;
    toolDefinitions: number;
    conversationHistory: number;
    agenticLoop: number;
    contextBlock: number;
    userMessage: number;
  };
  toolsFiltered: number;         // how many tools were excluded
  historySummarized: boolean;     // whether history was compressed
  loopWindowApplied: boolean;    // whether loop windowing was used
}
```

Display in the chat UI footer: `⚙️ 8,234 in / 1,456 out | 12 tools | 3 rounds`

---

## 11. Cost Projections

### 11.1 Claude Opus 4.6 Pricing (per 1M tokens)

| | Input | Output |
|---|---|---|
| **Without caching** | $15.00 | $75.00 |
| **With prompt caching** | $1.50 (cached) | $75.00 |

### 11.2 Projected Session Costs

**Scenario: "Scan project and enrich graph" (current: ~$8)**

| Component | Before (tokens) | After (tokens) |
|---|---|---|
| System prompt × 10 rounds | 29,000 | 10,000 |
| Tool defs × 10 rounds | 54,000 | 10,000 |
| History × 10 rounds | 50,000 | 14,000 |
| Loop messages × 10 rounds | 60,000 | 20,000 |
| Context × 10 rounds | 50,000 | 30,000 |
| **Total input** | **243,000** | **84,000** |
| **Cost (Opus, no cache)** | **$3.65** | **$1.26** |
| **Cost (Opus, cached)** | ~$2.50 | **$0.38** |
| **Cost (Sonnet)** | ~$0.73 | **$0.25** |
| **Cost (Haiku)** | ~$0.24 | **$0.08** |

**Scenario: "Hello, what features exist?" (current: ~$0.35)**

| Component | Before (tokens) | After (tokens) |
|---|---|---|
| System prompt | 2,900 | 800 |
| Tool defs | 5,400 | 180 |
| History | 0 | 0 |
| Context | 2,000 | 1,000 |
| **Total input** | **10,300** | **1,980** |
| **Cost (Opus)** | **$0.15** | **$0.03** |

### 11.3 Monthly Projection (Active Developer)

Assuming 50 conversations/day, 5 turns average:

| Model | Before | After (no cache) | After (cached) |
|---|---|---|---|
| Opus 4.6 | ~$120/month | ~$35/month | ~$12/month |
| Sonnet 4.6 | ~$24/month | ~$7/month | ~$2.40/month |
| Haiku 4.5 | ~$8/month | ~$2.30/month | ~$0.80/month |

---

## 12. Anthropic Prompt Caching (Phase 4 Accelerator)

Anthropic supports [prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
where static prefix content (system prompt + tool definitions) is cached for 5
minutes at 1/10th the input cost.

### 12.1 How It Works

- Mark the system prompt and tool definitions with `cache_control: { type: "ephemeral" }`
- First call: full price. Subsequent calls within 5 min: cached portion at $1.50/MTok
- The static prefix (system + tools) is ~3,000–8,000 tokens — saving ~$0.10–$0.13 per call

### 12.2 Synergy with This TDD

Prompt caching + tool filtering + history compression = multiplicative savings.
The filtered tool set (smaller) caches more efficiently and the compressed history
means less non-cacheable content.

---

## 13. Testing & Validation

### 13.1 Token Metrics Dashboard

Add a dev-mode overlay in the chat panel showing:

```
┌─ Token Budget ────────────────────────────┐
│ System:  800 / 2,900   (slim tier)        │
│ Tools:   720 / 5,400   (8/62 selected)    │
│ History: 1,200 / 4,000 (3 turns, summary) │
│ Loop:    0 / 2,500     (round 1)          │
│ Context: 2,100 / 6,000                    │
│ Message: 45                               │
│ ──────────────────────────────────────     │
│ Total:   4,865 / 12,000                   │
│ API reported: 5,012 input                 │
└───────────────────────────────────────────┘
```

### 13.2 Regression Tests

| Test | Input | Expected |
|---|---|---|
| Greeting | "Hello" | < 3,000 input tokens, 2 tools sent |
| Simple query | "what features exist?" | < 5,000 tokens, includes query_resource |
| Scan flow | "scan the project" | < 10,000 tokens/round, tools filtered to scan cluster |
| 10-turn chat | 10 back-and-forth turns | History never exceeds 4,000 tokens |
| 25-round agentic | Force 25 tool rounds | Loop window caps at 2,500 tokens |
| Full code review | ADR + file + selection | Full prompt tier, all relevant tools |

### 13.3 A/B Cost Tracking

Log per-session costs to `data/token_log.json`:

```json
{
  "session_id": "...",
  "timestamp": "...",
  "model": "claude-opus-4-6",
  "turns": 5,
  "total_input_tokens": 42000,
  "total_output_tokens": 8500,
  "estimated_cost_usd": 0.84,
  "optimizations_active": ["tool_filter", "history_compress", "loop_window"],
  "savings_vs_baseline": "68%"
}
```

---

## 14. File Manifest

| File | Purpose | Phase |
|---|---|---|
| `extensions/vscode/src/tool-selector.ts` | Intent-based tool filtering with graph awareness | Phase 2 |
| `extensions/vscode/src/history-compressor.ts` | Rolling summary + turn compression | Phase 1 |
| `extensions/vscode/src/token-budget.ts` | Global budget manager and allocator | Phase 1 |
| `extensions/vscode/src/loop-windower.ts` | Agentic loop message windowing | Phase 1 |
| `extensions/vscode/src/prompts/architect-core.ts` | Split into composable sections | Phase 3 |
| `extensions/vscode/src/prompts/index.ts` | Tier selection logic | Phase 3 |
| `extensions/vscode/src/chat-panel.ts` | Integration point for all layers | All phases |

---

## 15. Risk Assessment

| Risk | Mitigation |
|---|---|
| Over-aggressive tool filtering drops needed tool | Always include `query_resource` + fallback: if LLM says "I need tool X", re-call with expanded set |
| History summary loses critical context | Keep last 2 full turns intact; summary includes entity IDs for recovery |
| Budget too tight for complex operations | Dynamic budget: simple queries get 8K, complex operations get 16K |
| Graph not yet populated (cold start) | Fall back to keyword-only filtering; include scan/enrich cluster by default |
| Prompt caching invalidated by dynamic tools | Put static content (system prompt) in cacheable prefix, dynamic content (tools, history) after |

---

## 16. Success Criteria

- [ ] "Hello DreamGraph" costs < $0.03 on Opus
- [ ] 10-round scan+enrich session costs < $1.50 on Opus
- [ ] Token metrics visible in dev mode
- [ ] No regression in tool-use success rate (Architect still calls correct tools)
- [ ] History compression doesn't break multi-turn context
- [ ] Monthly cost for active developer < $15 on Opus, < $3 on Sonnet
