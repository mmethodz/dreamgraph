# DreamGraph Documentation

> **v5.2.0** — Comprehensive documentation generated from DreamGraph's own knowledge graph.

---

## What is DreamGraph?

DreamGraph is a **cognitive dreaming engine** for MCP knowledge graphs. It speculatively discovers hidden connections between entities, validates them through a strict three-outcome classifier, and builds a persistent, evolving understanding of the systems it observes.

It thinks in cycles: **dream → validate → learn → repeat** — and now schedules its own cognitive work autonomously.

---

## Documentation Map

### [Architecture](architecture.md)
System overview, cognitive states, state machine, promotion pipeline, feature dependency diagram, source layout, data directory, and configuration reference.

### [Cognitive Engine — Deep Dive](cognitive-engine.md)
How the engine thinks: state machine internals, 8 dream strategies, normalization pipeline, speculative memory lifecycle, tension system, adversarial dreaming, causal/temporal analysis, v5.1 capabilities (metacognitive self-tuning, event-driven dreaming, continuous narrative), and v5.2 dream scheduling.

### [Tools Reference](tools-reference.md)
Complete catalog of all **43 MCP tools** (23 cognitive + 20 general) and **15 MCP resources**, with parameters, types, defaults, and descriptions.

### [Data Model](data-model.md)
All **13 data stores**: dream graph, candidate edges, validated edges, tension log, dream history, threat log, archetypes, ADR log, UI registry, fact graph, capabilities, system story, and schedules. Full schemas and relationship map.

### [Workflows](workflows.md)
Step-by-step flows for all **10 operational processes**: dream cycle, nightmare cycle, normalization pipeline, tension lifecycle, edge promotion, federation, interruption protocol, living docs export, insight solidification, and schedule execution.

### [The DreamGraph Chronicle](narrative.md)
The system's auto-generated autobiography — 6 chapters covering 60 dream cycles, cumulative statistics, weekly digest, and trend analysis. Written by DreamGraph about itself.

---

## Quick Start

### Installation

```bash
npm install
npm run build
```

### MCP Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "dreamgraph": {
      "command": "node",
      "args": ["path/to/dreamgraph/dist/index.js"],
      "env": {
        "DREAMGRAPH_DATA_DIR": "./data"
      }
    }
  }
}
```

### First Dream Cycle

```
dream_cycle(strategy="all", max_dreams=20)
```

### Schedule Recurring Dreams

```
schedule_dream(action="dream_cycle", trigger_type="interval", interval_seconds=3600, strategy="tension_directed")
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
| Dream strategies | 8 |
| MCP tools | 43 |
| MCP resources | 15 |
| Data stores | 13 |
| Workflows | 10 |
| Features | 27 |
| Promotion threshold | 0.62 confidence |
| Calibrated accuracy | 97.5%+ above threshold |

---

## License

MIT
