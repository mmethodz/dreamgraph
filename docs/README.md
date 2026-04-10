# DreamGraph Documentation

> **v6.2.0 "La Catedral"** — Comprehensive documentation generated from DreamGraph's own knowledge graph.

---

## What is DreamGraph?

DreamGraph is a **daemon-backed cognitive layer** and dreaming engine for software systems that builds a validated knowledge graph from code, workflows, schemas, and runtime signals, then continuously explores and verifies new relationships. It includes a built-in **web dashboard** for browser-based monitoring, schedule management, and runtime configuration.

It thinks in cycles: **dream → validate → learn → repeat** — and now schedules its own cognitive work autonomously.

---

## Documentation Map

### [Architecture](architecture.md)
System overview, cognitive states, state machine, promotion pipeline, feature dependency diagram, source layout, data directory, and configuration reference.

### [Cognitive Engine — Deep Dive](cognitive-engine.md)
How the engine thinks: state machine internals, 10 dream strategies (incl. LLM dream + PGO wave), normalization pipeline, speculative memory lifecycle, tension system, adversarial dreaming, causal/temporal analysis, v5.1 capabilities (metacognitive self-tuning, event-driven dreaming, continuous narrative), and v5.2 dream scheduling.

### [Tools Reference](tools-reference.md)
Complete catalog of all **62 MCP tools** (28 cognitive + 25 general + 9 discipline) and **25 MCP resources**, with parameters, types, defaults, and descriptions.

### [Data Model](data-model.md)
All **15 data stores**: dream graph, candidate edges, validated edges, tension log, dream history, threat log, archetypes, ADR log, UI registry, fact graph, capabilities, system story, schedules, API surface, and lucid log. Full schemas and relationship map.

### [Workflows](workflows.md)
Step-by-step flows for all **14 operational processes**: dream cycle, nightmare cycle, normalization pipeline, tension lifecycle, edge promotion, federation, interruption protocol, living docs export, insight solidification, schedule execution, global install, daemon start, daemon stop, and dashboard request lifecycle.

### [The DreamGraph Chronicle](narrative.md)
The system's auto-generated autobiography — 6 chapters covering 60 dream cycles, cumulative statistics, weekly digest, and trend analysis. Written by DreamGraph about itself.

### Real-World Case Studies
The root [README](../README.md) includes three proof-of-concept stories:
- **Wake-Up Report** — Overnight autonomous bug-hunting on a production B2B SaaS (15 cycles, 8 tensions resolved, 0 critical bugs remaining)
- **The SiteLedger Story** — 1,243 dream cycles building a validated knowledge graph of a Finnish construction platform (491 connections, 32K edges rejected)
- **Cross-Platform Transcompilation** — One knowledge graph, four platforms (MAUI mobile → WPF desktop → PySide6 desktop → CLI) with zero guidance and 100% behavioral integrity

---

## Quick Start

### Installation

**From source (dev mode):**

```bash
npm install
npm run build
```

**Global install (adds `dg` and `dreamgraph` to PATH):**

```powershell
# Windows PowerShell
.\scripts\install.ps1

# Linux / macOS
bash scripts/install.sh
```

After install, `dg --version` and `dreamgraph --help` work from any directory.

### Create an Instance and Start the Daemon

```bash
# Create a UUID-scoped instance bound to your project
dg init --name my-project --project /path/to/my-repo

# Start the HTTP daemon
dg start my-project

# Check status
dg status my-project
```

### Connect Your IDE

The daemon exposes Streamable HTTP at `http://localhost:<port>/mcp`. Point your MCP client at it:

**VS Code / Cursor** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "dreamgraph": {
      "type": "http",
      "url": "http://localhost:8500/mcp"
    }
  }
}
```

> STDIO mode is also available via `dg start my-project --foreground` for single-client setups where the MCP client manages the process.

### First Dream Cycle

```
dream_cycle(strategy="all", max_dreams=100)
```

### Browse the Web Dashboard

Once the daemon is running, open `http://localhost:<port>/` in your browser to access the web dashboard — live cognitive status, schedule management, runtime configuration, and knowledge graph documentation.

### Schedule Recurring Dreams

```
schedule_dream(name="nightly", action="dream_cycle", trigger_type="interval", interval_seconds=300, max_runs=50)
```

### Check Status

```
cognitive_status()
```

### Read What It Learned

```
get_system_narrative(depth="technical")
```

---

## Key Numbers (after 90 cycles)

| Metric | Value |
|--------|-------|
| Validated connections | 280+ |
| Dream strategies | 10 |
| MCP tools | 62 |
| MCP resources | 25 |
| Data stores | 20 |
| Workflows | 14 |
| Features | 36 |
| CLI commands | 14 |
| Promotion threshold | 0.62 confidence |
| Calibrated accuracy | 97.5%+ above threshold |

---

## License

DreamGraph License v1.0
