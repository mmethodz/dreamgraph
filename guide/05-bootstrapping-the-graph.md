# 5. Bootstrapping the graph

> **TL;DR** — `dg scan my-project` reads your repo and seeds the graph. Then `dg enrich my-project` deepens it. After that, `dream_cycle` from your AI agent (or a schedule) starts compounding.

A fresh instance has an empty graph. This page explains how to fill it.

---

## The bootstrap commands

### `dg scan` — the initial pass

```powershell
dg scan my-project
```

Scan walks the attached repository, extracts:

- **Source files** — paths, languages, sizes
- **API surface** — exported functions, classes, types
- **Data model hints** — schema files, type declarations, ORM models
- **UI elements** — components, routes (front-end repos)
- **Config and templates** — env vars, build config

…and writes them into the graph as features, workflow stubs, data-model entries, and UI-registry entries.

Useful flags:

```powershell
dg scan my-project --depth shallow      # quick top-level pass
dg scan my-project --depth deep         # follows imports further
dg scan my-project --targets features,data_model,workflows
```

You can re-run scan whenever you want. Subsequent runs upsert: existing entities are updated, new ones added, removed source files mark entities as orphaned.

### `dg enrich` — fill in the gaps

```powershell
dg enrich my-project
dg enrich my-project --depth deep
dg enrich my-project --targets workflows,capabilities
```

Enrichment uses the LLM (and structural analysis) to:

- Promote scaffolded stubs into described entities
- Infer workflow steps from feature interactions
- Suggest links between data-model entities
- Surface system-level capabilities

If you skipped LLM setup, enrichment falls back to structural-only inference. It works, but the descriptions will be sparse.

### `dg curate` — quality pass

```powershell
dg curate my-project
dg curate my-project --dry-run    # preview what would change
```

Curate trims duplicates, merges near-equivalent entities, and resolves easy contradictions. Run it after big enrich passes.

---

## Where the graph lives

After bootstrap, look at `~/.dreamgraph/<instance-uuid>/`:

```
data/
  features.json          # The features in your codebase
  workflows.json         # End-to-end flows
  data_model.json        # Entities, fields, relationships
  ui_registry.json       # UI components/routes
  capabilities.json      # System-level capabilities
  validated_edges.json   # Trusted relationships
  candidate_edges.json   # Speculative relationships from dreams
  dream_graph.json       # Full speculation graph
  tension_log.json       # Open + resolved tensions
  adr_log.json           # Architecture decisions
  threat_log.json        # Nightmare-cycle findings
  index.json             # Cross-referencing index
  schedules.json         # Scheduled dream tasks
  ...
logs/
  daemon-<date>.log
config/
  engine.env
  instance.json
```

These are plain JSON. You can read them. You **shouldn't** edit them by hand while the daemon is running — use the Explorer or the MCP tools instead. The daemon writes atomically via `<file>.tmp` + rename, so partial edits will lose to the next save.

---

## What to expect on the first scan

| Repo size | First scan | First enrich | First dream cycle |
|-----------|-----------|--------------|-------------------|
| Tiny (< 1k files) | seconds | < 1 minute | seconds |
| Medium (10k files) | 1-2 min | 2-5 min | 30s-2 min |
| Large (100k+ files) | 5-15 min | 10-30 min | 1-5 min |

Numbers are wide because LLM speed dominates. Local Ollama is slowest; OpenAI fastest.

---

## A reasonable bootstrap recipe

Run these in order, the first time:

```powershell
dg scan my-project
dg enrich my-project
dg curate my-project
```

Then trigger a dream cycle from your AI agent:

> *"Run `dream_cycle` with `strategy=all` and `max_dreams=20`."*

Then look at the Explorer (next chapter coming up) and see what the system found.

---

## Re-bootstrapping after big code changes

When you finish a refactor or add a major feature, give the graph a refresh:

```powershell
dg scan my-project --depth deep
dg enrich my-project
```

You don't have to. The graph degrades gracefully. But a periodic re-scan keeps things sharp.

---

## Scheduling

If you'd rather not type commands, schedule recurring dream cycles:

```powershell
dg schedule my-project --add --cron "0 */6 * * *" --strategy all --max-dreams 30
dg schedule my-project --history
dg schedule my-project --pause <id>
dg schedule my-project --resume <id>
dg schedule my-project --delete <id>
```

Scheduled cycles run in the background while the daemon is up.

---

## Sanity check after bootstrap

```powershell
dg status my-project
```

Look for non-zero counts in:

- **Features**, **workflows**, **data model entities**
- **Validated edges** (zero is fine on day one — they grow with dream cycles)
- **Tensions (active)** — having a few is healthy. Zero usually means scan was too shallow.

---

## Next

Time to actually look at it: **[6. The VS Code extension](06-vs-code-extension.md)**.
