# Technical Design Document: DreamGraph Cognitive Dreaming System

**Version:** 3.0  
**Date:** 2026-03-21  
**Author:** Mika Jussila, Siteledger Solutions Oy
**Status:** Implemented  

> **Changelog v3.0** — Speculative memory: normalization becomes a three-outcome
> classifier (validated / latent / rejected) instead of binary pass/fail.
> 5-state lifecycle (candidate → latent → validated → rejected → expired),
> split scoring (plausibility + evidence + contradiction), activation scores,
> PromotionConfig with two thresholds, latent edges as speculative memory.
>
> **Changelog v2.0** — Safeguarding enhancements: dream decay (TTL + confidence),
> duplicate suppression (reinforcement counting), strict promotion gate
> (confidence > 0.7 AND evidence ≥ 2), unresolved tension tracking,
> dream history audit trail, `get_dream_insights` tool.  

---

## 1. Vision

> *"Dream freely. Wake critically. Remember selectively."*

The DreamGraph MCP server currently operates as a factual knowledge graph — a static map of 100 entities connected by 352 edges. This design extends it with a **cognitive architecture** inspired by biological sleep cycles: the ability to **dream** (generate speculative connections), **normalize** (critically validate those dreams), and **wake** (return to grounded truth).

This gives AI agents using the MCP not just memory, but **imagination** — bounded by discipline.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    DreamGraph MCP SERVER                         │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐ │
│  │   FACT GRAPH     │  │   COGNITIVE ENGINE                    │ │
│  │   (immutable)    │  │                                       │ │
│  │                  │  │  ┌───────┐  ┌────────────┐           │ │
│  │  features.json   │  │  │ AWAKE │──│  REM       │           │ │
│  │  workflows.json  │  │  │       │  │ (dreaming) │           │ │
│  │  data_model.json │  │  │       │  │  + decay   │           │ │
│  │  index.json      │  │  │       │  │  + dedup   │           │ │
│  │  (352 edges)     │  │  │       │  └─────┬──────┘           │ │
│  │                  │  │  │       │        │                  │ │
│  └──────────────────┘  │  │       │  ┌─────▼──────┐           │ │
│           ▲            │  │       │◄─│NORMALIZING │           │ │
│           │            │  └───────┘  │ + gate     │           │ │
│           │            │       │     └────────────┘           │ │
│           │            │       │           │                  │ │
│           │            │       │           ▼                  │ │
│           │            │  ┌──────────────────────────────┐    │ │
│           │            │  │    DREAM GRAPH                │    │ │
│           │            │  │                               │    │ │
│           │◄───────────│──│  dream_graph.json             │    │ │
│  (only validated       │  │  candidate_edges.json         │    │ │
│   edges promote;       │  │  validated_edges.json         │    │ │
│   3-outcome gate:      │  │  tension_log.json             │    │ │
│   validated/latent/    │  │  dream_history.json           │    │ │
│   rejected)            │  └──────────────────────────────┘    │ │
│                        └──────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 Two Knowledge Spaces

| Space | Files | Mutability | Trust Level |
|-------|-------|------------|-------------|
| **FACT GRAPH** | features.json, workflows.json, data_model.json, index.json | Immutable (additive only via normalization) | TRUSTED |
| **DREAM GRAPH** | dream_graph.json, candidate_edges.json, validated_edges.json, tension_log.json, dream_history.json | Freely writable during REM | UNTRUSTED until validated |

### 2.2 Three Cognitive States

| State | Purpose | May Read | May Write | May Hallucinate |
|-------|---------|----------|-----------|-----------------|
| **AWAKE** | Serve truth | FACT GRAPH + validated_edges | Nothing | NO |
| **REM** | Explore possibilities | Internal copies only | dream_graph.json | YES |
| **NORMALIZING** | Validate dreams | FACT GRAPH + dream_graph | candidate_edges.json, validated_edges.json | NO |

---

## 3. Data Schemas

### 3.0 Decay Configuration & Promotion Config

```typescript
interface DecayConfig {
  ttl: number;               // Time-to-live in dream cycles (default: 3)
  decay_rate: number;        // Confidence reduction per unfed cycle (default: 0.15)
}

const DEFAULT_DECAY: DecayConfig = { ttl: 3, decay_rate: 0.15 };

/** Two-threshold promotion configuration */
interface PromotionConfig {
  promotion_confidence: number;   // Min combined confidence to validate (0.75)
  promotion_plausibility: number; // Min plausibility to validate (0.5)
  promotion_evidence: number;     // Min evidence_score to validate (0.5)
  promotion_evidence_count: number; // Min distinct evidence signals (2)
  retention_plausibility: number; // Min plausibility to retain as latent (0.35)
  max_contradiction: number;      // Max contradiction_score before rejection (0.3)
}

const DEFAULT_PROMOTION: PromotionConfig = {
  promotion_confidence: 0.75,
  promotion_plausibility: 0.5,
  promotion_evidence: 0.5,
  promotion_evidence_count: 2,
  retention_plausibility: 0.35,
  max_contradiction: 0.3,
};
```

### 3.0.1 5-State Lifecycle

```
candidate → latent → validated → (promoted to fact-adjacent space)
    ↓          ↓
 rejected   expired (decay)
```

| Status | Meaning | Location |
|--------|---------|----------|
| `candidate` | Freshly dreamed, unevaluated | dream_graph.json |
| `latent` | Plausible but insufficient evidence — speculative memory | dream_graph.json |
| `validated` | Strong evidence, promoted | validated_edges.json |
| `rejected` | Contradicted, malformed, or noise — discarded | candidate_edges.json (log) |
| `expired` | Decayed through TTL/confidence loss | removed |

### 3.0.2 Split Scoring Functions

```typescript
/** Combined confidence: plausibility × 0.45 + evidence × 0.45 + bonus − penalty */
function computeConfidence(
  plausibility: number,
  evidence: number,
  reinforcementBonus: number,
  contradictionPenalty: number
): number;

/** Activation score: plausibility × 0.3 + tensionProximity × 0.3 + recencyBoost + momentum */
function computeActivationScore(
  plausibility: number,
  reinforcementMomentum: number,
  cyclesSinceCreation: number,
  tensionProximity: number
): number;
```

### 3.1 Dream Node (candidate entity)

```typescript
type DreamEdgeStatus = "candidate" | "latent" | "validated" | "rejected" | "expired";

interface DreamNode {
  id: string;                          // Generated ID
  type: "hypothetical_feature" | "hypothetical_workflow" | "hypothetical_entity";
  name: string;                        // Human-readable name
  description: string;                 // What this node represents
  inspiration: string[];               // Fact graph entity IDs that inspired this
  confidence: number;                  // 0.0–1.0
  origin: "rem";                       // Always "rem" — marks provenance
  created_at: string;                  // ISO 8601
  dream_cycle: number;                 // Which dream cycle created this
  interrupted?: boolean;               // True if REM was interrupted before completion
  ttl: number;                         // Remaining cycles before expiry
  decay_rate: number;                  // Confidence lost per unfed cycle
  reinforcement_count: number;         // Times re-dreamed (duplicate suppression)
  last_reinforced_cycle: number;       // Last cycle this was reinforced
  status: DreamEdgeStatus;             // Lifecycle state (starts "candidate")
  activation_score: number;            // 0.0–1.0 — higher = more likely to be revisited
}
```

### 3.2 Dream Edge (candidate relationship)

```typescript
interface DreamEdge {
  id: string;                          // Unique edge ID
  from: string;                        // Source entity ID (fact or dream)
  to: string;                          // Target entity ID (fact or dream)
  type: "feature" | "workflow" | "data_model" | "hypothetical";
  relation: string;                    // Relationship verb
  reason: string;                      // Why this connection was dreamed
  confidence: number;                  // 0.0–1.0 (combined confidence)
  origin: "rem";                       // Always "rem"
  created_at: string;                  // ISO 8601
  dream_cycle: number;                 // Which dream cycle
  strategy: DreamStrategy;             // Which strategy generated this edge
  meta?: Record<string, unknown>;      // Optional metadata
  interrupted?: boolean;               // True if REM was interrupted
  ttl: number;                         // Remaining cycles before expiry
  decay_rate: number;                  // Confidence lost per unfed cycle
  reinforcement_count: number;         // Times re-dreamed (duplicate suppression)
  last_reinforced_cycle: number;       // Last cycle this was reinforced
  status: DreamEdgeStatus;             // Lifecycle state (starts "candidate")
  activation_score: number;            // 0.0–1.0 — higher = more likely to be revisited
  plausibility: number;                // Structural plausibility (0.0–1.0)
  evidence_score: number;              // Hard evidence strength (0.0–1.0)
  contradiction_score: number;         // Contradiction weight (0.0–1.0)
}
```

### 3.3 Validation Result

```typescript
type NormalizationOutcome = "validated" | "latent" | "rejected";

type NormalizationReasonCode =
  | "strong_evidence"       // Validated — converging signals
  | "insufficient_evidence" // Latent — plausible but not enough proof
  | "contradicted"          // Rejected — contradicts known facts
  | "invalid_endpoints"     // Rejected — endpoints don't exist
  | "low_signal";           // Rejected — below retention threshold

interface ValidationResult {
  dream_id: string;                    // ID of the dream node/edge being validated
  dream_type: "node" | "edge";        // What was validated
  status: NormalizationOutcome;        // Three-outcome: validated / latent / rejected
  confidence: number;                  // Combined confidence score
  plausibility: number;                // Structural plausibility (0.0–1.0)
  evidence_score: number;              // Hard evidence strength (0.0–1.0)
  contradiction_score: number;         // Contradiction weight (0.0–1.0)
  reason_code: NormalizationReasonCode; // Machine-readable reason
  evidence: {
    shared_entities: string[];         // Entities that ground this dream
    shared_workflows: string[];        // Workflows supporting this
    domain_overlap: string[];          // Domain tags that match
    keyword_overlap: string[];         // Keywords that match
    source_repo_match: boolean;        // Same repo origin
    contradictions: string[];          // Fact graph conflicts found
  };
  evidence_count: number;              // Count of distinct supporting evidence signals (0–5)
  reason: string;                      // Human-readable explanation
  validated_at: string;                // ISO 8601
  normalization_cycle: number;         // Which normalization pass
}
```

### 3.4 Validated Edge (promoted dream)

**Promotion Gate:** Combined confidence ≥ 0.75 AND evidence_count ≥ 2 AND plausibility ≥ 0.5 AND evidence ≥ 0.5

```typescript
interface ValidatedEdge {
  id: string;                          // Same ID from the dream
  from: string;                        // Source entity (must exist in fact graph)
  to: string;                          // Target entity (must exist in fact graph)
  type: "feature" | "workflow" | "data_model";
  relation: string;                    // Relationship type
  description: string;                 // Why this edge exists
  confidence: number;                  // Post-validation combined confidence
  plausibility: number;                // Structural plausibility score
  evidence_score: number;              // Hard evidence strength
  origin: "rem";                       // Provenance: came from dreaming
  status: "validated";                 // Always "validated" for promoted edges
  evidence_summary: string;            // Brief validation evidence
  evidence_count: number;              // Distinct evidence signals that supported promotion
  reinforcement_count: number;         // How many times dream was reinforced before promotion
  dream_cycle: number;                 // Original cycle
  normalization_cycle: number;         // When validated
  validated_at: string;                // ISO 8601
}
```

### 3.5 Tension Signal (unresolved questions)

```typescript
interface TensionSignal {
  id: string;
  type: "missing_link" | "weak_connection" | "hard_query" | "ungrounded_dream";
  entities: string[];                  // Entity IDs involved
  description: string;                 // Human-readable description
  occurrences: number;                 // How many times observed
  urgency: number;                     // 0.0–1.0 — higher = more cycles should focus here
  first_seen: string;                  // ISO 8601
  last_seen: string;                   // ISO 8601
  attempted: boolean;                  // Has REM tried to resolve this?
  resolved: boolean;                   // Was it resolved?
}

interface TensionFile {
  metadata: {
    description: string;
    schema_version: string;
    total_signals: number;
    last_updated: string | null;
  };
  signals: TensionSignal[];
}
```

### 3.6 Dream History Entry (audit trail)

```typescript
interface DreamHistoryEntry {
  session_id: string;
  cycle_number: number;
  timestamp: string;
  strategy: DreamStrategy;
  duration_ms: number;
  generated_edges: number;
  generated_nodes: number;
  duplicates_merged: number;           // Edges that were duplicate-suppressed
  decayed_edges: number;               // Edges removed by decay this cycle
  decayed_nodes: number;               // Nodes removed by decay this cycle
  normalization?: {
    validated: number;
    latent: number;
    rejected: number;
    promoted: number;
    blocked_by_gate: number;           // Edges blocked by promotion gate
  };
  tension_signals_created: number;
  tension_signals_resolved: number;
}

interface DreamHistoryFile {
  metadata: {
    description: string;
    schema_version: string;
    total_sessions: number;
    created_at: string;
  };
  sessions: DreamHistoryEntry[];
}
```

### 3.7 Cognitive State (enhanced)

```typescript
type CognitiveStateName = "awake" | "rem" | "normalizing";

interface DreamGraphStats {
  total_nodes: number;
  total_edges: number;
  latent_edges: number;                // Edges in speculative memory
  latent_nodes: number;                // Nodes in speculative memory
  expiring_next_cycle: number;         // Edges with ttl === 1
  avg_confidence: number;              // Average confidence across all dream edges
  avg_reinforcement: number;           // Average reinforcement count
  avg_activation: number;              // Average activation score (latent items)
}

interface TensionStats {
  total: number;
  unresolved: number;
  top_urgency: TensionSignal | null;
}

interface CognitiveState {
  current_state: CognitiveStateName;
  last_state_change: string;           // ISO 8601
  total_dream_cycles: number;
  total_normalization_cycles: number;
  dream_graph_stats: DreamGraphStats;
  validated_stats: {
    validated: number;
    latent: number;
    rejected: number;
  };
  tension_stats: TensionStats;
  last_dream_cycle: string | null;     // ISO 8601
  last_normalization: string | null;   // ISO 8601
  promotion_config: PromotionConfig;   // Two-threshold promotion configuration
  decay_config: DecayConfig;
}
```

### 3.8 Dream Insights (introspection output)

```typescript
interface DreamCluster {
  center: string;                      // Central entity or domain
  members: string[];                   // Entity IDs in the cluster
  avg_confidence: number;
  total_reinforcement: number;
}

interface DreamInsights {
  recent_edges: DreamEdge[];           // Edges from most recent cycle
  strongest_hypotheses: Array<{        // Highest confidence × reinforcement
    edge: DreamEdge;
    score: number;
    reinforcement_count: number;
  }>;
  clusters: DreamCluster[];            // Clusters of related dreams
  active_tensions: TensionSignal[];    // Unresolved tensions directing next REM
  expiring_soon: DreamEdge[];          // Edges about to expire (ttl === 1)
  summary: {
    total_dreams: number;
    total_validated: number;
    total_latent: number;
    total_tensions: number;
    dream_health: "healthy" | "stale" | "overloaded" | "empty";
    recommendation: string;
  };
}
```

---

## 4. File Structures

### 4.1 `data/dream_graph.json`

```json
{
  "metadata": {
    "description": "Dream Graph — REM-generated speculative nodes and edges. UNTRUSTED.",
    "last_dream_cycle": null,
    "total_cycles": 0
  },
  "nodes": [],
  "edges": []
}
```

### 4.2 `data/candidate_edges.json`

```json
{
  "metadata": {
    "description": "Normalization results — validation judgments on dream artifacts.",
    "last_normalization": null,
    "total_cycles": 0
  },
  "results": []
}
```

### 4.3 `data/validated_edges.json`

```json
{
  "metadata": {
    "description": "Validated edges — dream-originated connections that passed normalization. Trusted, additive to Fact Graph.",
    "last_validation": null,
    "total_validated": 0
  },
  "edges": []
}
```

### 4.4 `data/tension_log.json`

```json
{
  "metadata": {
    "description": "Unresolved tension signals — what the system struggles with. Drives goal-directed dreaming.",
    "schema_version": "1.0.0",
    "total_signals": 0,
    "last_updated": null
  },
  "signals": []
}
```

### 4.5 `data/dream_history.json`

```json
{
  "metadata": {
    "description": "Dream history — audit trail of every dream cycle with decay, dedup, and normalization statistics.",
    "schema_version": "1.0.0",
    "total_sessions": 0,
    "created_at": "2026-03-21T00:00:00.000Z"
  },
  "sessions": []
}
```

---

## 5. Cognitive Engine Design

### 5.1 Module: `src/cognitive/engine.ts`

The cognitive engine is the central state machine managing transitions between AWAKE → REM → NORMALIZING → AWAKE.

**Responsibilities:**
- Track current cognitive state
- Enforce state transition rules
- Prevent illegal operations (e.g., writing fact graph during REM)
- Provide state introspection
- **Apply decay** to dream edges/nodes each cycle (TTL + confidence)
- **Deduplicate** new dreams against existing graph (reinforcement counting)
- **Track unresolved tensions** (record, resolve, query)
- **Record dream history** (audit trail of every cycle)

**State Transitions:**

```
         ┌──────────┐
    ┌────│  AWAKE   │◄────────────────┐
    │    └──────────┘                 │
    │         │                       │
    │    enter_rem()                  │
    │         │                  wake()
    │         ▼                       │
    │    ┌──────────┐          ┌──────┴─────┐
    │    │   REM    │─────────▶│NORMALIZING │
    │    └──────────┘          └────────────┘
    │    exit_rem()          complete_normalization()
    │         │                       │
    │         ▼                       │
    │    (interrupt)                   │
    └─────────────────────────────────┘
```

**Interruption Protocol:**
1. If external input arrives during REM → IMMEDIATE STOP
2. Quarantine in-progress dream data (mark as `interrupted: true`)
3. Fast-normalize: discard unfinished items
4. Reset to AWAKE

**Dream Decay (`applyDecay`):**
- Called at the start of each REM cycle, before new dreams are generated
- For each edge/node: `ttl -= 1`, `confidence -= decay_rate`
- Removed if `ttl <= 0` or `confidence <= 0`
- Recently reinforced items (within last cycle) are skipped
- Returns `{ decayedEdges, decayedNodes }`

**Duplicate Suppression (`deduplicateAndAppendEdges` / `deduplicateAndAppendNodes`):**
- New dreams are compared against existing graph items using a normalized key
- Edge key = `from|to|relation` (sorted to ignore direction)
- Node key = lowercase name
- If a duplicate is found: merge → increment `reinforcement_count`, reset `ttl`, update `last_reinforced_cycle`, keep higher confidence
- If novel: append as new item
- Returns `{ appended, merged }`

**Tension Tracking:**
- `recordTension(signal)` — add or increment a tension signal
- `resolveTension(id)` — mark as resolved
- `getUnresolvedTensions()` — return all unresolved signals sorted by urgency
- Tensions persist in `data/tension_log.json`

**Dream History:**
- `appendHistoryEntry(entry)` — append a `DreamHistoryEntry` to `data/dream_history.json`
- Every completed dream cycle records: strategy, durations, counts, decay/dedup stats, normalization results

### 5.2 Module: `src/cognitive/dreamer.ts`

The dreamer generates speculative nodes and edges by analyzing the fact graph for gaps, weak connections, and latent patterns.

**Dream Strategies:**
1. **Gap Detection** — Find entity pairs with no direct edges but shared domains/keywords
2. **Weak Link Reinforcement** — Find edges with `strength: "weak"` and propose why they might be stronger
3. **Cross-Domain Bridging** — Connect entities from different domains that share keywords
4. **Missing Abstraction** — Propose hypothetical features that would unify existing workflows
5. **Symmetry Completion** — If A→B exists but B→A doesn't, propose the reverse
6. **Tension-Directed** — Use unresolved tension signals to focus dreaming on known gaps and weaknesses

**`DreamStrategy` type:** `"gap_detection" | "weak_reinforcement" | "cross_domain" | "missing_abstraction" | "symmetry_completion" | "tension_directed" | "all"`

**Decay Fields:** Every generated node and edge carries `ttl`, `decay_rate`, `reinforcement_count`, and `last_reinforced_cycle` from creation.

**Duplicate Suppression:** The dreamer uses `engine.deduplicateAndAppendEdges()` and `engine.deduplicateAndAppendNodes()` instead of raw appends. Duplicate dreams reinforce existing items rather than creating noise.

**Output:** `DreamResult { nodes: DreamNode[], edges: DreamEdge[], duplicates_merged: number }`

### 5.3 Module: `src/cognitive/normalizer.ts`

The normalizer is a **three-outcome classifier** that validates dream artifacts against the fact graph. It does NOT merely accept or reject — it classifies edges into three buckets implementing **speculative memory**.

> *"Do not make normalization only a kill switch. Make it a classifier."*

**Three Outcomes:**

| Outcome | Meaning | Destination |
|---------|---------|-------------|
| **validated** | Strong evidence → promote to fact-adjacent space | `validated_edges.json` |
| **latent** | Plausible but insufficient evidence → keep as speculative memory | Remains in `dream_graph.json` with `status: "latent"` |
| **rejected** | Contradicted, malformed, or noise → discard | Logged in `candidate_edges.json` |

**Key Principle:** Keep edges that fail for lack of evidence, not for bad evidence. A relation can fail today because the supporting node doesn't exist yet, the related workflow hasn't been extracted yet, or another connecting edge is missing. Deletion destroys future potential.

**Split Scoring Pipeline:**
1. **Entity Grounding** — Do `from` and `to` entities exist in the fact graph?
2. **Domain Coherence** — Do the entities share domains?
3. **Keyword Overlap** — Do entity keywords intersect?
4. **Workflow Consistency** — Does the proposed edge contradict any workflow step ordering?
5. **Repo Coherence** — Are the entities from the same or related repositories?
6. **Duplicate Detection** — Does this edge already exist in the fact graph?

Each check produces three sub-scores:
- **Plausibility** — structural plausibility (domain, keywords, repo match)
- **Evidence** — hard evidence (entity grounding, workflow support)
- **Contradiction** — contradicting facts (duplicate, workflow conflict)

**Combined Confidence:**
```
confidence = plausibility × 0.45 + evidence × 0.45 + reinforcementBonus × 0.10 − contradictionPenalty
```

**Classification Logic (in `calculateSplitScore`):**
1. If `contradiction >= max_contradiction (0.3)` → **rejected** (reason: `contradicted`)
2. If `confidence >= promotion_confidence (0.75)` AND `plausibility >= promotion_plausibility (0.5)` AND `evidence >= promotion_evidence (0.5)` → **validated** (reason: `strong_evidence`)
3. If `plausibility >= retention_plausibility (0.35)` → **latent** (reason: `insufficient_evidence`)
4. Else → **rejected** (reason: `low_signal`)

**Promotion Gate:**
- An edge is promoted to `validated_edges.json` ONLY if:
  - `status === "validated"` (from classifier)
  - `evidence_count >= promotion_evidence_count (2)` (from PromotionConfig)
- Validated edges that fail the evidence count gate are **blocked by gate** and downgraded to latent

**Latent Edge Handling:**
- When an edge is classified as latent, the normalizer **writes latent status back to the dream graph**
- Latent edges retain their plausibility, evidence, and contradiction scores
- Latent edges remain visible in the dream graph but **must never leak into default MCP queries**
- Latent nodes receive an initial activation score of `plausibility × 0.5`

**Output:** Validation results to `candidate_edges.json`, promoted edges to `validated_edges.json`, latent edge status written back to `dream_graph.json`
**Returns:** `NormalizationResult { ...counts, blockedByGate, promotedEdges }`

---

## 6. MCP Interface

### 6.1 New Resources

| URI | Name | Description |
|-----|------|-------------|
| `dream://graph` | Dream Graph | Current dream graph (nodes + edges from REM) |
| `dream://candidates` | Candidate Edges | Normalization results and judgments |
| `dream://validated` | Validated Edges | Promoted edges that passed normalization |
| `dream://status` | Cognitive Status | Current cognitive state and statistics |
| `dream://tensions` | Tension Signals | Unresolved tension signals driving goal-directed dreaming |
| `dream://history` | Dream History | Audit trail of every dream cycle |

### 6.2 New Tools

#### `dream_cycle`

Triggers a full dream→normalize→wake cycle (with decay, dedup, tension tracking, and history recording).

```typescript
Input: {
  strategy?: "gap_detection" | "weak_reinforcement" | "cross_domain" |
             "missing_abstraction" | "symmetry_completion" |
             "tension_directed" | "all"
  max_dreams?: number      // Cap on generated items (default: 20)
  auto_normalize?: boolean // Run normalization immediately (default: true)
}

Output: {
  cycle_number: number
  state_transitions: string[]
  dreams_generated: { nodes: number, edges: number }
  duplicates_merged: number
  decayed: { nodes: number, edges: number }
  normalization?: {
    validated: number
    latent: number
    rejected: number
    blocked_by_gate: number
  }
  promoted_edges: number
  tensions_created: number
  duration_ms: number
}
```

#### `normalize_dreams`

Manually runs normalization (three-outcome classifier) on existing dream graph contents.

```typescript
Input: {
  threshold?: number       // Minimum confidence to validate (default: 0.75)
  strict?: boolean         // Reject latent items too (default: false)
}

Output: {
  cycle_number: number
  processed: number
  validated: number
  latent: number
  rejected: number
  blocked_by_gate: number
  promoted_edges: ValidatedEdge[]
}
```

#### `cognitive_status`

Returns current cognitive state and statistics (enhanced with decay, tensions, promotion gate).

```typescript
Input: {}   // No input required

Output: CognitiveState   // See §3.7 for full shape
```

#### `query_dreams`

Query the dream graph — search dream nodes and edges.

```typescript
Input: {
  type?: "node" | "edge" | "all"
  domain?: string
  min_confidence?: number
  status?: "candidate" | "latent" | "validated" | "rejected" | "expired" | "raw"
}

Output: {
  nodes: DreamNode[]
  edges: DreamEdge[]
  validated: ValidatedEdge[]
}
```

#### `clear_dreams`

Reset the dream graph (safety valve). Supports clearing tensions and history too.

```typescript
Input: {
  target: "dream_graph" | "candidates" | "validated" | "tensions" | "history" | "all"
  confirm: boolean   // Must be true
}

Output: {
  cleared: string[]
  timestamp: string
}
```

#### `get_dream_insights`

Introspection tool — returns strongest hypotheses, dream clusters, active tensions, expiring edges, and overall dream health.

```typescript
Input: {
  top_n?: number   // Number of top hypotheses to return (default: 5)
}

Output: DreamInsights   // See §3.8 for full shape
```

---

## 7. File Tree (New Files)

```
src/
  cognitive/
    engine.ts          — State machine, decay, dedup, tensions, history
    dreamer.ts         — REM dream generation (6 strategies)
    normalizer.ts      — Validation pipeline, scoring, strict promotion gate
    types.ts           — All cognitive type definitions
    register.ts        — Register 6 resources + 6 tools on McpServer
data/
  dream_graph.json     — REM output (untrusted)
  candidate_edges.json — Normalization judgments
  validated_edges.json — Promoted edges (trusted, additive)
  tension_log.json     — Unresolved tension signals
  dream_history.json   — Audit trail of every dream cycle
```

---

## 8. Safety Guarantees

| Guarantee | Enforcement |
|-----------|-------------|
| No REM data reaches users directly | AWAKE state tools return only FACT GRAPH + validated_edges |
| No REM modification of production data | Engine enforces write-lock on fact graph during REM |
| All changes are additive | Normalization ONLY appends to validated_edges, never modifies fact graph files |
| FACT GRAPH is immutable | Only the enrichment script (offline) can modify fact graph files |
| Interrupted dreams are quarantined | Engine marks in-progress items as `interrupted` and discards |
| Origin provenance always preserved | Every dream artifact carries `origin: "rem"` permanently |
| Confidence is always explicit | No edge promoted without a numeric confidence score |
| Strict promotion gate | Edge must pass three-outcome classifier as "validated" AND have `evidence_count >= 2` |
| Latent edges are speculative memory | Latent edges remain in dream graph but NEVER leak into default MCP responses |
| Dreams decay naturally | Unreinforced edges lose confidence and expire after TTL cycles |
| Duplicate suppression prevents noise | Repeated dreams reinforce existing items instead of creating duplicates |
| Tensions drive goal-directed dreaming | Unresolved questions are recorded and prioritized for future REM cycles |
| Full audit trail | Every dream cycle is recorded in `dream_history.json` with complete statistics |

---

## 9. Design Principles

1. **Isolation** — Dream and fact spaces are physically separate files
2. **Provenance** — Every dream artifact is permanently marked with its origin
3. **Discipline** — State machine enforces what operations are legal in each state
4. **Additive Only** — Dreams can only add, never modify or delete production data
5. **Transparency** — All cognitive state is visible via resources and tools
6. **Determinism** — AWAKE state remains strictly deterministic and grounded
7. **Graceful Degradation** — If cognitive system fails, the factual MCP continues unaffected
8. **Natural Decay** — Ideas fade unless reinforced; prevents unbounded dream accumulation
9. **Evidence-Based Promotion** — Dreams become beliefs only through convergent evidence (≥ 2 signals)
10. **Goal-Directed Dreaming** — Unresolved tensions focus REM on what the system actually needs
11. **Speculative Memory** — Failed-for-lack-of-evidence dreams survive as latent hypotheses, not deleted
12. **Three-Outcome Classification** — Normalization is a classifier (validated/latent/rejected), not a kill switch

---

## 10. Implementation Order

1. ~~Create `src/cognitive/types.ts` — All type definitions~~ 
2. ~~Create data files — `dream_graph.json`, `candidate_edges.json`, `validated_edges.json`~~ 
3. ~~Create `src/cognitive/engine.ts` — State machine~~ 
4. ~~Create `src/cognitive/dreamer.ts` — Dream generation (5 strategies)~~ 
5. ~~Create `src/cognitive/normalizer.ts` — Validation + promotion~~ 
6. ~~Create `src/cognitive/register.ts` — Resource + tool registration~~ 
7. ~~Wire into `src/tools/register.ts` and `src/resources/register.ts`~~ 
8. ~~Update `src/server/server.ts` to initialize cognitive engine~~ 
9. ~~Update `data/capabilities.json` and `data/index.json`~~ 
10. ~~Build and validate~~ 
11. ~~Add decay fields to DreamNode/DreamEdge, implement `applyDecay()` in engine~~ 
12. ~~Add duplicate suppression (`deduplicateAndAppendEdges/Nodes`)~~ 
13. ~~Implement strict promotion gate (confidence > 0.7 AND evidence_count >= 2)~~ 
14. ~~Add tension tracking (`tension_log.json`, `recordTension()`, `resolveTension()`)~~ 
15. ~~Add dream history (`dream_history.json`, `appendHistoryEntry()`)~~ 
16. ~~Add tension-directed strategy (#6) to dreamer~~ 
17. ~~Add `dream://tensions` and `dream://history` resources~~ 
18. ~~Add `get_dream_insights` tool~~ 
19. ~~Update TDD to reflect all safeguarding enhancements~~ 
20. ~~Add 5-state lifecycle (candidate/latent/validated/rejected/expired) to types~~ 
21. ~~Implement split scoring (plausibility/evidence/contradiction) in normalizer~~ 
22. ~~Transform normalizer into three-outcome classifier (validated/latent/rejected)~~ 
23. ~~Add PromotionConfig with two thresholds; replace promotion_gate~~ 
24. ~~Add activation_score and status fields to DreamNode/DreamEdge~~ 
25. ~~Update engine getStatus() for latent stats and promotion_config~~ 
26. ~~Update register.ts tools for new outcome names and status enum~~ 
27. ~~Update TDD to reflect speculative memory architecture~~ 

---

## Appendix B: Agent-Requested Senses (v3.1)

**Date:** 2026-03-21  
**Trigger:** The cognitive agent analysed its own tension log and identified
three observability gaps that prevent it from resolving speculative edges.
This appendix captures the request, the design, and the implementation plan.

### B.1 Agent's Diagnosis

| # | Requested Sense | Why | Priority |
|---|----------------|-----|----------|
| 1 | **Git history** (`git log --follow`, `git blame`) | "I see *what* is in the code, not *why*. Blame would tell me who made `STATUS_MAP` 4 entries — was it intentional or a forgotten TODO? Many tensions would resolve by reading commit messages." | HIGH |
| 2 | **Live DB schema query** (PostgreSQL `information_schema`) | "I trust `schema.sql` and migration files, but I don't know which migrations are actually applied. The `accounting_exports.delivery_status` CHECK constraint tension might already be fixed in prod — or not. A single `information_schema` query would close it." | HIGH |
| 3 | **Vercel / Edge runtime logs** | "Rate limiter tension is theoretical. Prod logs would show if the same API key gets hit in parallel from different instances. Without logs it stays speculation with high urgency." | MEDIUM (deferred) |

### B.2 Design: `git-senses` Tools

Two READ-ONLY tools that shell out to `git` in the configured repo roots.

#### B.2.1 `git_log`

| Field | Value |
|-------|-------|
| **Tool name** | `git_log` |
| **Description** | Show commit history for a file or directory. Returns structured commit objects. |
| **Parameters** | `repo` (required), `path` (optional, file/dir relative to repo root), `maxCount` (optional, default 20), `follow` (optional bool, default true — tracks renames) |
| **Output** | `{ commits: [{ hash, author, date, message }] }` |
| **Security** | Path resolved against `config.repos` roots only. No write flags. `--no-pager` enforced. |

#### B.2.2 `git_blame`

| Field | Value |
|-------|-------|
| **Tool name** | `git_blame` |
| **Description** | Show per-line authorship for a file. Returns structured blame entries. |
| **Parameters** | `repo` (required), `filePath` (required), `startLine` / `endLine` (optional range) |
| **Output** | `{ lines: [{ hash, author, date, lineNumber, content }] }` |
| **Security** | Same path security as `git_log`. Runs `git blame --porcelain`. |

### B.3 Design: `db-senses` Tool

One READ-ONLY tool that connects to the PostgreSQL database (via `pg` driver)
and runs a curated set of `information_schema` queries.

#### B.3.1 `query_db_schema`

| Field | Value |
|-------|-------|
| **Tool name** | `query_db_schema` |
| **Description** | Query the live PostgreSQL database schema (information_schema only). Returns table structure, constraints, or column details for a given table. |
| **Parameters** | `query_type` (enum: `"columns"`, `"constraints"`, `"indexes"`, `"check_constraints"`, `"foreign_keys"`, `"rls_policies"`), `table_name` (required), `schema` (optional, default `"public"`) |
| **Output** | `{ table: string, schema: string, query_type: string, rows: object[] }` |
| **Security** | **READ-ONLY by design**: only `SELECT` from `information_schema.*` and `pg_catalog` views. Connection string from `DATABASE_URL` env var. Connection pooling with `pg.Pool` (max 2 connections). Statement timeout 5 s. |

#### B.3.2 Curated Queries

The tool does NOT accept raw SQL. It maps `query_type` to a pre-written query:

| `query_type` | Query target | Key columns returned |
|-------------|-------------|---------------------|
| `columns` | `information_schema.columns` | column_name, data_type, is_nullable, column_default |
| `constraints` | `information_schema.table_constraints` | constraint_name, constraint_type |
| `indexes` | `pg_catalog.pg_indexes` | indexname, indexdef |
| `check_constraints` | `information_schema.check_constraints` JOIN `table_constraints` | constraint_name, check_clause |
| `foreign_keys` | `information_schema.key_column_usage` JOIN `constraint_column_usage` | constraint_name, column_name, foreign_table, foreign_column |
| `rls_policies` | `pg_catalog.pg_policies` | policyname, cmd, qual, with_check |

#### B.3.3 Configuration

```typescript
// config.ts addition
database: {
  connectionString: process.env.DATABASE_URL ?? "",
  maxConnections: 2,
  statementTimeoutMs: 5_000,
},
```

The `DATABASE_URL` env var must contain the full Postgres connection string
(e.g. `postgresql://postgres.xxx:password@aws-0-eu-central-1:5432/dbname`).
If not set, the tool returns a clear error message.

### B.4 Design: Vercel Logs (Deferred)

Vercel's REST API (`/v1/projects/{id}/logs`) requires a bearer token and has
rate limits. This sense is **deferred** — to be implemented when the agent has
exhausted what it can learn from git history and live schema alone.

### B.5 Implementation Checklist

28. ~~Create `src/tools/git-senses.ts` with `git_log` and `git_blame`~~ 
29. ~~Add `PostgreSQL` config to `src/config/config.ts`~~ 
30. ~~Install `pg` + `@types/pg` dependencies~~ 
31. ~~Create `src/tools/db-senses.ts` with `query_db_schema`~~ 
32. ~~Register new tools in `src/tools/register.ts`~~ 
33. ~~Build and validate~~ 

---

*This document is the blueprint. The implementation matches it fully (v3.1.0).*

---

## Appendix C: Tension System Overhaul (v4.0)

**Date:** 2025-07-17  
**Trigger:** The cognitive agent's tension log grew to 2033 unresolved tensions.
Tensions never expired, never decayed, had no domain grouping, and no cap on
active signals. The system's own self-diagnosis identified "trusted closure" as
a missing primitive — external human validation must be able to enter the graph.

### C.1 Problem Statement

| # | Problem | Impact |
|---|---------|--------|
| 1 | **No expiry/decay** — tensions accumulate indefinitely | 2033 unresolved entries; dream cycles waste budget on stale noise |
| 2 | **Binary resolved flag** — `resolved: true` with no authority tracking | No distinction between human confirmation and auto-resolve; no audit trail |
| 3 | **No domain grouping** — all tensions in a flat list | Cannot prioritize by business area; no domain-level health dashboard |
| 4 | **No active cap** — every tension competes equally | Dreaming strategy #6 attempts to address all tensions, diluting focus |
| 5 | **Deletion on resolve** — resolved tensions vanish | No institutional memory; same false positives can recur |

### C.2 Design: Tension Domains

11 domain categories, inferred automatically by keyword heuristic on entity IDs
and descriptions:

| Domain | Keywords matched |
|--------|-----------------|
| `security` | security, auth, permission, rbac, role, csrf, xss |
| `invoicing` | invoice, billing, payment, credit, einvoice |
| `sync` | sync, replication, queue, cron, job |
| `integration` | integration, api, webhook, external, third.party |
| `data_model` | schema, model, entity, relation, migration, column |
| `auth` | login, session, token, oauth, jwt, password |
| `payroll` | payroll, salary, wage, compensation, employee |
| `reporting` | report, dashboard, analytics, chart, metric |
| `api` | endpoint, route, handler, middleware, rest, graphql |
| `mobile` | mobile, app, ios, android, react.native |
| `general` | (fallback when no keywords match) |

**Implementation:** `CognitiveEngine.inferTensionDomain()` — private method,
keyword scan on `tension.entities` joined with `tension.description`.

### C.3 Design: Resolution with Authority

Resolved tensions are **archived, not deleted**. Each resolution records:

```typescript
interface ResolvedTension {
  tension_id: string;
  resolved_at: string;           // ISO 8601
  resolved_by: "human" | "system";
  resolution_type: "confirmed_fixed" | "false_positive" | "wont_fix";
  evidence?: string;             // git blame output, DB query result, etc.
  recheck_ttl?: number;          // optional re-check window in cycles
  original: TensionSignal;       // full snapshot of the original tension
}
```

**Authority types:**
- `human` — External validation from user, git evidence, or DB schema query
- `system` — Auto-resolved by the cognitive engine (e.g., promoted edge addresses it)

**Resolution types:**
- `confirmed_fixed` — Verified the underlying issue is resolved
- `false_positive` — Not a real problem (e.g., intentional design choice)
- `wont_fix` — Acknowledged but intentionally left as-is

### C.4 Design: Tension Decay & TTL

Every dream cycle, `applyTensionDecay()` runs (Step 1b, after edge decay):

| Mechanism | Default | Effect |
|-----------|---------|--------|
| **Urgency decay** | -0.02/cycle | Urgency decreases each cycle; faded tensions auto-expire |
| **TTL** | 30 cycles | Countdown per cycle; at 0, tension expires |
| **Min urgency** | 0.05 | Below this, tension is auto-resolved as `false_positive` |
| **Re-observation** | — | If same tension is re-recorded, TTL resets to default |

Auto-expired tensions are moved to `resolved_tensions` with
`resolution_type: "false_positive"` and `resolved_by: "system"`.

### C.5 Design: Active Tension Cap

`getUnresolvedTensions()` returns at most **50** active tensions, sorted by
urgency (highest first). This ensures dreaming strategy #6 focuses on the
most critical signals rather than trying to address all 2000+.

**Configuration:**

```typescript
const DEFAULT_TENSION_CONFIG: TensionConfig = {
  max_active_tensions: 50,
  default_tension_ttl: 30,
  tension_urgency_decay: 0.02,
  min_urgency_threshold: 0.05,
};
```

### C.6 Design: `resolve_tension` Tool

New MCP tool for human/system closure of tensions.

| Field | Value |
|-------|-------|
| **Tool name** | `resolve_tension` |
| **Description** | Resolve a tension signal with explicit authority and reason. Supports `confirmed_fixed`, `false_positive`, `wont_fix`. |
| **Parameters** | `tension_id` (string, required), `resolved_by` (enum: human/system), `resolution_type` (enum: confirmed_fixed/false_positive/wont_fix), `evidence` (string, optional), `recheck_ttl` (number, optional) |
| **Output** | `{ resolved: true, tension_id, resolution_type }` |

### C.7 Schema Changes

**Tension file schema bumped to 2.0.0:**

```typescript
// TensionSignal — added fields:
domain: TensionDomain;  // inferred automatically
ttl: number;            // countdown in cycles

// TensionFile — added fields:
metadata.total_resolved: number;
resolved_tensions: ResolvedTension[];
```

**Dream history — added fields per cycle:**

```typescript
tensions_expired: number;   // auto-expired by decay/TTL
tensions_decayed: number;   // had urgency/TTL reduced this cycle
```

### C.8 Files Modified

| File | Changes |
|------|---------|
| `src/cognitive/types.ts` | Added `TensionDomain`, `TensionResolutionType`, `TensionResolutionAuthority`, `ResolvedTension`, `TensionConfig`, `DEFAULT_TENSION_CONFIG`. Updated `TensionSignal`, `TensionFile`, `DreamHistoryEntry`, `DreamCycleOutput`. |
| `src/cognitive/engine.ts` | Rewrote `recordTension()` (domain inference, TTL), `resolveTension()` (authority + archive), `getUnresolvedTensions()` (cap). Added `applyTensionDecay()`, `processRecheckWindows()`, `getResolvedTensions()`, `getTensionsByDomain()`, `inferTensionDomain()`. |
| `src/cognitive/register.ts` | Added `resolve_tension` tool. Updated auto-resolve calls to new signature. Added `applyTensionDecay()` to dream cycle Step 1b. Added decay stats to cycle output. Tool count 6 → 7. |
| `src/types/index.ts` | Re-exported new tension types. |

### C.9 Implementation Checklist

34. ~~Add `TensionDomain`, `ResolvedTension`, `TensionConfig` types~~ 
35. ~~Implement decay + TTL + cap in `CognitiveEngine`~~ 
36. ~~Rewrite `resolveTension()` with authority tracking~~ 
37. ~~Add `inferTensionDomain()` heuristic~~ 
38. ~~Add `resolve_tension` MCP tool~~ 
39. ~~Update auto-resolve in `dream_cycle` tool~~ 
40. ~~Add `applyTensionDecay()` to dream cycle~~ 
41. ~~Add decay stats to `DreamHistoryEntry` / `DreamCycleOutput`~~ 
42. ~~Build clean~~ 

### C.10 Migration Notes

Existing tensions in `tension_log.json` lack `domain` and `ttl` fields.
The engine handles this gracefully:
- `recordTension()` infers `domain` via `inferTensionDomain()` on first re-observation
- Missing `ttl` defaults to `DEFAULT_TENSION_CONFIG.default_tension_ttl` (30)
- `applyTensionDecay()` will gradually expire stale tensions over ~30 cycles
- The 2033 backlog will naturally drain to ≤50 active as urgency fades

---

*This document is the blueprint. The implementation matches it fully (v4.0.0).*
