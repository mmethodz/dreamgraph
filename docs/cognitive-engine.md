# DreamGraph Cognitive Engine — Deep Dive

> How DreamGraph thinks, learns, and self-corrects.

---

## Overview

The cognitive engine is a **speculative knowledge discovery system**. It generates hypothetical connections between entities in a fact graph, validates them through a strict three-outcome classifier, and accumulates an evolving understanding over time. The entire process is designed to be **safe by default** — the fact graph is never modified, and all speculative output is quarantined until validated.

---

## State Machine

```
           ┌─────────────────────────────────────────┐
           │                                         │
           ▼                                         │
        AWAKE ──────────────────────────► NIGHTMARE ─┘
           │
           ▼
          REM ──────────────────────────►  NORMALIZING ──► AWAKE
                                              │
                                              ├─ validated ──► promoted
                                              ├─ latent ──► speculative memory
                                              └─ rejected ──► discarded
```

| Transition | Trigger | What Happens |
|-----------|---------|-------------|
| AWAKE → REM | `dream_cycle` tool | Decay pass, then dreamer generates speculative edges |
| REM → NORMALIZING | Auto (when `auto_normalize=true`) | Three-outcome classifier scores each edge |
| NORMALIZING → AWAKE | Auto | Promotion gate filters, tensions created/resolved, history recorded |
| AWAKE → NIGHTMARE | `nightmare_cycle` tool | Adversarial scanner probes for vulnerabilities |
| NIGHTMARE → AWAKE | Auto | Threat log persisted |
| Any → AWAKE | `interrupt()` | Emergency safe-return; in-progress data quarantined |

The engine is a **singleton**. Concurrent state transitions are prevented by design — transitions are synchronous method calls that throw if the precondition state is wrong.

---

## Dream Strategies

The dreamer implements **10 strategies** (7 original + reflective in v5.0 + PGO wave + LLM dream):

### 1. Gap Detection
Finds entity pairs with no direct edge but shared context (keywords, domain, repo). Generates a hypothetical connecting edge with a rationale describing the gap.

### 2. Weak Reinforcement
Identifies existing edges rated "weak" in the fact graph and proposes stronger alternatives or supporting edges.

### 3. Cross-Domain Bridging
Connects entities from different domains via shared keywords. These are often the most novel discoveries.

### 4. Missing Abstraction
Proposes hypothetical new entities (features) that would unify multiple existing entities under a common abstraction.

### 5. Symmetry Completion
Where only a one-directional edge exists (A→B but not B→A), proposes the reverse relationship.

### 6. Tension-Directed
Focuses on entities involved in unresolved tensions. Generates edges specifically aimed at resolving open questions.

### 7. Causal Replay
Mines dream history for cause→effect chains. Uses BFS to build propagation chains from historical data.

### 8. Reflective *(v5.0+)*
Agent-directed insights from code reading. The AI reads actual source code and solidifies observations as dream edges.

### 9. PGO Wave *(v6.0+)*
Stochastic divergence inspired by **Ponto-Geniculo-Occipital waves** — the random neural bursts during REM sleep that force the forebrain to synthesize meaning from noise. Mathematically grounded in three models:

- **Burst amplitude** — Geometric distribution (p=0.3, mean ~3.3). Most cycles produce a few edges; occasionally a large creative burst occurs.
- **Lévy flight entity selection** — Pareto(α=1.5) step distribution. Lots of small local hops + occasional giant leaps across distant domains. Domain distance reduced by keyword overlap.
- **Stochastic resonance confidence** — Confidence assigned in a narrow band [0.25, 0.50]. Higher domain distance → slightly higher confidence (noise amplifies weak cross-domain signals).

Produces 8 novel relation types: `emergent_pattern`, `hidden_dependency`, `conceptual_bridge`, `phantom_coupling`, `resonance_link`, `convergent_evolution`, `shadow_interaction`, `latent_composition`. Edges decay 1.2× faster than normal — noise should fade quickly. PGO wave is never adaptively benched (same immunity as LLM dream).

### 10. LLM Dream *(v6.0+)*
LLM-powered creative dreaming. The dream engine sends a structured prompt to the configured LLM provider (Ollama, OpenAI-compatible, or MCP Sampling) with the current fact graph context — entity summaries, existing edges, active tensions, validated edges, and source file overlaps. The LLM proposes novel connections (edges and optionally new dream nodes) that no structural algorithm would discover. The normalizer then validates LLM suggestions against the fact graph — hallucinations are filtered out, genuine insights are promoted. LLM dream is the **primary** strategy: when an LLM is available, it runs first with 40% of the dream budget; remaining budget is split among structural strategies.

**Configuration:** LLM provider settings come from environment variables (`DREAMGRAPH_LLM_*`) or per-instance `config/engine.env` files. Default: Ollama with `qwen3:8b` at `localhost:11434`. When no LLM is reachable, dreams fall back to structural-only mode (degraded). Per-component overrides (`DREAMGRAPH_LLM_DREAMER_*`, `DREAMGRAPH_LLM_NORMALIZER_*`) allow the dreamer and normalizer to use different models and temperatures — e.g., a creative model at high temperature for dreaming and a precise model at low temperature for validation.

When `strategy="all"`, all strategies run and their outputs are merged with duplicate suppression. LLM dream runs first when available, allocated 35% of the total budget. PGO wave gets 15%. The remaining 50% is split among structural strategies.

---

## Normalization Pipeline

The normalizer is the **strictest critic** in the system. It classifies every speculative edge against the fact graph.

### Split Scoring

Each edge receives four independent scores:

| Score | Weight | What It Measures |
|-------|--------|-----------------|
| **Plausibility** | 0.45 | Structural/semantic fit — domain match, keyword overlap, repo coherence |
| **Evidence** | 0.45 | Grounding — entity existence, shared connections, evidence count |
| **Contradiction** | penalty | Conflicts — contradicts existing edges, invalid entity references |
| **Bonus** | +0.10 max | Reinforcement bonus — edge seen in multiple cycles |

**Combined confidence:**
```
confidence = plausibility × 0.45 + evidence × 0.45 + bonus − penalty
```

### Three Outcomes

| Outcome | Criteria | Destination |
|---------|----------|-------------|
| **Validated** | confidence ≥ 0.62 AND plausibility ≥ 0.45 AND evidence ≥ 0.40 AND evidence_count ≥ 2 AND contradiction ≤ 0.3 | Promoted to `validated_edges.json` |
| **Latent** | plausibility ≥ 0.35 AND not fatally contradicted | Stays in dream graph as speculative memory |
| **Rejected** | Everything else | Discarded (but creates tension if confidence ≥ 0.3) |

### Promotion Gate

The strict promotion gate prevents low-quality edges from leaking into validated status:

```typescript
const DEFAULT_PROMOTION = {
  min_combined_confidence: 0.62,
  min_plausibility: 0.45,
  min_evidence: 0.40,
  min_evidence_count: 2,
  max_contradiction: 0.3,
};
```

Edges blocked by the gate are counted separately (`blocked_by_gate`) and generate tensions for future investigation.

---

## Speculative Memory

Edges classified as **latent** are the most interesting part of the system. They represent ideas that are *plausible but not yet proven*. Key properties:

- **TTL (Time-to-Live):** Each edge starts with TTL=3. Decremented each cycle. At TTL=0, the edge expires.
- **Decay Rate:** Confidence decays by `decay_rate` (default 0.05) each cycle.
- **Reinforcement:** If the same edge is re-generated in a later cycle, its `reinforcement_count` increments and confidence gets a boost.
- **Reinforcement Memory:** Even after an edge expires, its reinforcement history persists. If the same edge is re-generated later, it inherits accumulated evidence — so patterns genuinely accumulate across incarnations.

### Decay Formula

Each cycle:
```
edge.confidence -= edge.decay_rate
edge.ttl -= 1
if (edge.ttl <= 0 || edge.confidence <= 0) → expire
```

### Deduplication

When the dreamer generates an edge that already exists in the dream graph:
1. The duplicate is suppressed
2. The existing edge's `reinforcement_count` increments
3. Confidence gets a boost: `+0.05 × reinforcement_count`
4. TTL is refreshed

This means persistent patterns grow stronger over time, while noise decays away.

---

## Tension System

Tensions are the system's way of tracking **what it doesn't understand**. They direct future dream cycles and signal areas needing attention.

### Tension Lifecycle

```
Created ──► Active (urgency decays each cycle)
  │              │
  │              ├── Resolved (by promoted edge, or human/system authority)
  │              └── Expired (TTL reached 0)
  │
  └── Re-opened (if recheck_ttl is set and evidence contradicts resolution)
```

### Tension Properties

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (e.g. `tension_1234567890_42`) |
| `type` | `weak_connection`, `missing_edge`, `contradiction`, `data_gap`, `security_concern`, `performance_risk` |
| `entities` | Entity IDs involved |
| `description` | What the system is struggling with |
| `urgency` | 0.0–1.0, decays each cycle |
| `domain` | Domain classification |
| `resolved` | Whether closed |
| `resolution` | `{type, authority, evidence, timestamp}` |

### Auto-Resolution

When a promoted edge addresses entities involved in an unresolved tension, the tension is automatically resolved with `resolution_type: "confirmed_fixed"`.

---

## Adversarial Dreaming (Nightmares)

The NIGHTMARE state runs five security-focused scan strategies:

1. **Privilege Escalation** — finds paths where permissions could be bypassed
2. **Data Leak Path** — traces data flow for exfiltration risks
3. **Injection Surface** — identifies unvalidated input entry points
4. **Missing Validation** — finds entities without proper validation constraints
5. **Broken Access Control** — detects authorization gaps

Results include severity ratings, CWE IDs, blast radius estimates, and are persisted to the threat log.

---

## Causal Reasoning

The causal engine analyzes dream history to discover **cause→effect chains**:

- **BFS Chain Discovery:** Walks the validated edge graph to find propagation paths
- **Hotspot Detection:** Identifies entities with the highest downstream impact
- **Impact Prediction:** Projects what would happen if a specific entity changed

### Example Output

```
tension_management → temporal_analysis → dream_cycle → normalization_pipeline
                                       ↘ causal_reasoning
                                       ↘ speculative_memory
```

**Top Propagation Hotspot:** `temporal_analysis` — 18 downstream entities affected.

---

## Temporal Analysis

Pattern detection across the time dimension:

- **Tension Trajectories:** Classifies each entity's tension history as rising, falling, spike, stable, or oscillating
- **Retrocognition:** Matches current tensions against historical resolution patterns
- **Seasonal Patterns:** Detects recurring cycles in dream activity

---

## v5.1: Metacognitive Self-Tuning

The metacognition module (`metacognition.ts`) analyzes DreamGraph's own performance:

### Per-Strategy Metrics

For each dream strategy, tracks:
- **Precision:** validated / (validated + rejected)
- **Yield:** edges promoted per cycle
- **Weight:** adjusted multiplier (high precision → more cycles, low → fewer)
- **Tension Resolution Rate:** how often this strategy resolves tensions

### Calibration Buckets

Groups edges by confidence range and measures actual validation rate:

| Confidence Bucket | Actual Validation Rate |
|-------------------|----------------------|
| 0.0–0.6 | ~0% |
| 0.6–0.7 | ~97.5% |
| 0.7–0.8 | ~100% |
| 0.8–1.0 | ~100% |

This reveals that the 0.62 promotion threshold is well-calibrated.

### Domain Decay Profiles

Tracks how quickly edges decay in different domains. Some domains produce durable connections; others are more volatile.

### Auto-Apply

When `auto_apply=true`, recommended threshold adjustments are applied to the in-memory engine state (bounded by safety guards, reset on restart).

---

## v5.1: Event-Driven Dreaming

The event router (`event-router.ts`) enables **reactive** cognitive cycles:

### Event Sources

| Source | Trigger | Response |
|--------|---------|----------|
| `git_webhook` | Code push | Scope dream to changed entities |
| `ci_cd` | Build/deploy | Focus on affected workflows |
| `runtime_anomaly` | Error spike | Investigate related entities |
| `tension_threshold` | Auto | Too many tensions → auto-dream |
| `federation_import` | Archetype arrival | Integrate cross-project patterns |
| `manual` | Human trigger | Directed investigation |

### Classification

Events are classified by severity, then entity-scoped. High-severity events trigger immediate dream cycles focused on affected entities.

### Tension Threshold Auto-Trigger

After every `dream_cycle`, `checkTensionThresholds()` fires. If unresolved tension count exceeds the configured limit, an automatic `tension_threshold` event is dispatched.

---

## v5.1: Continuous Narrative Intelligence

The narrator (`narrator.ts`) writes an **ongoing autobiography** of the system's understanding:

### Auto-Narrate Chapters

After every 10 dream cycles, `maybeAutoNarrate()` generates a diff chapter comparing the current state to the last chapter. Each chapter includes:
- New discoveries since last chapter
- Tensions created and resolved
- Validation statistics
- Health assessment

### Weekly Digests

Aggregates across ~50 cycles with health trend analysis.

### System Story File

All chapters and digests accumulate in `data/system_story.json` — a persistent, growing autobiography that survives restarts.

---

## Federation

DreamGraph instances can share knowledge:

1. **Export:** `export_dream_archetypes` extracts anonymized patterns from validated edges
2. **Import:** `import_dream_archetypes` merges external patterns into local archetype store
3. **Dream Seeding:** Imported archetypes can inform future dream cycles

Archetypes are abstracted beyond system-specific names to enable cross-project learning.

---

## Safety Guarantees

1. **Fact graph is immutable** — the cognitive system reads but never writes to features/workflows/data_model files
2. **REM output is quarantined** — dream artifacts live only in `dream_graph.json`
3. **Strict promotion gate** — only edges passing all five thresholds reach validated status
4. **Interruption protocol** — any state can safely return to AWAKE; in-progress data is quarantined
5. **Stderr-only logging** — all logs go to stderr, never corrupting the STDIO stream
6. **Decay prevents accumulation** — stale dreams expire automatically
7. **Confirmation required for destructive ops** — `clear_dreams` requires `confirm: true`
8. **Scheduler safety guards** — rate limits, cooldowns, error-streak auto-pause (v5.2)

---

## v5.2: Dream Scheduling

The Dream Scheduler (`scheduler.ts`) adds **policy-driven temporal orchestration** — DreamGraph can now schedule its own cognitive work to run automatically at defined intervals and conditions.

### Architecture

The scheduler runs **in-process** within the MCP server. It does not spawn external processes — when a scheduled action fires, it calls the same internal engine functions the MCP tools use. This design is intentional: the MCP server needs the AI agent on the other end to interpret dream results, so scheduled work accumulates results that the agent processes on its next interaction.

### Trigger Types

| Trigger | Description | Example |
|---------|-------------|---------|
| `interval` | Fixed-interval timer (seconds) | Dream every 60 minutes |
| `cron_like` | Hour/minute/day-of-week pattern | Dream at 03:00 on weekdays |
| `after_cycles` | Fire after N dream cycles complete | Nightmare scan every 10 cycles |
| `on_idle` | Fire after N seconds of inactivity | Dream when agent is idle 5 min |

### Schedulable Actions

| Action | What It Does |
|--------|-------------|
| `dream_cycle` | Run a standard dream cycle (strategy configurable) |
| `nightmare_cycle` | Run an adversarial security scan |
| `normalize_dreams` | Trigger normalization of pending dreams |
| `metacognitive_analysis` | Run self-tuning analysis |
| `get_causal_insights` | Discover cause→effect chains |
| `get_temporal_insights` | Analyze temporal patterns |
| `export_dream_archetypes` | Export patterns for federation |

### Safety Guards

The scheduler enforces strict safety limits to prevent runaway cognitive activity:

| Guard | Default | Purpose |
|-------|---------|---------|
| Max runs per hour | 30 | Rate-limit across all schedules |
| Cooldown between runs | 10 seconds | Prevent burst-firing |
| Nightmare cooldown | 5 minutes | Extra cooldown after adversarial scans |
| Error streak pause | 3 consecutive | Auto-pause schedule after 3 failures |
| Max concurrent | 1 | Only one action executes at a time |

### Schedule Lifecycle

```
Created (enabled=true)
  │
  ├── Tick loop checks every 30s (configurable)
  │     ├── Trigger condition met? → Execute action → Record result
  │     ├── Max runs reached? → Auto-disable
  │     └── Error streak? → Auto-pause
  │
  ├── Manual: run_schedule_now → Immediate execution
  ├── Manual: update_schedule → Modify trigger/action/limits
  └── Manual: delete_schedule → Remove permanently
```

### Persistence

All schedules and their execution history are persisted to `data/schedules.json`. The scheduler state survives server restarts — active schedules resume automatically on startup.

### Hooks

The scheduler integrates with the cognitive engine through two hooks:

1. **`notifyCycleComplete(cycle)`** — called after every `dream_cycle`, enables `after_cycles` triggers
2. **`recordActivity()`** — called on any MCP tool invocation, resets the idle timer for `on_idle` triggers

---

## LLM Provider Integration

Dreams don't work without an LLM. The deterministic strategies find structural patterns; the LLM provides the creative leap — proposing connections no graph algorithm would discover. The normalizer then filters hallucinations from insights.

### Provider Hierarchy

| Priority | Provider | When Used |
|----------|----------|-----------|
| 1 | **Ollama** (local) | Autonomous daemon dreaming — no API key needed |
| 2 | **OpenAI-compatible** (cloud) | Anthropic, OpenAI, Groq, etc. — requires API key |
| 3 | **MCP Sampling** | Ask the connected client's LLM (IDE mode, human-in-the-loop) |
| 4 | **None** | Structural-only fallback (degraded mode) |

### Configuration

LLM settings are configured via environment variables or per-instance `config/engine.env` files:

| Variable | Default | Description |
|----------|---------|-------------|
| `DREAMGRAPH_LLM_PROVIDER` | `ollama` | Provider type: `ollama`, `openai`, `sampling`, `none` |
| `DREAMGRAPH_LLM_MODEL` | `qwen3:8b` | Model name (provider-dependent) |
| `DREAMGRAPH_LLM_URL` | `http://localhost:11434` | API base URL |
| `DREAMGRAPH_LLM_API_KEY` | — | API key (required for `openai` provider) |
| `DREAMGRAPH_LLM_TEMPERATURE` | `0.7` | Creativity parameter (0.0–1.0) |
| `DREAMGRAPH_LLM_MAX_TOKENS` | `2048` | Max response tokens |

### Per-Instance Configuration

Each instance can override the global LLM settings via a `config/engine.env` file:

```
~/.dreamgraph/<uuid>/
└── config/
    ├── instance.json     # Identity
    ├── mcp.json          # Repos, transport
    ├── policies.json     # Discipline rules
    ├── schema_version.json
    └── engine.env        # LLM provider, API keys, model settings
```

The `engine.env` file uses simple `KEY=VALUE` syntax (supports comments with `#`, quoted values). Values are loaded at startup **before** config parsing, so they override global env vars with "per-instance wins" semantics. This allows different instances to use different models, providers, or API keys.

### Integration with the Dreamer

When `strategy="all"` is used (the default for scheduled dream cycles):

1. **LLM dream runs first** — allocated 40% of the total dream budget
2. **Structural strategies split the remaining 60%** — gap detection, weak reinforcement, etc.
3. All results are merged with **duplicate suppression** — identical edge proposals are reinforced rather than duplicated
4. The normalizer validates all edges equally regardless of source — LLM-generated edges must pass the same Truth Filter thresholds as structural edges

If the LLM provider is not reachable, the dream cycle operates in **degraded mode** — structural strategies only. The system logs a warning at startup when the provider is unavailable.

### JSON Schema Enforcement

When using the OpenAI provider, the dreamer sends a **Structured Outputs** request (`response_format: { type: "json_schema", json_schema: { strict: true, schema: ... } }`). This guarantees that every LLM response conforms to the exact expected schema — no malformed JSON, no missing fields, no matter how high the temperature is set. The model can hallucinate the wildest architectural tensions it wants; the V8 parser never breaks.

For Ollama, the system falls back to basic `format: "json"` mode, which produces valid JSON but does not enforce a specific schema. The tolerant `parseLlmDreamResponse()` parser handles edge cases (code fences, partial output, extra text) for both providers.

### Temperature Guide

| Temperature | Behavior | Recommended For |
|-------------|----------|-----------------|
| 0.3–0.5 | Conservative, predictable | Testing, low-budget setups |
| 0.7 | Balanced (default) | General use, Ollama local models |
| 0.9 | Creative, speculative | Cloud models with Structured Outputs (recommended) |
| 1.0+ | Chaotic | Not recommended — increased risk of entity ID hallucination |

The normalizer acts as the strict critic regardless of temperature. Higher creativity produces more novel hypotheses; the normalizer's job is to separate genuine insights from hallucinations.

### ⚠️ Cost & Usage Warning

**Every dream cycle with a cloud LLM provider makes an API call.** When combined with scheduled dreaming, this creates continuous, unattended spend.

**Estimated cost per dream cycle (GPT-4o-mini):**
- Input: ~2,000–5,000 tokens (knowledge graph context)
- Output: ~500–2,000 tokens (edge proposals)
- Cost: ~$0.001–0.003 per cycle

**Projected daily cost by schedule interval:**

| Schedule Interval | Cycles/Day | Est. Cost (GPT-4o-mini) | Est. Cost (GPT-4o) |
|---|---|---|---|
| Every 60 seconds | 1,440 | $1.50–$4.30 | $22–$65 |
| Every 5 minutes | 288 | $0.30–$0.85 | $4.30–$13 |
| Every 30 minutes | 48 | $0.05–$0.15 | $0.70–$2.20 |
| Every hour | 24 | $0.025–$0.07 | $0.35–$1.10 |

**Cost control recommendations:**

1. **Use Ollama for local development** — `DREAMGRAPH_LLM_PROVIDER=ollama` is free and runs entirely on your hardware
2. **Set conservative schedule intervals** — `interval_seconds` ≥ 300 (5 min) for cloud providers
3. **Cap cycles per hour** — `DREAMGRAPH_SCHEDULER` `max_runs_per_hour` limits how often the scheduler fires
4. **Monitor your billing dashboard** — set billing alerts with your cloud provider
5. **Stop the daemon when not needed** — `dg stop <instance>` halts all scheduled cycles
6. **Use `none` to disable** — `DREAMGRAPH_LLM_PROVIDER=none` falls back to structural-only dreaming at zero cost

> **🚨 Do not leave scheduled cloud LLM dreaming running unattended without billing limits.**
> A daemon running at 60-second intervals with GPT-4o can accumulate $30–60+/day.
> Always configure `max_runs_per_hour` and monitor your API provider's usage dashboard.
