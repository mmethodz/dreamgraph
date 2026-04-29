## DreamGraph v8.2.0 — Bedrock

Bedrock makes the underlying datastore a first-class hub in the knowledge graph. For multi-repo SaaS projects sharing a Postgres backend, the database is now visible, introspectable, and woven into dreams — turning a previously invisible dependency into navigable graph structure.

### Main feature: Datastore-as-Hub

- New first-class **`datastore`** entity type for shared backends (`postgres`, `mysql`, `sqlite`, `mongo`, `redis`, `blob_storage`, `event_bus`, `other`)
- Auto-bootstraps a `datastore:primary` stub when `DATABASE_URL` is configured but no real datastore is registered
- New MCP resource **`system://datastores`** lists registered datastores and their introspected tables
- New MCP tool **`scan_database`** introspects the live schema, applies a denylist (junction tables, `pg_*`, `_prisma_migrations`), and writes `tables[]` + `last_scanned_at` back to `data/datastores.json`
- `scan_database({ create_missing: true })` materializes stub `data_model` entries for kept tables that have no representation, with `status: "introspected"` and a `stored_in` link to the datastore
- Dashboard **Datastores** card with **Sync schema** button surfaces datastore state and last-scan telemetry
- New env var `DG_DB_SCAN_TIMEOUT_MS` (default `30000`) bounds introspection wall time

### New cognitive capabilities

- New dream strategy **`schema_grounding`** proposes:
  - `stored_in` edges from `data_model` entities to their backing `datastore` (exact name match conf 0.85; fuzzy 0.55)
  - `shares_state_with` edges between top-level entities in different repos that touch the same datastore
- New dream strategy **`orphan_bridging`** with hub bias (+0.15 confidence bonus when the bridge target is a datastore hub)
- New tensions **`phantom_entity`** (data_model with no resolvable table) and **`shadow_table`** (table nothing claims)
- `dg curate --targets datastores` (and the default curate run) lists both finding types with suggested actions

### Other changes

- Tool-group keyword sets in the VS Code extension expanded to recognize all snake_case strategy names, cognitive state vocabulary (`REM`, `awake state`, `cognitive violation`), and trigger verbs — the Architect chat now reliably exposes `dream_cycle` and related cognitive tools
- MCP `dream_cycle` zod enum and scheduler `DREAM_STRATEGIES` whitelist extended to include `pgo_wave`, `orphan_bridging`, `schema_grounding` (fixes "REM-only operations in awake state" violation when triggering newer strategies by name)
- New workflow **#17 Connect a Shared Database** in `docs/workflows.md`
- Strategy table in `docs/cognitive-engine.md` updated with `schema_grounding`, `pgo_wave`, and the `orphan_bridging` hub-bias entry
- New `system://datastores` row in `docs/tools-reference.md` resource table

### What changed (versions)

- Core package version updated to `8.2.0`
- CLI/daemon package metadata updated to `8.2.0`
- VS Code extension package metadata updated to `8.2.0`
- Explorer package metadata updated to `8.2.0`
- Root README and installation documentation updated for **v8.2.0 — Bedrock**

### Inert when unconfigured

With no `DATABASE_URL` set:

- The dashboard Datastores card renders a `NOT CONFIGURED` pill
- No datastore stub is auto-seeded
- `schema_grounding` returns `[]` immediately
- The `orphan_bridging` hub-bias bonus is `0`
- Zero impact on non-database instances

### Upgrade notes

- Restart running DreamGraph daemons after upgrading so the v8.2.0 runtime is active
- Reload VS Code windows after updating the extension
- Re-run the installer or rebuild from source to refresh CLI, daemon, Explorer assets, and extension metadata
- (Optional) Set `DATABASE_URL` in the instance's `config/engine.env`, then click **Sync schema** on the dashboard or run `scan_database` from the Architect chat
- For HTTP-backed instances, confirm the active daemon with `dg status <instance>`

### Version

- Release: `v8.2.0 — Bedrock`
- Core package version: `8.2.0`
- CLI/daemon version: `8.2.0`
- VS Code extension version: `8.2.0`
- Explorer version: `8.2.0`
