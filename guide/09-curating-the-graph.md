# 9. Curating the graph

> **TL;DR** — Curation is how you teach the engine. Promote good candidates, reject bad ones, resolve tensions, record ADRs. Every mutation requires a one-line reason and is logged.

The cognitive engine is good at proposing. It's mediocre at deciding. You are the judge.

---

## The three curation actions

### 1. Promote a candidate

A candidate edge stayed latent because the engine wasn't sure. You read it, decide it's right, and promote it.

Where: Explorer → Candidates panel → **Promote**.

What happens:

- The edge moves from `dream_graph.json` to `validated_edges.json`.
- It's now visible to all queries as a fact.
- The promotion is logged with your reason.

When to do it:

- The edge matches what you know about the codebase.
- The "from" and "to" entities exist and the relationship is correct.
- You can articulate a reason in one sentence.

When **not** to do it:

- You're not sure. Leave it latent. The engine will revisit it.
- The "from → to" labels say "? → ?" — that's a stale candidate (the engine should hide these, but if you see one, don't promote it).

### 2. Reject a candidate

The candidate is wrong. Maybe wrong type, wrong direction, or referencing something that doesn't actually relate.

Where: Explorer → Candidates panel → **Reject**.

What happens:

- The candidate is removed from `dream_graph.json`.
- The rejection is logged with your reason.
- The engine learns: a high-confidence wrong dream typically becomes a tension so it doesn't quietly reappear.

When to do it: confidently false. Be liberal — rejection is cheap.

### 3. Resolve a tension

A tension says "this is unresolved." Resolution closes it.

Where: Explorer → Tensions panel → **Resolve**.

Three resolution types:

| Type | Meaning |
|------|---------|
| `confirmed_fixed` | The underlying issue is fixed (in code, by an ADR, or by design clarity). |
| `false_positive` | The tension was wrong. The engine's heuristic misfired. |
| `wont_fix` | The issue is real but acceptable / out of scope / by design. |

What happens:

- Tension status changes to `resolved` with your type and reason.
- It moves out of the active list but stays in `tension_log.json` for history.

If new contradictory evidence appears, the engine may re-open it. That's by design.

---

## Why every mutation requires a reason

Reasons are part of the graph's provenance. Months from now, someone (you, a teammate, or an AI agent) will ask "why is this edge here?" or "why was this tension closed?" The answer is in the reason field.

One-line is fine. *"Confirmed by reading auth-middleware.ts, the audit-log call is unconditional."* is plenty.

---

## Recording architecture decisions (ADRs)

When you make a deliberate choice — not a fact discovered, but a choice made — record it as an ADR.

From the Architect:

> *"Record an ADR: we chose Postgres over MongoDB because we need real ACID transactions for the order pipeline. Tag it `database`. Link it to the order-workflow and the order-entity."*

What you get:

- A new ADR in `adr_log.json` with id, title, rationale, status, tags, and links to entities.
- Future dream cycles weight the decision when generating dreams in that area.
- Future agents reading the graph quote the rationale.

ADR statuses:

- `proposed` — under consideration
- `accepted` — active and binding
- `deprecated` — superseded; keep for history
- `superseded` — replaced by a specific newer ADR

To deprecate:

> *"Deprecate ADR `adr_2024_postgres` with reason 'replaced by adr_2026_distributed_sql'."*

---

## Where mutations are logged

Every curation action lands in:

- The relevant data file (`validated_edges.json`, `tension_log.json`, etc.)
- An audit trail accessible via `query_resource` resources
- Live event dock at the bottom of the Explorer

You can ask the Architect for an audit summary:

> *"Show me all candidate promotions from the last seven days with their reasons."*

---

## Curation rhythm — what's reasonable

You do **not** need to triage every candidate or close every tension.

A reasonable rhythm:

- **Daily, 5 min** — glance at the dashboard. If tensions_active is climbing into the dozens, spend a moment.
- **Weekly, 15 min** — open the Candidates panel, promote a few, reject a few. Resolve any tensions that obviously matched recent code changes.
- **After major work** — record ADRs for the architectural choices you actually made. This is the highest-ROI curation action.

The engine is designed to keep working without curation. Curation just makes it sharper.

---

## When the candidate list explodes

If you've just run a big `strategy=all` cycle and the Candidates panel has 100+ items, don't panic. Strategies for triaging:

1. Sort by confidence descending. Promote the top handful, ignore the bottom.
2. Filter by domain or entity type to narrow the field.
3. Run `dg curate my-project` to auto-trim duplicates and merge near-equivalents.
4. Lower the engine's appetite (`policy=strict`) if this happens every cycle.

---

## When tensions explode

Tensions are capped (default 200 active). When the cap is hit, lowest-urgency tensions auto-archive. So the panel won't grow forever — but it can still feel noisy.

A few useful moves:

- Close obvious false positives in batches.
- Resolve tensions that are about modules you've since deleted (`wont_fix`, "module removed").
- Run `nightmare_cycle` separately from regular dream cycles so security tensions don't drown out structural ones.

---

## Next

Now put it all together: **[10. A typical day](10-daily-workflow.md)**.
