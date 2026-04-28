# 8. Dreams and cycles

> **TL;DR** — A dream cycle generates speculative edges, scores them, and either promotes them to fact, keeps them as latent candidates, or discards them. Run cycles when the graph feels stale or after big code changes. Schedule them if you want it on autopilot.

[Chapter 1](01-what-is-dreamgraph.md) introduced the idea. This chapter is the operator's view: what cycles do, when to run them, how to read the results.

---

## The pipeline in one diagram

```
                ┌──────────────┐
                │   AWAKE      │  ← normal state
                └──────┬───────┘
                       │  dream_cycle
                       ▼
                ┌──────────────┐
                │     REM      │  generate dreams (per strategy)
                └──────┬───────┘
                       │  auto_normalize
                       ▼
                ┌──────────────┐
                │ NORMALIZING  │  truth-filter scoring
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   validated         latent         rejected
   (→ fact graph)   (kept)        (deleted)
        │              │              │
        └──────────────┴──────────────┘
                       │
                       ▼
                ┌──────────────┐
                │   AWAKE      │
                └──────────────┘
```

A full cycle is: pick strategies → generate candidate edges → score each → write outcomes → decay old dreams → return.

---

## Strategies

Each cycle runs one or more strategies. You can pick one or use `all`.

| Strategy | What it does |
|----------|--------------|
| `llm_dream` | LLM proposes high-level architectural hypotheses. |
| `gap_detection` | Finds related entities that should probably be connected. |
| `weak_reinforcement` | Strengthens recurring weak signals. |
| `cross_domain` | Bridges disconnected parts of the graph. |
| `missing_abstraction` | Proposes unifying abstractions. |
| `symmetry_completion` | Adds likely reverse/mirrored relationships. |
| `tension_directed` | Focuses dreaming on unresolved tensions. |
| `causal_replay` | Mines historical cause→effect chains. |
| `reflective` | Captures insight after agent code reads. |
| `all` | Runs the full set with adaptive budgeting. |

The engine adaptively benches strategies that produce zero results for several cycles, then probes them every sixth cycle. `llm_dream` and the PGO wave are never benched.

---

## Triggering cycles

### From the Architect (most common)

> *"Run a dream cycle with strategy `tension_directed` and `max_dreams=15`."*

The Architect calls the `dream_cycle` MCP tool and shows you the result.

### From any MCP client

```json
{
  "tool": "dream_cycle",
  "args": { "strategy": "all", "max_dreams": 30 }
}
```

### Scheduled

```powershell
dg schedule my-project --add --cron "0 */6 * * *" --strategy all --max-dreams 30
dg schedule my-project --history
```

### Nightmare cycles (security-focused)

> *"Run a `nightmare_cycle`."*

Nightmare runs five adversarial strategies (privilege escalation, data leak path, injection surface, missing validation, broken access control) and writes findings to `threat_log.json`. High/critical findings become tensions.

### Lucid (interactive)

> *"Start a `lucid_dream` exploring how the user-service might integrate with payments."*

Lucid is human-driven exploration. You ask "what if?" and the engine generates speculative edges that you confirm or discard interactively. End it with `wake_from_lucid`.

---

## Reading cycle output

A typical cycle returns:

```json
{
  "dreams_generated": 24,
  "promoted": 4,
  "latent": 11,
  "rejected": 9,
  "expired": 3,
  "tensions_created": 2,
  "tensions_resolved": 0
}
```

What to look at:

- **promoted > 0** — the cycle actually moved fact forward. Check the new edges in the Explorer.
- **latent** is healthy. Most plausible-but-unproven edges should sit here, not be promoted aggressively.
- **rejected high while promoted low** — strategies are guessing too much. If LLM-driven, the model may need more context; if structural, your graph may be too sparse — re-scan.
- **tensions_created** — interesting things to triage in the Tensions panel.
- **expired** — old dreams TTL'd out. Normal background churn.

---

## When to run cycles manually

| Trigger | Cycle to run |
|---------|--------------|
| Just finished a refactor | `dg scan --depth deep`, then `strategy=all` |
| New tensions feel urgent | `strategy=tension_directed` |
| Graph feels stale | `strategy=weak_reinforcement` |
| Onboarding a new domain | `strategy=cross_domain, missing_abstraction` |
| Pre-release security check | `nightmare_cycle` |
| You want to explore a hypothesis | `lucid_dream` |

---

## When NOT to run cycles

- During an enrich or scan — they share data files. Wait for the previous job to finish.
- Right before a meeting — first cycles can take a few minutes.
- Without an LLM if you specifically want LLM-driven strategies — they'll no-op.

---

## Decay and reinforcement

Every cycle decays unreinforced dreams (TTL−=1, confidence−=0.05). At TTL=0 or confidence<0.35, dreams expire.

But the engine remembers them. **Reinforcement memory** survives 30 cycles past death — if the same dream re-emerges, it inherits the accumulated count and skips the slow start. This means recurring patterns harden over time without you doing anything.

---

## Promotion thresholds (the truth filter)

A dream is promoted to validated only if:

- confidence ≥ 0.62
- plausibility ≥ 0.45
- evidence ≥ 0.40
- evidence_count ≥ 2
- contradiction ≤ 0.3

Misses any → latent. Hard fails → rejected (and may create a tension if confidence ≥ 0.3).

You don't have to memorize this. The relevant takeaway: **the engine is conservative on purpose.** It would rather leave something latent than promote a wrong edge.

---

## Adjusting the engine's appetite

Three policy profiles ship with DreamGraph:

- `strict` — fewer promotions, lower latent count
- `balanced` — the default
- `creative` — more aggressive promotion, more latent dreams

Pick at instance creation:

```powershell
dg init --name my-project --policy creative
```

Or change later by editing `~/.dreamgraph/<uuid>/config/instance.json` and restarting.

---

## Next

Cycles produce candidates and tensions. Now learn what to do with them: **[9. Curating the graph](09-curating-the-graph.md)**.
