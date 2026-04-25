## DreamGraph v8.0.0 — Vishnu

DreamGraph is a graph-first cognitive daemon for MCP-enabled development environments. It combines a daemon, CLI, VS Code extension, dashboard, MCP tool surface, and a persistent knowledge graph so the graph—not any single file or one-off code read—becomes the system’s source of truth.

DreamGraph works with single repositories, monorepos, and multi-repository systems. It can build graph links across repos that share workflows, APIs, databases, infrastructure, or ownership boundaries.

You can use DreamGraph on a multi-repo product with frontend, backend, mobile, and a shared Postgres/Supabase schema. It can reason across repo boundaries and inspect the live DB schema directly.

### Highlights
- Improved chat history handling to reduce context bloat
- Improved autonomy flow
- Fixed VSIX package size issues where the build had packaged complete `node_modules`
- Refined graph initialization behavior to exclude generated files more precisely
- Expanded tool-group keyword routing for execution, mutation, and repository-search style requests
- Dozens of smaller fixes and maintainability improvements
- Refactored monolithic areas into smaller units for maintainability

### What’s included
- DreamGraph daemon runtime with stdio and HTTP transport modes
- MCP tool surface for graph queries, enrichment, ADRs, workflows, source inspection, cognition, and remediation
- `dg` CLI for instance lifecycle and graph operations
- VS Code extension for chat, dashboard, changed-files view, daemon connection, and local support tools
- Persistent knowledge graph and cognitive engine with dream cycles, tensions, and validated relationships

### Documentation and onboarding improvements
- Rebuilt the root README
- Clarified the actual instance initialization and daemon startup flows
- Expanded prerequisites and quick-start guidance
- Improved positioning for single-repo, monorepo, and multi-repo usage

### Upgrade notes
- Restart running DreamGraph daemons after upgrading so the updated runtime is active
- Reload VS Code windows after updating the extension
- For HTTP-backed instances, confirm the active daemon with `dg status <instance>`

### Version
- Core package version: `8.0.0`
- VS Code extension version: `8.0.0`
