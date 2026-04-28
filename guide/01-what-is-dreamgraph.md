# 1. What is DreamGraph?

> **TL;DR** — DreamGraph is a long-running daemon that builds and maintains a knowledge graph of your codebase, and continuously refines that graph through a cognitive loop ("dreaming"). AI agents talk to it through MCP tools to get architectural context that survives across sessions.

This page gives you the mental model. No commands yet. Read it once, slowly. The rest of the guide will make a lot more sense.

---

## The problem DreamGraph solves

When you ask an AI assistant a question about your codebase, it usually starts from zero. Each conversation is a blank slate. It reads a few files, guesses, and forgets everything when the chat ends.

That works for trivia. It does not work for **architectural reasoning** — the kind of question that requires knowing how features connect to workflows, which modules own which entities, what decisions you made six months ago and why.

DreamGraph fixes this by giving the AI **persistent memory in the shape of a graph**.

---

## The three layers

Picture DreamGraph as three concentric layers.

### Layer 1 — The fact graph

This is the trusted, validated knowledge. It contains:

- **Features** — what your codebase actually does
- **Workflows** — how things flow (login, checkout, ingest, etc.)
- **Data model** — the entities, fields, and relationships your system tracks
- **UI registry** — which components exist and where they live
- **Architecture decisions (ADRs)** — choices you made and the reasoning behind them
- **Validated edges** — relationships between any of the above that the system trusts

The fact graph is the source of truth. AI agents quote from it.

### Layer 2 — The dream graph

This is the speculative layer. The cognitive engine generates **dreams** — guesses about edges that probably exist but haven't been proven yet:

> *"`UserService` probably calls `AuditLog.write()` after every login — three other services follow that pattern."*

Dreams live in their own graph until they're either promoted to the fact graph (validated) or discarded. **Speculation never directly mutates truth.** That's a hard rule.

### Layer 3 — The cognitive engine

This is the loop that turns dreams into facts. It runs through five states:

| State | What happens |
|-------|--------------|
| **AWAKE** | Normal operation. The graph answers queries. |
| **REM** | Dream cycle running. The engine generates hypotheses. |
| **NORMALIZING** | The Truth Filter scores dreams and decides their fate. |
| **NIGHTMARE** | Adversarial scan for security risks and anti-patterns. |
| **LUCID** | Human-driven exploration. You ask "what if?" and the engine plays along. |

You don't have to memorize this. The engine handles it. You'll see these states in the dashboard.

---

## What "dreaming" actually means

A dream cycle does roughly this:

1. Look at the current graph. Notice gaps, asymmetries, weak signals.
2. Optionally ask an LLM for hypotheses ("what relationships are likely missing?").
3. Score each hypothesis using structural evidence (recurrence, topology, contradiction pressure).
4. Promote strong ones to the fact graph. Keep weak-but-plausible ones as **latent candidates**. Discard junk.

A dream cycle takes seconds to a few minutes depending on graph size and LLM speed. You can run them on demand, schedule them, or just let them happen automatically.

Over time, dreams compound. The graph gets sharper.

---

## Tensions

A **tension** is a durable record that something is unresolved. Examples:

- A workflow that crosses two features without clear ownership
- Duplicated logic in three modules that should probably be unified
- A validation rule that contradicts itself in two endpoints
- A potential security concern flagged by a nightmare cycle

Tensions don't go away by themselves. You either resolve them (with a code change, an ADR, or a graph edit) or they sit there reminding you they exist. This is intentional.

---

## Architecture decisions (ADRs)

When you make a deliberate choice — "we are using Postgres because we need real transactions" — you can record it as an **ADR**. The graph remembers it. Future dream cycles take it into account. AI agents can quote it back to you next year when you've forgotten why.

ADRs are graph-aware: they can attach to specific features, workflows, or data entities, and they can be deprecated when reality changes.

---

## How AI agents see DreamGraph

DreamGraph exposes itself as an **MCP server**. Any MCP-aware AI tool — Claude Desktop, the DreamGraph VS Code Architect, Copilot through extensions — can call its tools:

- `query_resource` to read the graph
- `enrich_seed_data` to add facts
- `dream_cycle` to run a cognitive pass
- `read_source_code` to read files with repo awareness
- `record_architecture_decision` to capture choices

The agent picks tools the way you'd pick CLI commands. You don't have to wire anything up — once the daemon is running and your MCP client is configured, the tools are just *there*.

---

## What DreamGraph is **not**

- **Not a code search engine.** It uses the graph for reasoning, not as an index for grep. Use ripgrep for grep.
- **Not a documentation generator** in the static sense. The auto-docs in `docs/` are a side effect, not the point.
- **Not a replacement for tests, types, or your code review process.** It's a memory layer.
- **Not magic.** If you don't run scans or curate occasionally, the graph drifts. Garbage in, garbage out.

---

## What you actually do with it

A realistic picture:

- **Once:** install DreamGraph, create an instance for each project, point it at an LLM.
- **Once per project:** run `dg scan` to bootstrap the graph.
- **Daily:** chat with the Architect, browse the Explorer when you're orienting in unfamiliar code, occasionally promote a candidate or resolve a tension.
- **Weekly-ish:** run a dream cycle if you've been making big changes, record any ADRs you made, glance at the dashboard.

That's the whole loop.

---

## Next

You have the mental model. Now install it: **[2. Installation](02-installation.md)**.
