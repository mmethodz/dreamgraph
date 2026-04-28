# DreamGraph Documentation

> **v8.0.0 "Vishnu"** — Documentation generated from DreamGraph's own knowledge graph.

---

## What is DreamGraph?

DreamGraph is a model-agnostic, graph-grounded development agent. It builds a validated knowledge graph from code, workflows, schemas, and runtime signals, then continuously explores, verifies, and refines relationships through speculative reasoning. It ships with a **CLI** (`dg`), an **MCP daemon**, a **VS Code extension** (chat, dashboard, Explorer), and a **web dashboard**.

It thinks in cycles: **dream → validate → learn → repeat** — and schedules its own cognitive work autonomously.

---

## Documentation Map

| Document | Coverage |
|---|---|
| [Architecture](architecture.md) | System architecture, Mermaid diagrams, source layout, data directory, config tables |
| [Cognitive Engine](cognitive-engine.md) | State machine, 10 dream strategies, normalization, tensions, adversarial, temporal, metacognition, scheduling |
| [Architect 5-Slice Implementation Story](architect-5-slice-implementation-story.md) | Detailed implementation story for cognitive output rendering slices 1–5 in the VS Code extension |
| [LLM Setup](setup-llm.md) | Configure providers, API keys, and engine settings for DreamGraph instances |
| [Tools Reference](tools-reference.md) | Complete 69-tool catalog with parameter tables and 26 resource URIs |
| [Data Model](data-model.md) | All 21 data store schemas and relationship map |
| [Workflows](workflows.md) | 16 step-by-step operational process flows |
| [The Chronicle](narrative.md) | Auto-generated system autobiography — written by DreamGraph about itself |
| [VS Code Extension](../extensions/vscode/) | Chat, Dashboard, Explorer (graph + curated mutations), Files Changed panels — installed automatically by the global install script |

---

## Quick Start

```bash
# Install (builds server, CLI, and VS Code extension)
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
.\scripts\install.ps1 -Force    # Windows
# bash scripts/install.sh       # Linux / macOS

# Create and start
dg init my-project
dg attach my-project /path/to/repo
dg start my-project --http

# Open in VS Code — extension auto-connects
code /path/to/repo
```

After starting the daemon, configure your LLM (dashboard or `engine.env`), then run `dg scan <name>` to bootstrap the knowledge graph — scan, dream, ADR discovery, and follow-up scheduling all happen in one command.

---

## Key Numbers

| Metric | Value |
|---|---|
| MCP tools | 69 (28 cognitive · 31 sense/knowledge · 10 discipline) |
| MCP resources | 26 |
| Dream strategies | 10 (auto-adapting) |
| CLI commands | 16 |
| Cognitive states | 5 |
| Data stores | 20 |
| Workflows | 16 |
| Promotion threshold | ≥ 0.62 combined confidence |

---

## License

DreamGraph License v1.0 (BSL-based) — see [LICENSE](../LICENSE)
