# 7. The Explorer

> **TL;DR** — The Explorer is the interactive graph view. Use it to browse entities, inspect details, review tensions, promote/reject candidate edges, and watch the engine think in real time.

The Explorer is available two ways:

- **Inside VS Code** — DreamGraph sidebar → Explorer panel.
- **In a browser** — `http://localhost:<daemon-port>/explorer/` (e.g. `http://localhost:8010/explorer/`).

Both surface the same SPA. The browser is nice on a second monitor.

---

## Layout

```
┌──────────────────┬───────────────────────┬──────────────────┐
│  Filters         │                       │  Inspector       │
│  Search          │      Graph canvas     │  (selected node  │
│  Tensions        │       (Sigma.js)      │   or edge)       │
│  Candidates      │                       │                  │
├──────────────────┴───────────────────────┴──────────────────┤
│  Event dock — live cycle, normalization, mutation events    │
└─────────────────────────────────────────────────────────────┘
```

---

## Graph canvas

- **Pan** with click-drag.
- **Zoom** with the scroll wheel.
- **Click a node** to select it. Selection lights up the inspector and the connected edges.
- **Hover** for a quick label tooltip.

The pulse overlay shows where activity is happening — recently changed nodes, new edges from the latest cycle, tensions getting hotter.

---

## Inspector

When you click a node or edge:

- **Identity** — id, type, name, source files.
- **Attributes** — type-specific fields (entity_type, intent, etc.).
- **Connections** — incoming and outgoing edges, grouped by relation type.
- **Provenance** — which dream cycle introduced it, what evidence supported it.

For ADRs, you'll also see status (active/deprecated), rationale, and which entities the decision touches.

---

## Filters

The filters panel narrows the canvas:

- By entity type (feature, workflow, data-model, ui-element, ADR, tension)
- By edge status (validated only / include latent / include rejected)
- By age, confidence, evidence count
- By repository (multi-repo setups)

Filters are **client-side** — they reshape what's drawn, not what the engine knows.

---

## Search

Top-bar search is fuzzy across names, ids, descriptions, and source paths. Hit Enter to jump-select the top match; the canvas centers on it.

---

## Tensions panel

Shows open tensions, sorted by urgency:

- Type (contradiction, missing-abstraction, ownership-unclear, threat, etc.)
- Urgency (decays each cycle)
- Entities involved
- Domain
- Time-to-live

For each one you can:

- **Inspect** — jump to the involved entities on the canvas
- **Resolve** — mark as `confirmed_fixed`, `false_positive`, or `wont_fix` with a reason
- **Defer** — leave it open

The Explorer will use LLM (when configured) to generate a default reason. It can be overridden.

Resolving a tension is one of the most valuable curation actions you can take. See [9. Curating the graph](09-curating-the-graph.md).

---

## Candidates panel

Shows **latent candidate edges** — speculation that the cognitive engine considered plausible enough to keep around but not strong enough to validate automatically.

For each candidate you'll see:

- The edge: `from → to` (with type)
- Confidence, plausibility, evidence score, contradiction
- Reason code (why it's still latent)
- Inspect / Promote / Reject buttons

> **Note on stale rows.** If the underlying dream entity was pruned by the engine, the candidate is hidden from the actionable list and a banner shows the count: *"N stale candidate(s) hidden."* You can't promote something whose source is gone.

### Promoting a candidate

Click **Promote**, write a one-line reason (this is required, DreamGraph uses LLM (when configured) to generate a default reason that can be overridden), submit. The candidate becomes a validated edge in `validated_edges.json`. The graph updates immediately.

### Rejecting a candidate

Click **Reject**, write a reason (also auto-generated when LLM is configured), submit. The candidate is removed. If it was wrong-but-confident, the engine learns to weigh it differently in future cycles.

### Why is reason required?

Every curation mutation requires a reason. Reasons are stored in the audit log and become part of the system's provenance. Future-you (or future-AI) reading the graph can ask "why is this edge here?" and get an answer.

---

## Event dock (the bottom strip)

Live feed from the cognitive engine:

- `cycle.started` / `cycle.completed`
- `dream.normalized` (with promoted/latent/rejected counts)
- `tension.created` / `tension.resolved`
- `candidate.promoted` / `candidate.rejected`
- `cache.invalidated` (snapshot updates)

Useful when you trigger a cycle and want to watch it work.

---

## ETag / conflict handling

The Explorer uses an etag-based snapshot. When the underlying graph changes (because a cycle ran, or another user did a mutation), the etag advances and the panels refresh.

If you click Promote on a stale snapshot, the server rejects the mutation with a 409 Conflict. The Explorer shows a "snapshot changed — refresh and try again" banner. This is by design: it prevents you from acting on data the engine has already moved past.

---

## When the canvas is overwhelming

Big graphs are big. A few strategies:

- Start with the **filters** dialed down to one entity type at a time.
- Use **search** to jump to a specific entity instead of pan-hunting.
- Look at the **dashboard** first to know what counts to expect.
- Open the **Tensions** panel and let the urgency list focus your attention.

---

## Next

You've seen the graph. Now learn what makes it grow: **[8. Dreams and cycles](08-dreams-and-cycles.md)**.
