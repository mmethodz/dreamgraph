# 10. A typical day

> **TL;DR** — Daemon is already running. Open VS Code. Talk to the Architect like it's a colleague who has read every file. Glance at the dashboard once. Promote a candidate or two. Get on with your life.

This is what living with DreamGraph actually looks like, at three time scales.

---

## Each morning (~2 minutes)

1. **Check the daemon is up.**
   ```powershell
   dg status my-project
   ```
   If it isn't: `dg start my-project --http`.

2. **Open VS Code on your workspace.** The DreamGraph sidebar should connect automatically.

3. **Glance at the dashboard.** Look for:
   - Anything in `tensions_active` that wasn't there yesterday.
   - Recent cycle results in the event log.
   - Any "Disconnected" badges (reconnect with the command palette).

That's the morning ritual. It's short by design.

---

## During work (continuous, hands-off)

You're coding. DreamGraph is in the background. Occasions you actually touch it:

### When you start work in unfamiliar code

> *"What features touch `src/billing/`? What workflows route through them?"*

The Architect answers from the graph instead of grep-then-guess. You orient in seconds.

### When you're considering a change

> *"If I rename `OrderEntity.status` to `OrderEntity.lifecycle_state`, what's affected?"*

The graph knows about workflows, validations, and UI elements that reference the field. The Architect lists them with file paths.

### When you make an architectural choice

> *"Record an ADR: we're moving payment retries from synchronous to a job queue because PSP latency spikes were timing out checkouts. Tag it `payments`, link it to the checkout-workflow."*

Two seconds. The decision is now permanent context.

### When you finish something nontrivial

> *"Run a dream cycle with strategy `gap_detection` and `tension_directed`."*

The engine refreshes its view of what you just built. New candidates appear. Resolved tensions get auto-closed if the engine notices.

### When something looks off in the Explorer

You see a "? → ?" candidate (rare; the engine hides them now), an obviously-wrong validated edge, or a tension that doesn't make sense. Click → reject / resolve / promote with a one-line reason. Move on.

---

## End of day (~3 minutes, optional)

Once you've established a rhythm, this is mostly cleanup:

1. **Open the Candidates panel.** Promote two or three obvious-good ones. Reject the obvious-bad. Skip the rest.
2. **Open the Tensions panel.** Resolve any that match what you just did today.
3. **Record any ADRs you forgot to record.** It's much easier when the reasoning is fresh.

If you skip this, nothing breaks. The graph degrades a little slower than it sharpens. The engine notices.

---

## Each week (~10-20 minutes)

If you want the graph to stay sharp on a fast-moving codebase:

1. **Re-scan after big changes.**
   ```powershell
   dg scan my-project --depth deep
   dg enrich my-project
   ```

2. **Run a full dream cycle.**
   > *"Run `dream_cycle` with `strategy=all` and `max_dreams=30`."*

3. **Triage the Candidates and Tensions panels.** Spend 10 minutes here. It's the single highest-leverage maintenance activity.

4. **Run a nightmare cycle once a week or before releases.**
   > *"Run `nightmare_cycle`."*

---

## What you should NOT do daily

- **Don't run scans constantly.** Once per significant code change is enough.
- **Don't try to drain the Candidates panel to zero.** It's not an inbox. The engine treats latent as a healthy state.
- **Don't hand-edit the JSON files.** Use the Explorer or MCP tools. The daemon writes atomically and your edits will lose to the next save.
- **Don't restart the daemon for fun.** Restart only after upgrades or `engine.env` changes.

---

## Sample day-in-the-life

> 09:12 — Open VS Code. Dashboard shows AWAKE, 3 new tensions overnight from a scheduled cycle. Skim — two are about a deprecated module, one is interesting.
>
> 09:14 — Resolve the two deprecated-module tensions as `wont_fix` ("module being removed in v9").
>
> 09:30 — Working on a refactor. Ask the Architect: *"What workflows depend on `LegacyAuthAdapter`?"* It lists three, with file paths.
>
> 11:00 — Pair-debugging a payment edge case. Architect notices a tension related to it and surfaces it. Closes it as `confirmed_fixed` after the fix lands.
>
> 14:20 — Decided to move queue from Redis to RabbitMQ. *"Record an ADR..."*. Done in 30 seconds.
>
> 17:00 — Heading home. *"Run a dream cycle with strategy gap_detection."* Cycle runs in the background while I close things.
>
> Tomorrow morning — dashboard shows 6 new candidates, 1 new tension. Triage takes three minutes.

That's it. That's the loop.

---

## Next

If you have more than one repo, that needs its own page: **[11. Multi-repo and monorepos](11-multi-repo.md)**.
