# Technical Design Document: DreamGraph v5.1 — Adaptive Intelligence & Graph RAG

**Version:** 5.1 (Plan)  
**Date:** 2026-04-04  
**Author:** Mika Jussila, Siteledger Solutions Oy  
**Status:** Planned  
**Predecessor:** v5.0 (Seven Advanced Cognitive Capabilities — Implemented)

> **Summary:** Nine capabilities across three release phases (v5.1, v5.2,
> v5.3) that evolve DreamGraph from a cognitive observation layer into an
> adaptive, collaborative, retrieval-augmented intelligence backbone.
>
> Phase 1 (v5.1) — **Self-tuning + event-driven + continuous narrative**  
> Phase 2 (v5.2) — **Graph RAG bridge + lucid dreaming**  
> Phase 3 (v5.3) — **Consensus dreaming + dream-to-test + senses expansion + plugin SDK**

---

## 1. Vision

> *"A system that not only thinks about itself — but tunes how it thinks,
> reacts to what changes, tells its own story, and becomes the knowledge
> backbone for every AI interaction with the codebase."*

DreamGraph v5.0 established seven cognitive capabilities that make the system
*intelligent*. v5.1 makes it **adaptive** — the system learns from its own
performance, reacts to external events, and exposes its accumulated knowledge
as a retrieval layer for any LLM interaction.

### 1.1 Strategic Context

DreamGraph occupies a unique position in the cognitive AI landscape:

| Category | Examples | DreamGraph's Differentiator |
|----------|----------|-----------------------------|
| Agent frameworks | LangChain, CrewAI, AutoGen | DG is not an agent — it's the *substrate* agents think on top of |
| RAG pipelines | LlamaIndex, Pinecone | DG *builds* its own knowledge graph via episodic cognition, not document extraction |
| Coding assistants | Copilot, Cursor, Windsurf | DG doesn't write code — it understands *systems*, not just files |
| Memory systems | MemGPT, Zep | DG has structured *reasoning* with evidence gates, not just long-term recall |
| Cognitive architectures | SOAR, ACT-R | DG is practical and production-deployed, not academic |

The nine capabilities in this plan reinforce that unique position by:
1. **Closing the feedback loop** — metacognition + event-driven triggers
2. **Becoming the knowledge backbone** — Graph RAG bridge
3. **Enabling human–machine collaboration** — lucid dreaming
4. **Multiplying perspectives** — consensus dreaming
5. **Bridging insight to action** — dream-to-test pipeline
6. **Expanding perception** — cross-modal senses
7. **Enabling ecosystem** — plugin SDK

---

## 2. Phase 1 — Adaptive Core (v5.1)

> **Theme:** Make DreamGraph self-tuning, event-reactive, and narratively persistent.
>
> **Effort:** Low–Medium  
> **Impact:** High  
> **Dependencies:** None — builds entirely on v5.0 infrastructure

### 2.1 Capability 1: Metacognitive Self-Tuning

**Module:** `src/cognitive/metacognition.ts`  
**State:** AWAKE (analysis only)  
**Writes to:** `data/meta_log.json`

The system already tracks everything needed to self-optimize: per-strategy
yield in `dream_history.json`, false positive rates from resolved tensions,
promotion success rates. This capability closes the feedback loop.

#### 2.1.1 Architecture

```
loadDreamHistory()
    ↓
computeStrategyMetrics(sessions)
    ↓  per-strategy precision, recall, yield
computePromotionCalibration(candidates, validated)
    ↓  actual validation rate per confidence bucket
computeDomainDecayProfiles(tensions)
    ↓  per-domain optimal decay rates
    ↓
MetacognitiveReport {
    strategy_metrics,
    threshold_recommendations,
    domain_decay_recommendations,
    tuning_actions_taken (if auto_apply)
}
    ↓
appendToMetaLog()
```

#### 2.1.2 Strategy Performance Metrics

For each dream strategy, computed over a rolling window (default: last 50 cycles):

```typescript
interface StrategyMetrics {
  strategy: DreamStrategy;
  /** Total edges generated */
  total_generated: number;
  /** Edges that eventually reached "validated" status */
  total_validated: number;
  /** Precision: validated / generated (0–1) */
  precision: number;
  /** Tensions resolved by edges originating from this strategy */
  tensions_resolved: number;
  /** Recall proxy: tensions_resolved / total_tensions_in_window */
  recall: number;
  /** Average cycles from generation to validation */
  avg_validation_lag: number;
  /** Consecutive zero-yield cycles (already tracked by dreamer.ts benching) */
  consecutive_zero_yield: number;
  /** Recommended budget weight adjustment */
  recommended_weight: number;
}
```

#### 2.1.3 Promotion Threshold Calibration

The current promotion gate uses static thresholds (`confidence >= 0.75`,
`plausibility >= 0.5`, etc.). Calibration analyzes historical outcomes:

```typescript
interface CalibrationBucket {
  confidence_range: [number, number];   // e.g., [0.60, 0.70]
  total_edges: number;
  eventually_validated: number;         // Edges that were later validated
  validation_rate: number;              // eventually_validated / total
}

interface ThresholdRecommendation {
  parameter: keyof PromotionConfig;
  current_value: number;
  recommended_value: number;
  basis: string;                        // Human-readable reasoning
  confidence: number;                   // How confident is the recommendation
}
```

**Calibration Logic:**
1. Bucket all historically normalized edges by their confidence at normalization time
2. For each bucket, compute the actual validation rate
3. If edges at confidence 0.65 validate at >60% rate, recommend lowering `promotion_confidence`
4. If edges at confidence 0.80 validate at <50% rate, recommend raising thresholds
5. Safety guard: never recommend `promotion_confidence` below 0.55 or above 0.90

#### 2.1.4 Domain-Specific Decay Profiles

Different domains should decay at different rates. Security tensions should
persist longer than `general` ones. Analysis:

```typescript
interface DomainDecayProfile {
  domain: TensionDomain;
  avg_resolution_cycles: number;        // How long tensions typically take to resolve
  false_positive_rate: number;          // % resolved as false_positive
  recommended_ttl: number;             // Based on avg_resolution_cycles × 1.5
  recommended_urgency_decay: number;   // Slower for domains with low false_positive_rate
  current_ttl: number;                 // Current DEFAULT_TENSION_CONFIG value
  current_decay: number;
}
```

**Auto-apply mode:** When `auto_apply: true`, the metacognitive engine writes
recommended thresholds directly to engine state (in-memory only — not persisted
to prevent drift). The `meta_log.json` records every auto-tuning action.

#### 2.1.5 Data Schema: Meta Log

```typescript
interface MetaLogEntry {
  id: string;
  timestamp: string;
  cycle_window: [number, number];       // Dream cycles analyzed
  strategy_metrics: StrategyMetrics[];
  threshold_recommendations: ThresholdRecommendation[];
  domain_decay_profiles: DomainDecayProfile[];
  actions_taken: Array<{
    type: "threshold_adjustment" | "decay_adjustment" | "strategy_weight";
    parameter: string;
    old_value: number;
    new_value: number;
    basis: string;
  }>;
  overall_health: string;
}

interface MetaLogFile {
  metadata: {
    description: string;
    schema_version: string;
    total_entries: number;
    last_analysis: string | null;
  };
  entries: MetaLogEntry[];
}
```

#### 2.1.6 MCP Tool

| Field | Value |
|-------|-------|
| **Tool name** | `metacognitive_analysis` |
| **Parameters** | `window_size` (number, default 50 — cycles to analyze), `auto_apply` (boolean, default false) |
| **Output** | `MetaLogEntry` |

#### 2.1.7 MCP Resource

| Resource | `dream://metacognition` |
|----------|------------------------|
| Content | JSON serialization of `MetaLogFile` |

#### 2.1.8 Safety Guarantees

| Guarantee | Enforcement |
|-----------|-------------|
| Never modifies fact graph | Analysis is read-only against dream_history, tensions, candidates |
| Auto-tuning is bounded | Hard min/max guards on all threshold adjustments |
| Auto-tuning is transparent | Every action logged to meta_log.json with basis and old/new values |
| Auto-tuning is reversible | Engine state resets to defaults on restart; meta_log is advisory |
| No threshold persists to disk | Only the log persists; thresholds are in-memory overrides |

---

### 2.2 Capability 2: Event-Driven Dreaming

**Module:** `src/cognitive/event-router.ts`  
**State:** AWAKE (event reception) → delegates to appropriate cognitive state  
**Writes to:** Nothing directly (delegates to existing modules)

Dream cycles are currently triggered on-demand. The most valuable time to think
is *when something changes*. This module creates a reactive event layer.

#### 2.2.1 Architecture

```
External Event Source
    │
    ├── Git webhook (push/PR)
    ├── CI/CD signal (deploy success/failure)
    ├── Runtime anomaly (error spike via runtime-senses)
    ├── Tension threshold breach (urgency > 0.8)
    └── Manual trigger (new tool)
    │
    ▼
EventRouter.dispatch(event)
    │
    ├── classify(event) → EventClassification
    ├── scope(event) → affected entity IDs
    ├── decide(classification) → CognitiveAction
    └── execute(action) → delegates to dream_cycle / nightmare_cycle / etc.
    │
    ▼
EventLog (append-only audit trail)
```

#### 2.2.2 Event Types

```typescript
type EventSource =
  | "git_webhook"
  | "ci_cd"
  | "runtime_anomaly"
  | "tension_threshold"
  | "federation_import"
  | "manual";

type EventSeverity = "critical" | "high" | "medium" | "low" | "info";

interface CognitiveEvent {
  id: string;
  source: EventSource;
  severity: EventSeverity;
  timestamp: string;
  payload: Record<string, unknown>;
  affected_entities: string[];        // Resolved entity IDs from the knowledge graph
  description: string;
}
```

#### 2.2.3 Event Classification & Response

| Event Source | Trigger Condition | Cognitive Response |
|-------------|-------------------|--------------------|
| `git_webhook` | Push to configured branch | Scoped `dream_cycle` on changed entities (strategy: `tension_directed`) |
| `ci_cd` | Deploy failure | Scoped `nightmare_cycle` (strategy: `all_threats`) on deployment-related entities |
| `ci_cd` | Deploy success | Scoped `dream_cycle` (strategy: `gap_detection`) — look for new connections |
| `runtime_anomaly` | Error rate > threshold | `get_causal_insights` scoped to affected entities + scoped `dream_cycle` |
| `tension_threshold` | Any tension urgency > 0.8 | Auto-trigger `get_remediation_plan` for the critical tension |
| `federation_import` | Archetypes imported | Scoped `dream_cycle` (strategy: `cross_domain`) on imported patterns |
| `manual` | User dispatches event | Execute specified cognitive action |

#### 2.2.4 Entity Scoping

The event router resolves affected entities from event payloads:

```typescript
interface EntityScope {
  /** Directly affected entity IDs */
  primary: string[];
  /** Entities connected to primary via validated edges (1-hop) */
  secondary: string[];
  /** Combined scope for dream cycle filtering */
  all: string[];
}
```

**Resolution strategies:**
- `git_webhook`: Match changed file paths against entity `source_repo` + `source_file` metadata
- `ci_cd`: Match deployment service names against entity IDs/names
- `runtime_anomaly`: Match metric entity IDs directly
- `tension_threshold`: Use tension's `entities[]` field

#### 2.2.5 Event Reception

Two intake mechanisms:

1. **HTTP Sidecar** (optional, for webhooks):
   ```typescript
   interface EventHttpConfig {
     enabled: boolean;            // Default: false
     port: number;                // Default: 9877
     auth_token?: string;         // Bearer token for webhook verification
     allowed_sources: string[];   // IP allowlist (optional)
   }
   // Configured via DREAMGRAPH_EVENT_HTTP env var (JSON)
   ```
   Lightweight HTTP listener (Node.js `http` module, no framework dependency)
   that accepts POST `/events` and calls `EventRouter.dispatch()`.

2. **Internal triggers** (always active):
   - After each `dream_cycle`: check if any tension crossed the 0.8 threshold
   - After each `query_runtime_metrics`: check for anomalies
   - After each `import_dream_archetypes`: trigger cross-domain dreaming

#### 2.2.6 Event Log

```typescript
interface EventLogEntry {
  event: CognitiveEvent;
  classification: {
    response_type: string;            // e.g., "scoped_dream_cycle"
    entity_scope: EntityScope;
    strategy: string;
  };
  result: {
    action_taken: string;
    duration_ms: number;
    outcome_summary: string;
  };
  timestamp: string;
}

interface EventLogFile {
  metadata: {
    description: string;
    schema_version: string;
    total_events: number;
    last_event: string | null;
  };
  events: EventLogEntry[];
}
```

#### 2.2.7 MCP Tool & Resource

| Field | Value |
|-------|-------|
| **Tool name** | `dispatch_cognitive_event` |
| **Parameters** | `source` (EventSource), `severity` (EventSeverity), `description` (string), `affected_entities` (string[], optional), `payload` (object, optional) |
| **Output** | `EventLogEntry` |

| Resource | `dream://events` |
|----------|-------------------|
| Content | JSON serialization of `EventLogFile` |

#### 2.2.8 Configuration

```typescript
interface EventRouterConfig {
  /** Enable internal tension threshold triggers */
  tension_threshold: number;          // Default: 0.8
  /** Enable internal runtime anomaly triggers */
  runtime_error_threshold: number;    // Default: 0.05 (5% error rate)
  /** Enable HTTP sidecar */
  http: EventHttpConfig;
  /** Cooldown between auto-triggered cycles (prevent runaway) */
  cooldown_ms: number;                // Default: 60_000 (1 minute)
  /** Maximum auto-triggered cycles per hour */
  max_auto_cycles_per_hour: number;   // Default: 10
}
// Configured via DREAMGRAPH_EVENTS env var (JSON)
```

#### 2.2.9 Safety Guarantees

| Guarantee | Enforcement |
|-----------|-------------|
| No runaway dream cycles | Cooldown timer + max cycles per hour cap |
| Events are advisory | All cognitive actions follow existing state machine rules |
| HTTP sidecar is opt-in | Disabled by default; requires explicit config |
| Webhook auth required | Bearer token verification when HTTP is enabled |
| Full audit trail | Every event and response logged to event_log.json |

---

### 2.3 Capability 3: Continuous Narrative Intelligence

**Module:** Extends `src/cognitive/narrator.ts`  
**State:** AWAKE  
**Writes to:** `data/system_story.json`

The current `get_system_narrative` generates narratives on-demand and writes
nothing. This capability makes narrative *persistent and continuous* — a living
system autobiography that evolves over time.

#### 2.3.1 Architecture

```
After every N dream cycles (configurable, default: 10):
    │
    loadExistingStory()
    │
    ├── Compute diff since last chapter
    │   ├── New validated edges
    │   ├── Tensions resolved
    │   ├── Tensions created
    │   ├── Threats discovered
    │   └── Archetypes exchanged
    │
    ├── generateDiffChapter() → NarrativeChapter
    │
    ├── appendToStory()
    │
    └── generateWeeklyDigest() (if enough cycles since last digest)
```

#### 2.3.2 Persistent Story Schema

```typescript
interface StoryMetadata {
  description: string;
  schema_version: string;
  title: string;
  started_at: string;
  last_updated: string;
  total_chapters: number;
  total_cycles_covered: number;
}

interface StoryChapter extends NarrativeChapter {
  /** Chapter number (sequential) */
  chapter_number: number;
  /** What changed since last chapter */
  diff: {
    new_validated_edges: number;
    tensions_created: number;
    tensions_resolved: number;
    threats_discovered: number;
    archetypes_exchanged: number;
  };
}

interface WeeklyDigest {
  id: string;
  generated_at: string;
  cycle_range: [number, number];
  summary: string;
  key_changes: string[];
  health_trend: "improving" | "stable" | "degrading";
  top_tensions: string[];
  top_discoveries: string[];
}

interface SystemStoryFile {
  metadata: StoryMetadata;
  chapters: StoryChapter[];
  digests: WeeklyDigest[];
}
```

#### 2.3.3 Diff Narratives

Instead of regenerating the full narrative each time, diff chapters capture
*what changed*:

```
"Since cycle 145, three new connections were validated between the payment
system and the notification engine. Two security tensions were resolved —
both confirmed as false positives after the Truth Filter verified that RLS
policies were already in place. A new high-urgency tension emerged around
session expiry handling in the order management module."
```

#### 2.3.4 Automatic Chapter Triggers

The continuous narrator hooks into the existing `dream_cycle` tool:

```
After every dream_cycle completion:
    cycles_since_last_chapter++
    if cycles_since_last_chapter >= narrative_interval:
        generateDiffChapter()
        appendToStory()
        cycles_since_last_chapter = 0
```

Configuration:

```typescript
interface NarrativeConfig {
  /** Cycles between auto-generated chapters */
  narrative_interval: number;         // Default: 10
  /** Cycles between weekly digests */
  digest_interval: number;            // Default: 50
  /** Max chapters to retain (oldest pruned) */
  max_chapters: number;               // Default: 100
  /** Enable automatic chapter generation */
  auto_narrate: boolean;              // Default: true
}
// Configured via DREAMGRAPH_NARRATIVE env var (JSON)
```

#### 2.3.5 MCP Tool & Resource

| Field | Value |
|-------|-------|
| **Tool name** | `get_system_story` |
| **Description** | Read the persistent system autobiography. Optionally get only recent chapters or a specific digest. |
| **Parameters** | `last_n_chapters` (number, optional — return only N most recent), `digest_only` (boolean, default false) |
| **Output** | `SystemStoryFile` (filtered by parameters) |

*Note:* The existing `get_system_narrative` tool remains unchanged — it generates
a fresh full narrative on demand. `get_system_story` reads the persistent,
auto-accumulated story.

| Resource | `dream://story` |
|----------|-----------------|
| Content | JSON serialization of `SystemStoryFile` |

---

### 2.4 Phase 1 — Wiring Summary

#### Files Created

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/cognitive/metacognition.ts` | ~350 | Self-tuning engine |
| `src/cognitive/event-router.ts` | ~400 | Event-driven dreaming |
| `data/meta_log.json` | runtime | Metacognitive analysis audit trail |
| `data/event_log.json` | runtime | Event dispatch audit trail |
| `data/system_story.json` | runtime | Persistent system autobiography |

#### Files Modified

| File | Changes |
|------|---------|
| `src/cognitive/types.ts` | Add ~150 lines: `StrategyMetrics`, `CalibrationBucket`, `ThresholdRecommendation`, `DomainDecayProfile`, `MetaLogEntry`, `CognitiveEvent`, `EventLogEntry`, `StoryChapter`, `WeeklyDigest`, `SystemStoryFile`, config interfaces |
| `src/cognitive/narrator.ts` | Add `generateDiffChapter()`, `appendToStory()`, `generateWeeklyDigest()`, persistent story I/O |
| `src/cognitive/register.ts` | Add 3 new tools (`metacognitive_analysis`, `dispatch_cognitive_event`, `get_system_story`). Add 3 new resources (`dream://metacognition`, `dream://events`, `dream://story`). Hook continuous narrator into `dream_cycle` completion. Tool count 14 → 17, resource count 10 → 13 |
| `src/types/index.ts` | Re-export new types |
| `src/config/config.ts` | Add `EventRouterConfig`, `NarrativeConfig` env var parsing |

#### New Environment Variables

| Env Var | Default | Description |
|---------|---------|-------------|
| `DREAMGRAPH_EVENTS` | `(disabled)` | JSON config for event router |
| `DREAMGRAPH_NARRATIVE` | `{ "auto_narrate": true, "narrative_interval": 10 }` | Continuous narrative config |

#### Implementation Checklist

63. Add metacognitive types to `types.ts` (StrategyMetrics, CalibrationBucket, ThresholdRecommendation, DomainDecayProfile, MetaLogEntry, MetaLogFile)
64. Add event-driven types to `types.ts` (CognitiveEvent, EventSource, EventSeverity, EntityScope, EventLogEntry, EventLogFile, EventRouterConfig)
65. Add continuous narrative types to `types.ts` (StoryChapter, WeeklyDigest, SystemStoryFile, StoryMetadata, NarrativeConfig)
66. Create `src/cognitive/metacognition.ts` — strategy metrics, calibration, domain decay profiles, auto-apply with guards
67. Create `src/cognitive/event-router.ts` — event dispatch, classification, entity scoping, cooldown enforcement
68. Extend `src/cognitive/narrator.ts` — diff chapters, persistent story I/O, weekly digests, auto-generation hook
69. Add `EventRouterConfig` and `NarrativeConfig` parsing to `src/config/config.ts`
70. Register `metacognitive_analysis` tool in `register.ts`
71. Register `dispatch_cognitive_event` tool in `register.ts`
72. Register `get_system_story` tool in `register.ts`
73. Register `dream://metacognition`, `dream://events`, `dream://story` resources
74. Hook continuous narrator into `dream_cycle` completion path
75. Hook internal event triggers (tension threshold, runtime anomaly) into `dream_cycle` and `query_runtime_metrics`
76. Re-export new types in `types/index.ts`
77. Build clean (zero errors)

---

## 3. Phase 2 — Knowledge Backbone (v5.2)

> **Theme:** Make DreamGraph the retrieval foundation for all AI interactions,
> and enable direct human–machine collaborative reasoning.
>
> **Effort:** Medium  
> **Impact:** Very High  
> **Dependencies:** Phase 1 (metacognition for threshold tuning, events for reactive triggers)

### 3.1 Capability 4: Graph RAG Bridge

**Module:** `src/cognitive/graph-rag.ts`  
**State:** AWAKE (retrieval only)  
**Writes to:** Nothing (stateless retrieval)

DreamGraph builds the most structured, validated representation of a software
system in existence. This capability exposes it as a **retrieval layer** for
any LLM interaction — the knowledge graph becomes a universal context source.

#### 3.1.1 Architecture

```
Query (natural language or entity reference)
    │
    ▼
GraphRAG.retrieve(query, tokenBudget)
    │
    ├── Entity Resolution
    │   ├── Exact match on entity IDs
    │   ├── Keyword match on names/descriptions
    │   └── TF-IDF similarity scoring
    │
    ├── Subgraph Extraction
    │   ├── BFS expansion from resolved entities (configurable depth)
    │   ├── Include validated edges along path
    │   ├── Include active tensions on touched entities
    │   └── Include recent narrative context
    │
    ├── Relevance Ranking
    │   ├── Edge confidence weighting
    │   ├── Tension urgency weighting
    │   ├── Recency boost (recently validated > older)
    │   └── Query-term overlap scoring
    │
    └── Token-Budgeted Serialization
        ├── Priority: entities > edges > tensions > narrative
        ├── Truncate from lowest-relevance items
        └── Output: structured context string
    │
    ▼
GraphRAGContext {
    context_text: string,         // Token-budgeted context for LLM injection
    entities_included: string[],
    edges_included: number,
    tensions_included: number,
    token_count: number
}
```

#### 3.1.2 Retrieval Modes

| Mode | Use Case | Behavior |
|------|----------|----------|
| `entity_focused` | "Tell me about the payment system" | Resolve entity → BFS expand → ranked context |
| `tension_focused` | "What problems exist?" | Top tensions → their entities → relevant edges |
| `narrative_focused` | "What has changed recently?" | Recent story chapters → referenced entities |
| `comprehensive` | Pre-prompt injection | Balanced mix of architecture overview + top tensions + recent changes |

#### 3.1.3 Cognitive Preamble

A special retrieval mode designed for **automatic injection** before any MCP
client prompt. Produces a compact system understanding summary:

```typescript
interface CognitivePreamble {
  /** One-paragraph system description from knowledge graph */
  system_summary: string;
  /** Top 5 architectural relationships (highest confidence validated edges) */
  key_architecture: string[];
  /** Active tensions (top 3 by urgency) */
  open_questions: string[];
  /** Recent cognitive activity (last 3 story chapters, one-liners) */
  recent_insights: string[];
  /** Total token count */
  token_count: number;
}
```

#### 3.1.4 Entity Similarity (TF-IDF)

Since DreamGraph runs without external embedding services, entity similarity
uses a lightweight TF-IDF implementation over entity descriptions and keywords:

```typescript
interface EntitySimilarity {
  entity_id: string;
  score: number;              // 0–1 cosine similarity
  matched_terms: string[];
}

function computeTfIdf(
  query: string,
  entities: Array<{ id: string; text: string }>
): EntitySimilarity[];
```

Building a full TF-IDF index on startup (~100 entities) is trivial. Index is
rebuilt after each dream cycle that promotes new validated edges.

#### 3.1.5 Data Schema

```typescript
interface GraphRAGQuery {
  query: string;                       // Natural language or entity reference
  mode: "entity_focused" | "tension_focused" | "narrative_focused" | "comprehensive";
  token_budget: number;                // Max tokens in output (default: 2000)
  depth: number;                       // BFS expansion depth (default: 2)
  include_tensions: boolean;           // Default: true
  include_narrative: boolean;          // Default: true
}

interface GraphRAGContext {
  context_text: string;
  entities_included: string[];
  edges_included: number;
  tensions_included: number;
  narrative_chapters_included: number;
  token_count: number;
  retrieval_mode: string;
  relevance_scores: Array<{
    entity_id: string;
    score: number;
  }>;
}
```

#### 3.1.6 MCP Tools

| Tool | Parameters | Output |
|------|-----------|--------|
| `graph_rag_retrieve` | `query` (string), `mode` (enum, default: comprehensive), `token_budget` (number, default: 2000), `depth` (number, default: 2) | `GraphRAGContext` |
| `get_cognitive_preamble` | `max_tokens` (number, default: 500) | `CognitivePreamble` |

#### 3.1.7 MCP Resource

| Resource | `dream://context` |
|----------|-------------------|
| Content | Current `comprehensive` RAG context (2000 tokens, generated fresh) |

---

### 3.2 Capability 5: Lucid Dreaming (Interactive Exploration)

**Module:** `src/cognitive/lucid.ts`  
**State:** LUCID (new fifth cognitive state)  
**Writes to:** `dream_graph.json` (scoped dream edges), `data/lucid_log.json`

A new cognitive state where human intuition meets machine pattern-matching.
The human proposes a hypothesis, DreamGraph explores it, and they co-create
validated understanding.

#### 3.2.1 State Machine Extension

```
AWAKE → LUCID → AWAKE    (interactive exploration)

New methods on CognitiveEngine:
  enterLucid(hypothesis: string): void    // AWAKE → LUCID
  wakeFromLucid(): LucidResult            // LUCID → AWAKE
```

Updated state machine:

```
              ┌──────────────────────────────────────────────┐
              │                                              │
              ▼                                              │
        ┌──────────┐                                         │
        │  AWAKE   │──────────────────┐                      │
        └──────────┘                  │                      │
          │        │          │       │                      │
     enterRem()  enterNight() enterLucid()                   │
          │        │          │       │                      │
          ▼        ▼          ▼       │                      │
     ┌────────┐ ┌─────────┐ ┌───────┐│                      │
     │  REM   │ │NIGHTMARE│ │ LUCID ││                      │
     └───┬────┘ └────┬────┘ └───┬───┘│                      │
         │           │          │    │                      │
   enterNorm()  wakeFromN() wakeFromLucid()                 │
         │           │          │                           │
         ▼           │          │                           │
   ┌───────────┐     │          │                           │
   │NORMALIZING│─────┴──────────┴───────────────────────────┘
   └───────────┘
                         (all paths → wake() → AWAKE)
```

#### 3.2.2 Lucid Dream Flow

```
1. Human proposes hypothesis:
   "I think payment-processing and notification-engine have
    an undiscovered dependency through the order lifecycle."

2. System enters LUCID state:
   - Parses hypothesis → extracts entity references
   - Identifies relationship type from natural language
   - Scopes a focused dream cycle around these entities

3. System runs scoped exploration:
   - Dreams edges between hypothesized entities
   - Searches for supporting signals in fact graph
   - Checks for contradictions
   - Analyzes causal and temporal patterns

4. System presents interactive findings:
   LucidFindings {
     supporting_signals: Signal[],
     contradictions: Signal[],
     related_tensions: TensionSignal[],
     suggested_connections: DreamEdge[],
     confidence_assessment: string
   }

5. Human can interact:
   - "dig_deeper" on a specific signal
   - "dismiss" a contradiction (with reason)
   - "accept" a suggested connection
   - "refine" the hypothesis

6. System wakes with co-created result:
   - Accepted edges → validated (with authority: "human+system")
   - Dismissed contradictions → logged with human reasoning
   - Full session preserved in lucid_log.json
```

#### 3.2.3 Data Schemas

```typescript
type CognitiveStateName = "awake" | "rem" | "normalizing" | "nightmare" | "lucid";

interface LucidHypothesis {
  id: string;
  raw_text: string;                    // Original human input
  parsed_entities: string[];           // Extracted entity IDs
  parsed_relationship: string;         // Inferred relationship type
  created_at: string;
}

interface LucidSignal {
  id: string;
  type: "supporting" | "contradicting";
  source: "fact_graph" | "dream_graph" | "tension_log" | "causal_chain";
  description: string;
  confidence: number;
  entities: string[];
  evidence: string;                    // What makes this signal valid
}

interface LucidFindings {
  hypothesis: LucidHypothesis;
  supporting_signals: LucidSignal[];
  contradictions: LucidSignal[];
  related_tensions: TensionSignal[];
  suggested_connections: DreamEdge[];
  confidence_assessment: string;       // Overall assessment narrative
  exploration_depth: number;           // How many hops were explored
}

interface LucidAction {
  type: "dig_deeper" | "dismiss" | "accept" | "refine";
  target_id: string;                   // Signal or edge ID
  reason?: string;                     // Human reasoning (for dismiss/refine)
  refinement?: string;                 // New hypothesis text (for refine)
}

interface LucidResult {
  hypothesis: LucidHypothesis;
  findings: LucidFindings;
  actions_taken: LucidAction[];
  edges_accepted: ValidatedEdge[];     // Co-created validated edges
  contradictions_dismissed: Array<{
    signal: LucidSignal;
    human_reason: string;
  }>;
  session_duration_ms: number;
  timestamp: string;
}

interface LucidLogFile {
  metadata: {
    description: string;
    schema_version: string;
    total_sessions: number;
    last_session: string | null;
  };
  sessions: LucidResult[];
}
```

#### 3.2.4 MCP Tools

| Tool | Parameters | Output |
|------|-----------|--------|
| `lucid_dream` | `hypothesis` (string, required) | `LucidFindings` |
| `lucid_action` | `action` (LucidAction — type, target_id, reason?, refinement?) | Updated `LucidFindings` |
| `wake_from_lucid` | None | `LucidResult` |

#### 3.2.5 MCP Resource

| Resource | `dream://lucid` |
|----------|-----------------|
| Content | Current `LucidLogFile` |

#### 3.2.6 Safety Guarantees

| Guarantee | Enforcement |
|-----------|-------------|
| Lucid state cannot modify fact graph | Same isolation as REM — only dream_graph is writable |
| Human "accept" creates validated edges | Authority tracked as `"human+system"` — distinguished from pure system validation |
| Session timeout | LUCID auto-wakes after 10 minutes of inactivity (configurable) |
| All sessions logged | Full hypothesis, findings, actions, and results preserved in lucid_log.json |
| No auto-normalization in LUCID | Human controls what gets accepted; system only suggests |

---

### 3.3 Phase 2 — Wiring Summary

#### Files Created

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/cognitive/graph-rag.ts` | ~450 | Graph RAG retrieval engine with TF-IDF |
| `src/cognitive/lucid.ts` | ~500 | Lucid dreaming (interactive exploration) |
| `data/lucid_log.json` | runtime | Lucid dream session archive |

#### Files Modified

| File | Changes |
|------|---------|
| `src/cognitive/types.ts` | Add ~200 lines: `GraphRAGQuery`, `GraphRAGContext`, `CognitivePreamble`, `LucidHypothesis`, `LucidSignal`, `LucidFindings`, `LucidAction`, `LucidResult`, `LucidLogFile` |
| `src/cognitive/engine.ts` | Add `enterLucid()`, `wakeFromLucid()`. Update `CognitiveStateName` to include `"lucid"`. Update interrupt handler for lucid state |
| `src/cognitive/register.ts` | Add 5 new tools (`graph_rag_retrieve`, `get_cognitive_preamble`, `lucid_dream`, `lucid_action`, `wake_from_lucid`). Add 3 new resources (`dream://context`, `dream://lucid`). Tool count 17 → 22, resource count 13 → 15 |
| `src/types/index.ts` | Re-export new types |

#### Implementation Checklist

78. Add Graph RAG types to `types.ts` (GraphRAGQuery, GraphRAGContext, CognitivePreamble, EntitySimilarity)
79. Add Lucid Dreaming types to `types.ts` (LucidHypothesis, LucidSignal, LucidFindings, LucidAction, LucidResult, LucidLogFile)
80. Create `src/cognitive/graph-rag.ts` — TF-IDF index, entity resolution, subgraph extraction, token-budgeted serialization
81. Create `src/cognitive/lucid.ts` — hypothesis parsing, scoped exploration, interactive findings, action handling
82. Add `enterLucid()` / `wakeFromLucid()` to engine.ts, update CognitiveStateName
83. Register `graph_rag_retrieve`, `get_cognitive_preamble` tools
84. Register `lucid_dream`, `lucid_action`, `wake_from_lucid` tools
85. Register `dream://context`, `dream://lucid` resources
86. Re-export new types in `types/index.ts`
87. Build clean (zero errors)

---

## 4. Phase 3 — Ecosystem Intelligence (v5.3)

> **Theme:** Multi-perspective reasoning, automated testing, expandable
> perception, and a plugin ecosystem.
>
> **Effort:** Higher  
> **Impact:** Very High  
> **Dependencies:** Phase 2 (Graph RAG for context, lucid state for human collaboration)

### 4.1 Capability 6: Consensus Dreaming (Multi-Perspective Analysis)

**Module:** `src/cognitive/consensus.ts`  
**State:** AWAKE (orchestrator) → multiple parallel REM cycles  
**Writes to:** `data/consensus_log.json`

Run parallel dream analyses with different **cognitive personas**, then
synthesize their outputs. Diverse reasoning perspectives produce better
outcomes than single-viewpoint reasoning.

#### 4.1.1 Personas

| Persona | Focus | Strategy Weights | Promotion Thresholds |
|---------|-------|-----------------|---------------------|
| **The Architect** | Structural integrity, abstraction, dependency hygiene | `gap_detection: 0.4`, `missing_abstraction: 0.3`, `symmetry: 0.3` | Standard (0.75) |
| **The Attacker** | Security vulnerabilities, attack surfaces | Delegates to `nightmare_cycle` with `all_threats` | Lowered (0.60) — more suspicious |
| **The Operator** | Runtime behavior, scalability, failure modes | `tension_directed: 0.5`, leverages `runtime-senses` | Standard (0.75) |
| **The Newcomer** | Documentation gaps, accidental complexity, "why does this exist?" | `cross_domain: 0.4`, `weak_reinforcement: 0.3`, `gap_detection: 0.3` | Raised (0.85) — only obvious connections |

#### 4.1.2 Consensus Synthesis

```typescript
interface PersonaResult {
  persona: string;
  findings: DreamEdge[] | ThreatEdge[];
  tensions_created: TensionSignal[];
  duration_ms: number;
}

interface ConsensusResult {
  /** Cross-persona agreements — high confidence */
  agreements: Array<{
    topic: string;
    agreeing_personas: string[];
    combined_confidence: number;
    evidence: string[];
  }>;
  /** Cross-persona disagreements — elevated for human review */
  deliberations: Array<{
    topic: string;
    positions: Array<{ persona: string; stance: string; confidence: number }>;
    recommended_resolution: string;
  }>;
  /** Per-persona raw results */
  persona_results: PersonaResult[];
  synthesis_narrative: string;
  timestamp: string;
}
```

#### 4.1.3 MCP Tool

| Field | Value |
|-------|-------|
| **Tool name** | `consensus_dream` |
| **Parameters** | `personas` (string[], default: all four), `focus_entities` (string[], optional — scope analysis), `max_dreams_per_persona` (number, default: 15) |
| **Output** | `ConsensusResult` |

---

### 4.2 Capability 7: Dream-to-Test Pipeline

**Module:** `src/cognitive/test-synthesizer.ts`  
**State:** AWAKE  
**Writes to:** Test files via `create_file` tool (advisory — human must accept)

Extends the intervention engine to generate **runnable test stubs** that
validate remediation plans. Combines DreamGraph's understanding of *why* a
test is needed (tension + causal chain + evidence) with code-senses to
produce targeted, framework-appropriate tests.

#### 4.2.1 Architecture

```
RemediationPlan (from intervention.ts)
    │
    ▼
TestSynthesizer.generate(plan)
    │
    ├── Detect test framework from project
    │   ├── Scan package.json for jest/vitest/mocha/pytest
    │   ├── Scan existing test files for patterns
    │   └── Infer assertion style
    │
    ├── For each RemediationStep:
    │   ├── Read relevant source files (via code-senses)
    │   ├── Identify functions/exports to test
    │   ├── Generate test stub skeleton
    │   ├── Add tension-context comments (why this test exists)
    │   └── For security tensions: generate security regression tests
    │
    └── Output: TestSuite[]
```

#### 4.2.2 Data Schemas

```typescript
type TestFramework = "jest" | "vitest" | "mocha" | "pytest" | "unknown";

interface GeneratedTest {
  file_path: string;                   // Proposed test file path
  framework: TestFramework;
  test_code: string;                   // Full test file content
  tension_context: string;             // Why this test exists (from tension)
  tests_count: number;                 // Number of test cases in the file
  covers_steps: number[];              // Which remediation step numbers
}

interface TestSuite {
  plan_id: string;                     // Links to RemediationPlan
  tension_id: string;
  framework_detected: TestFramework;
  tests: GeneratedTest[];
  total_test_cases: number;
  estimated_coverage_delta: string;    // Qualitative ("+auth boundary coverage")
  generated_at: string;
}
```

#### 4.2.3 MCP Tool

| Tool | Parameters | Output |
|------|-----------|--------|
| `generate_tension_tests` | `plan_id` (string, optional — use latest if omitted), `write_files` (boolean, default false — preview only) | `TestSuite` |

---

### 4.3 Capability 8: Cross-Modal Senses Expansion

**Modules:** New files in `src/tools/`  
**State:** AWAKE  
**Writes to:** Nothing (read-only senses)

Expand DreamGraph's perception beyond code, git, database, web, and runtime
metrics. Each new sense follows the existing tool registration pattern.

#### 4.3.1 Priority Senses

| # | Sense | Module | Value |
|---|-------|--------|-------|
| 1 | **API Spec Senses** | `api-spec-senses.ts` | Parse OpenAPI / GraphQL schemas; validate contracts against code implementations; detect API drift |
| 2 | **Issue Tracker Senses** | `issue-senses.ts` | Correlate external bug reports (GitHub Issues API) with internal tensions; import issue context as evidence |
| 3 | **Infrastructure Senses** | `infra-senses.ts` | Read Terraform / Kubernetes manifests; understand deployment topology; correlate infra entities with app entities |

#### 4.3.2 API Spec Senses

```typescript
interface ApiSpecConfig {
  spec_paths: string[];               // Paths to OpenAPI/GraphQL schema files
  spec_type: "openapi" | "graphql";
}

// Tool: query_api_spec
// Parameters: spec_path (string), query_type: "endpoints" | "schemas" | "drift_check"
// Output: { endpoints: [], schemas: [], drift_warnings: [] }
```

**Drift Detection:** Compares API spec endpoints against code-senses file
listings and entity metadata. Flags endpoints that exist in spec but not in
code (or vice versa).

#### 4.3.3 Issue Tracker Senses

```typescript
interface IssueTrackerConfig {
  provider: "github" | "linear" | "jira";
  api_token: string;
  repo_or_project: string;
}

// Tool: query_issues
// Parameters: state ("open" | "closed" | "all"), labels (string[], optional), search (string, optional)
// Output: { issues: [{ id, title, state, labels, created_at, body_excerpt }] }
```

**Tension Correlation:** After fetching issues, cross-reference issue titles
and bodies against active tension descriptions. Report matches to help
validate or resolve tensions with external evidence.

#### 4.3.4 Infrastructure Senses

```typescript
interface InfraConfig {
  manifests_path: string;             // Path to terraform/ or k8s/ directory
  manifest_type: "terraform" | "kubernetes";
}

// Tool: query_infrastructure
// Parameters: query_type ("services" | "resources" | "topology")
// Output: { services: [], resources: [], topology: { nodes: [], edges: [] } }
```

---

### 4.4 Capability 9: Plugin SDK

**Module:** `src/plugins/` (new directory)  
**State:** All states (hooks fire at state transitions)  
**Writes to:** Depends on plugin

Create an extensibility layer so external contributors can add custom dream
strategies, sense tools, and normalization rules without forking.

#### 4.4.1 Plugin Interface

```typescript
interface DreamGraphPlugin {
  name: string;
  version: string;
  description: string;

  /** Custom dream strategies */
  dreamStrategies?: Array<{
    name: string;
    description: string;
    dream: (context: DreamContext) => Promise<DreamEdge[]>;
  }>;

  /** Custom normalization rules */
  normalizationRules?: Array<{
    name: string;
    description: string;
    evaluate: (edge: DreamEdge, factGraph: FactGraph) => NormalizationAdjustment;
  }>;

  /** Custom MCP tools */
  tools?: Array<{
    name: string;
    description: string;
    schema: ZodSchema;
    handler: (params: unknown) => Promise<unknown>;
  }>;

  /** Lifecycle hooks */
  hooks?: {
    onDreamCycleComplete?: (result: DreamCycleOutput) => Promise<void>;
    onTensionCreated?: (tension: TensionSignal) => Promise<void>;
    onEdgePromoted?: (edge: ValidatedEdge) => Promise<void>;
    onNightmareComplete?: (result: NightmareResult) => Promise<void>;
    onStateTransition?: (from: CognitiveStateName, to: CognitiveStateName) => Promise<void>;
  };
}

interface NormalizationAdjustment {
  plausibility_modifier: number;       // Added to plausibility (-0.5 to +0.5)
  evidence_modifier: number;           // Added to evidence (-0.5 to +0.5)
  reason: string;                      // Human-readable explanation
}
```

#### 4.4.2 Plugin Loader

```typescript
interface PluginConfig {
  /** Paths to plugin modules (ES modules) */
  plugin_paths: string[];
  /** Enable/disable individual plugins */
  enabled: Record<string, boolean>;
}
// Configured via DREAMGRAPH_PLUGINS env var (JSON)

class PluginManager {
  async loadPlugins(config: PluginConfig): Promise<void>;
  getStrategies(): Map<string, DreamStrategyFn>;
  getNormalizationRules(): NormalizationRule[];
  getTools(): PluginTool[];
  async fireHook(hook: string, ...args: unknown[]): Promise<void>;
}
```

#### 4.4.3 Safety Guarantees

| Guarantee | Enforcement |
|-----------|-------------|
| Plugins cannot bypass state machine | Dream strategy functions only called during REM; normalization rules only during NORMALIZING |
| Plugin modifications are bounded | `NormalizationAdjustment` modifiers are clamped to ±0.5 |
| Plugin errors don't crash the core | All plugin calls wrapped in try/catch; failures logged, core continues |
| Plugin tools are namespaced | Tool names prefixed with `plugin_` to avoid collision |
| Plugin loading is opt-in | Disabled by default; requires explicit config |

---

### 4.5 Phase 3 — Wiring Summary

#### Files Created

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `src/cognitive/consensus.ts` | ~400 | Multi-perspective consensus engine |
| `src/cognitive/test-synthesizer.ts` | ~450 | Test stub generation from remediation plans |
| `src/tools/api-spec-senses.ts` | ~300 | OpenAPI / GraphQL schema parsing and drift detection |
| `src/tools/issue-senses.ts` | ~250 | GitHub Issues / Linear / Jira integration |
| `src/tools/infra-senses.ts` | ~300 | Terraform / Kubernetes manifest parsing |
| `src/plugins/manager.ts` | ~300 | Plugin loader and lifecycle manager |
| `src/plugins/types.ts` | ~100 | Plugin interface definitions |
| `data/consensus_log.json` | runtime | Consensus dream session archive |

#### Files Modified

| File | Changes |
|------|---------|
| `src/cognitive/types.ts` | Add ~250 lines: `PersonaResult`, `ConsensusResult`, `GeneratedTest`, `TestSuite`, plugin types |
| `src/cognitive/register.ts` | Add 3 new tools (`consensus_dream`, `generate_tension_tests`, plugin-registered tools). Tool count 22 → 25+plugins |
| `src/tools/register.ts` | Add 3 new sense tools (`query_api_spec`, `query_issues`, `query_infrastructure`). Register plugin manager. Total tools: 25 → 28+plugins |
| `src/config/config.ts` | Add configs for API specs, issue tracker, infrastructure, plugins |
| `src/types/index.ts` | Re-export new types |

#### New Environment Variables

| Env Var | Default | Description |
|---------|---------|-------------|
| `DREAMGRAPH_API_SPEC` | `(disabled)` | JSON config for API spec senses |
| `DREAMGRAPH_ISSUES` | `(disabled)` | JSON config for issue tracker senses |
| `DREAMGRAPH_INFRA` | `(disabled)` | JSON config for infrastructure senses |
| `DREAMGRAPH_PLUGINS` | `(disabled)` | JSON config for plugin system |

#### Implementation Checklist

88. Add consensus dreaming types to `types.ts`
89. Add test synthesizer types to `types.ts`
90. Add plugin interface types to `src/plugins/types.ts`
91. Create `src/cognitive/consensus.ts` — persona definitions, parallel execution, synthesis
92. Create `src/cognitive/test-synthesizer.ts` — framework detection, test generation, tension-context comments
93. Create `src/tools/api-spec-senses.ts` — OpenAPI/GraphQL parsing, drift detection
94. Create `src/tools/issue-senses.ts` — GitHub Issues integration, tension correlation
95. Create `src/tools/infra-senses.ts` — Terraform/Kubernetes manifest parsing
96. Create `src/plugins/manager.ts` — plugin loader, hook executor, safety wrappers
97. Register `consensus_dream` tool
98. Register `generate_tension_tests` tool
99. Register new sense tools (query_api_spec, query_issues, query_infrastructure)
100. Wire plugin manager into server startup and register.ts
101. Add new configs to config.ts
102. Re-export new types in `types/index.ts`
103. Build clean (zero errors)

---

## 5. Summary: Full Capability Map

### 5.1 All Capabilities by Phase

| # | Capability | Phase | Module | New Tools | New Resources |
|---|-----------|-------|--------|-----------|---------------|
| 1 | Metacognitive Self-Tuning | v5.1 | `metacognition.ts` | `metacognitive_analysis` | `dream://metacognition` |
| 2 | Event-Driven Dreaming | v5.1 | `event-router.ts` | `dispatch_cognitive_event` | `dream://events` |
| 3 | Continuous Narrative | v5.1 | `narrator.ts` (ext) | `get_system_story` | `dream://story` |
| 4 | Graph RAG Bridge | v5.2 | `graph-rag.ts` | `graph_rag_retrieve`, `get_cognitive_preamble` | `dream://context` |
| 5 | Lucid Dreaming | v5.2 | `lucid.ts` | `lucid_dream`, `lucid_action`, `wake_from_lucid` | `dream://lucid` |
| 6 | Consensus Dreaming | v5.3 | `consensus.ts` | `consensus_dream` | — |
| 7 | Dream-to-Test Pipeline | v5.3 | `test-synthesizer.ts` | `generate_tension_tests` | — |
| 8 | Cross-Modal Senses | v5.3 | `api-spec-senses.ts`, `issue-senses.ts`, `infra-senses.ts` | `query_api_spec`, `query_issues`, `query_infrastructure` | — |
| 9 | Plugin SDK | v5.3 | `src/plugins/` | dynamic | — |

### 5.2 Cumulative Tool & Resource Count

| Version | Cognitive Tools | Sense Tools | Doc Tools | Total Tools | Resources |
|---------|----------------|-------------|-----------|-------------|-----------|
| v5.0 (current) | 14 | 12 | 8 | 34 | 10 |
| v5.1 | 17 | 12 | 8 | 37 | 13 |
| v5.2 | 22 | 12 | 8 | 42 | 15 |
| v5.3 | 25 | 15 | 8 | 48+plugins | 15 |

### 5.3 Cognitive State Machine (Final)

```
                ┌────────────────────────────────────────────────────┐
                │                                                    │
                ▼                                                    │
          ┌──────────┐                                               │
          │  AWAKE   │─────────────────┬──────────────┐              │
          └──────────┘                 │              │              │
            │        │          │      │              │              │
       enterRem() enterNight() enterLucid()           │              │
            │        │          │      │              │              │
            ▼        ▼          ▼      │              │              │
       ┌────────┐ ┌─────────┐ ┌──────┐│              │              │
       │  REM   │ │NIGHTMARE│ │LUCID ││              │              │
       └───┬────┘ └────┬────┘ └──┬───┘│              │              │
           │           │         │    │              │              │
     enterNorm()  wakeFromN()  wakeFromLucid()       │              │
           │           │         │                   │              │
           ▼           │         │                   │              │
     ┌───────────┐     │         │                   │              │
     │NORMALIZING│─────┴─────────┴───────────────────┘              │
     └───────────┘                                                  │
           │                                                        │
         wake()                                                     │
           │                                                        │
           └────────────────────────────────────────────────────────┘
```

Five cognitive states: **AWAKE**, **REM**, **NORMALIZING**, **NIGHTMARE**, **LUCID**

---

## 6. Design Principles (Additions to v5.0)

Building on the 17 principles from v5.0, this plan adds:

18. **Self-Tuning** — The system should learn *how* to think, not just *what* to think
19. **Event-Reactive** — The best time to analyze is when something changes, not on a schedule
20. **Knowledge Backbone** — Accumulated understanding should benefit all AI interactions, not just dream cycles
21. **Collaborative Cognition** — Human intuition and machine pattern-matching are stronger together than alone
22. **Multi-Perspective** — Diverse viewpoints produce better conclusions than single-viewpoint analysis
23. **From Understanding to Verification** — Tests generated from tension context are more targeted than generic coverage
24. **Extensible Perception** — New senses should be pluggable without modifying the core
25. **Ecosystem Thinking** — The system should be composable, not monolithic

---

## 7. Priority Matrix

| Capability | Effort | Impact | Differentiation | Risk | Phase |
|-----------|--------|--------|-----------------|------|-------|
| Metacognitive Self-Tuning | Low | High | Medium | Low | **v5.1** |
| Event-Driven Dreaming | Medium | High | High | Medium | **v5.1** |
| Continuous Narrative | Low | Medium | High | Low | **v5.1** |
| Graph RAG Bridge | Medium | Very High | Very High | Low | **v5.2** |
| Lucid Dreaming | Medium | High | Very High | Medium | **v5.2** |
| Consensus Dreaming | Higher | High | Very High | Medium | **v5.3** |
| Dream-to-Test Pipeline | High | Very High | High | Medium | **v5.3** |
| Cross-Modal Senses | Incremental | High | Medium | Low | **v5.3** |
| Plugin SDK | Higher | Medium | High | Medium | **v5.3** |

---

## 8. Backwards Compatibility

All changes are **strictly additive**, following the same guarantee pattern
established in v5.0 Appendix D.10:

| Change | Impact on existing code |
|--------|------------------------|
| New `"lucid"` in `CognitiveStateName` | Existing state checks use string literals; "lucid" is never matched by old code |
| New engine methods | `enterLucid()`, `wakeFromLucid()` are new; no existing signatures change |
| New modules | All new files; no existing module APIs modified |
| New tools/resources | New MCP registrations; existing tool names and schemas unchanged |
| New data files | Created only when new features are used; existing data files unmodified |
| Metacognitive auto-tuning | In-memory only; engine defaults unchanged on restart |
| Event router | Disabled by default; requires explicit env var to activate HTTP sidecar |
| Continuous narrator | Auto-narrate on by default but only appends to new file; never modifies existing data |
| Plugin system | Disabled by default; requires explicit config to load any plugins |

---

## 9. Safety Guarantees (Additions to v5.0)

| Guarantee | Enforcement |
|-----------|-------------|
| Metacognitive tuning is bounded | Hard min/max on all threshold adjustments; no threshold below 0.55 or above 0.90 |
| Metacognitive tuning is reversible | Thresholds are in-memory overrides; restart restores defaults |
| Event triggers have runaway protection | Cooldown timer (60s default) + max cycles per hour cap (10 default) |
| HTTP sidecar is opt-in | Disabled by default; requires `DREAMGRAPH_EVENTS` config |
| Webhook auth required | Bearer token verification when HTTP is enabled |
| Graph RAG is read-only | Retrieval only; never modifies any data files |
| Lucid state respects isolation | Same write restrictions as REM; only dream_graph writable |
| Lucid has session timeout | Auto-wakes after 10 minutes of inactivity |
| Human "accept" in lucid is tracked | Authority recorded as `"human+system"` — distinct from pure system validation |
| Consensus personas are sequential | No actual parallel execution; personas run in series to avoid state conflicts |
| Test generation is advisory | Generated tests are previewed by default; `write_files: true` must be explicit |
| Plugin errors isolated | All plugin calls wrapped in try/catch; failures logged, core unaffected |
| Plugin modifications bounded | Normalization adjustments clamped to ±0.5 |
| Plugin tools namespaced | All plugin tools prefixed with `plugin_` to prevent collision |

---

*This document is the plan. Implementation follows the phased checklist.*
