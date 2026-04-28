## DreamGraph v8.1.0 — Atlas

Atlas makes DreamGraph Explorer a production-ready part of the DreamGraph experience. The release focuses on turning the knowledge graph from a background intelligence layer into a visible, navigable, and safely actionable interface inside the Architect VS Code extension and daemon-served Explorer surface.

### Main feature: DreamGraph Explorer

- Promotes **DreamGraph Explorer** to production-ready/stable status
- Adds an interactive graph exploration experience for inspecting DreamGraph features, workflows, entities, and relationships
- Integrates Explorer into the Architect VS Code extension UI as a first-class surface
- Supports curated mutation workflows so graph changes can be initiated from a structured UI path rather than ad-hoc edits
- Improves graph browsing ergonomics for feature discovery, workflow inspection, and architectural orientation

### What changed

- Core package version updated to `8.1.0`
- CLI/daemon package metadata updated to `8.1.0`
- VS Code extension package metadata updated to `8.1.0`
- Explorer package metadata updated to `8.1.0`
- Root README and installation documentation updated for **v8.1.0 — Atlas**
- Documentation landing pages updated to describe Atlas and the production-ready Explorer
- Explorer graph entities promoted to `production_ready` / `stable` in the DreamGraph knowledge graph

### Included components

- DreamGraph daemon runtime with stdio and HTTP transport modes
- MCP tool surface for graph queries, enrichment, ADRs, workflows, source inspection, cognition, and remediation
- `dg` CLI for instance lifecycle and graph operations
- VS Code extension with chat, dashboard, changed-files context, daemon connection, and DreamGraph Explorer
- DreamGraph Explorer for interactive graph browsing and curated graph mutations
- Persistent knowledge graph and cognitive engine with dream cycles, tensions, and validated relationships

### Upgrade notes

- Restart running DreamGraph daemons after upgrading so the v8.1.0 runtime is active
- Reload VS Code windows after updating the extension
- Re-run the installer or rebuild from source to refresh CLI, daemon, Explorer assets, and extension metadata
- For HTTP-backed instances, confirm the active daemon with `dg status <instance>`

### Version

- Release: `v8.1.0 — Atlas`
- Core package version: `8.1.0`
- CLI/daemon version: `8.1.0`
- VS Code extension version: `8.1.0`
- Explorer version: `8.1.0`
