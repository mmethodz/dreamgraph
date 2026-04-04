# DreamGraph Workflows

> Step-by-step operational flows for every cognitive process.

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
| 3 | Strategy selection | Select from 8 strategies. Budget distributed adaptively — strategies with 3+ zero-yield cycles are benched, probed every 6th cycle. |
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
| 2 | Active cap enforcement | >50 active → lowest-urgency auto-archived. Prevents cognitive overload. |
| 3 | Per-cycle decay | urgency −= 0.02, TTL −= 1. At zero → expired. |
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
