# 11. Multiple repos and monorepos

> **TL;DR** — One DreamGraph instance can have many attached repos. The graph spans all of them. Use this for products that have separate frontend/backend/mobile/infra repositories.

DreamGraph has two reasonable shapes for multi-repo setups:

1. **One instance, many repos** — for a single product split across repositories (most common).
2. **One instance per repo** — for unrelated projects.

You almost never want one instance per repo when the repos belong to the same product. The whole point is that the graph crosses boundaries.

---

## Shape 1 — One product, many repos

Use when repos share workflows, APIs, a database schema, or ownership.

```powershell
# Create one instance for the product
dg init --name acme-platform --transport http --port 8200

# Attach each repo
dg attach C:\code\acme-frontend  --instance acme-platform
dg attach C:\code\acme-backend   --instance acme-platform
dg attach C:\code\acme-mobile    --instance acme-platform
dg attach C:\code\acme-infra     --instance acme-platform

# Bootstrap each one
dg scan acme-platform
dg enrich acme-platform
```

What you get:

- Features can reference any repo's source files.
- Workflows can span repos (e.g. *checkout* starts in the mobile app, hits the backend, writes Postgres, triggers an infra job).
- `read_source_code` knows which repo a path belongs to.
- `git_log` / `git_blame` work on whichever repo the path resolves to.

In the Explorer, the filters panel lets you narrow by repository so you can focus on one slice at a time without losing the cross-repo edges.

---

## Shape 2 — Monorepo (single repo, many sub-projects)

A monorepo is just one repo to DreamGraph. Treat it normally:

```powershell
dg init --name acme-monorepo --project C:\code\acme-monorepo --transport http --port 8200
dg scan acme-monorepo --depth deep
```

Tips:

- Use deep scans. Monorepos have nested projects DreamGraph might miss otherwise.
- The `domain` field on features ends up matching your top-level monorepo packages (`apps/web`, `apps/api`, `packages/shared`, etc.). Use that as a filter in the Explorer.
- Run `dg curate` more often. Monorepos generate more duplicate-looking entities and the curator helps.

---

## Shape 3 — Genuinely unrelated projects

If you have two projects that share nothing — a personal blog and a work backend — give them separate instances on separate ports:

```powershell
dg init --name blog       --project C:\code\blog       --port 8210
dg init --name work-api   --project C:\code\work-api   --port 8220

dg start blog --http
dg start work-api --http
```

Switch the active instance per shell:

```powershell
dg instances switch blog
dg status                # implicit: uses active instance
```

Or always pass the name:

```powershell
dg status work-api
```

---

## Switching what VS Code is connected to

The VS Code extension connects to one daemon at a time. If you have several daemons running on different ports, switch via:

> `Ctrl+Shift+P` → **DreamGraph: Connect to Daemon** → pick from the discovered list, or paste a URL.

This is per VS Code window. You can have two windows open against two different daemons.

---

## Cross-repo edge examples

A few realistic edges DreamGraph might validate in a multi-repo product:

- *workflow:* `checkout` → *touches* → `acme-mobile/src/CheckoutScreen.tsx`
- *workflow:* `checkout` → *touches* → `acme-backend/src/orders/place-order.ts`
- *workflow:* `checkout` → *writes* → `data:orders` (entity in `data_model.json`)
- *feature:* `payment-retries` → *implemented_in* → `acme-backend` AND `acme-infra/jobs/retry-worker.tf`
- *ADR:* `adr_2026_distributed_sql` → *applies_to* → all four repos

The graph holds these. The Architect quotes them when you ask cross-cutting questions.

---

## Federation: sharing patterns across instances

If you have many instances and want one to learn from another's patterns:

```
export_dream_archetypes  →  archive of validated patterns
import_dream_archetypes  →  load into a different instance
```

These are MCP tools, callable from the Architect or any MCP client. Useful when you want a new project to inherit the architectural intuitions of a mature one.

---

## Limits and caveats

- **Performance scales with the largest single repo.** Three medium repos behave like one medium repo. One huge repo + small ones still feels like a huge repo at scan time.
- **Port collisions.** When running several daemons, give each an explicit `--port`. Auto-allocation works but `dg status` is the source of truth for which port a daemon is actually on.
- **Path resolution.** All `--project` paths must be absolute. Relative paths get rejected.
- **Detaching a repo doesn't delete its graph entries.** Run `dg curate` afterward if you want orphaned entities cleaned up.

---

## Next

When something doesn't go right: **[12. Troubleshooting & FAQ](12-troubleshooting-faq.md)**.
