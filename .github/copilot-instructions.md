# DreamGraph Development Rules

## Documentation Maintenance Rule

**Rule:** All auto-generated documentation in `docs/` and the project root `README.md` MUST be kept in sync with the codebase during every development phase.

### When to Update Documentation

Update documentation **immediately** after any of the following changes:

1. **New or removed MCP tools** — Update `docs/tools-reference.md` (parameter tables, counts) and `README.md` (tool tables, counts)
2. **New or removed MCP resources** — Update `docs/tools-reference.md` (resource table) and `README.md` (resource table)
3. **New data stores** — Update `docs/data-model.md` (schema, relationship map) and `README.md` (data directory listing)
4. **New cognitive capabilities** — Update `docs/cognitive-engine.md` (capability section), `README.md` (capabilities list), and `docs/architecture.md` (Mermaid diagrams)
5. **New workflows or processes** — Update `docs/workflows.md` (step-by-step flow)
6. **Configuration changes** — Update `docs/architecture.md` (config table) and `README.md` (env vars table)
7. **Source file additions/removals** — Update `docs/architecture.md` (source layout) and `README.md` (source layout)
8. **Version bumps** — Update version references in `docs/README.md`, `docs/architecture.md`, and `README.md` title

### Numbers to Keep Consistent

These counts appear in multiple files and must match across all of them:

| Metric | Files Where It Appears |
|--------|----------------------|
| Total MCP tools | `docs/README.md`, `docs/tools-reference.md`, `docs/architecture.md` (Mermaid), `README.md` |
| Cognitive tools count | `docs/README.md`, `docs/tools-reference.md`, `README.md` |
| MCP resources count | `docs/README.md`, `docs/tools-reference.md`, `docs/architecture.md` (Mermaid), `README.md` |
| Data stores count | `docs/README.md`, `docs/data-model.md` |
| Workflows count | `docs/README.md`, `docs/workflows.md` |
| Version number | `docs/README.md`, `docs/architecture.md`, `README.md` title, `package.json`, `src/config/config.ts` |

### Documentation File Responsibilities

| File | What It Covers |
|------|---------------|
| `README.md` (root) | Project overview, all 11 capabilities, getting started, tool/resource tables, env vars, architecture diagram, vocabulary |
| `docs/README.md` | Documentation index with version, key numbers, quick start |
| `docs/architecture.md` | System architecture, Mermaid diagrams, source layout, data directory, config table |
| `docs/cognitive-engine.md` | Deep dive: state machine, strategies, normalization, memory, tensions, all cognitive subsystems |
| `docs/tools-reference.md` | Complete tool catalog with parameter tables, resource URI table |
| `docs/data-model.md` | All data store schemas, relationship Mermaid map |
| `docs/workflows.md` | Step-by-step operational process flows |
| `docs/narrative.md` | Auto-generated system chronicle (updated by dream cycles, not manually) |

### Checklist Template

When implementing a feature, use this checklist:

- [ ] `package.json` version updated
- [ ] `src/config/config.ts` version updated
- [ ] `docs/README.md` version and counts updated
- [ ] `docs/architecture.md` version, diagrams, source layout, data dir, config table updated
- [ ] `docs/tools-reference.md` tool/resource tables updated
- [ ] `docs/data-model.md` schema and relationship map updated (if new data store)
- [ ] `docs/workflows.md` workflow added (if new process)
- [ ] `docs/cognitive-engine.md` capability section added (if new cognitive feature)
- [ ] `README.md` (root) all sections updated: title version, capabilities, tool tables, resource table, source layout, data dir, env vars, vocabulary
- [ ] Build verified clean (`npm run build`)
