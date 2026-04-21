# DreamGraph v7.1.0 — El Alarife

DreamGraph is a graph-first cognitive daemon for MCP-enabled development environments. It maintains an instance-scoped knowledge graph of features, workflows, data models, architectural decisions, UI registry elements, and tensions so the graph—not any single file—serves as the system’s source of truth.

## Status

- Current package version: **7.1.0**
- License: **DreamGraph Source-Available Community License v2.0**
- Runtime model: instance-scoped daemon with dashboard, CLI, MCP tools, and VS Code extension integration

## Getting Started

### Prerequisites
- Node.js 20+
- npm
- Optional: PostgreSQL for persistent database-backed deployments
- Optional: VS Code for extension workflows

### Install

#### PowerShell
```powershell
./scripts/install.ps1 -Force
```

#### Bash / WSL
```bash
bash scripts/install.sh --force
```

## Common Commands

```bash
npm run build
npm test
node dist/index.js
node dist/cli/dg.js status <instance>
```

## Architecture at a Glance

DreamGraph has four primary surfaces:

- **Daemon** — the MCP-capable runtime and dashboard host
- **CLI (`dg`)** — instance lifecycle, status, scan, and operational control
- **VS Code extension** — dashboard embedding, chat UX, file-change UX, daemon/client integration
- **Knowledge graph and cognitive pipeline** — features, workflows, data model, ADRs, tensions, dream cycles

For a fuller architectural overview, see `docs/architecture.md`.

## Source Layout

```text
src/
  api/
  cli/
  cognitive/
  config/
  data/
  db/
  instance/
  server/
  tools/
  utils/

extensions/
  vscode/
    src/
      extension.ts
      commands.ts
      dashboard-view.ts
      chat-panel.ts
      daemon-client.ts
      mcp-client.ts
      files-changed-provider.ts
```

## Version Semantics

DreamGraph instance status can show two different version concepts:

- **Created With** — the DreamGraph version recorded when the instance was initialized
- **Daemon Version** — the version of the currently running daemon binary

Those values can differ after upgrades, and that is expected.

## License

This repository is licensed under the **DreamGraph Source-Available Community License v2.0**. See `LICENSE` for the full terms.
