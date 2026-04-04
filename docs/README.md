# DreamGraph Documentation

> **v5.1.0** — Comprehensive documentation generated from DreamGraph's own knowledge graph.

---

## What is DreamGraph?

DreamGraph is a **cognitive dreaming engine** for MCP knowledge graphs. It speculatively discovers hidden connections between entities, validates them through a strict three-outcome classifier, and builds a persistent, evolving understanding of the systems it observes.

It thinks in cycles: **dream → validate → learn → repeat**.

---

## Documentation Map

### [Architecture](architecture.md)
System overview, cognitive states, state machine, promotion pipeline, feature dependency diagram, source layout, data directory, and configuration reference.

### [Cognitive Engine — Deep Dive](cognitive-engine.md)
How the engine thinks: state machine internals, 8 dream strategies, normalization pipeline, speculative memory lifecycle, tension system, adversarial dreaming, causal/temporal analysis, and all v5.1 capabilities (metacognitive self-tuning, event-driven dreaming, continuous narrative).

### [Tools Reference](tools-reference.md)
Complete catalog of all **37 MCP tools** (17 cognitive + 20 general) and **13 MCP resources**, with parameters, types, defaults, and descriptions.

### [Data Model](data-model.md)
All **12 data stores**: dream graph, candidate edges, validated edges, tension log, dream history, threat log, archetypes, ADR log, UI registry, fact graph, capabilities, and system story. Full schemas and relationship map.

### [Workflows](workflows.md)
Step-by-step flows for all **9 operational processes**: dream cycle, nightmare cycle, normalization pipeline, tension lifecycle, edge promotion, federation, interruption protocol, living docs export, and insight solidification.

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

### Check Status

```
cognitive_status()
```

### Read What It Learned

```
get_system_narrative(depth="technical")
```

---

## Key Numbers (after 60 cycles)

| Metric | Value |
|--------|-------|
| Validated connections | 208 |
| Dream strategies | 8 |
| MCP tools | 37 |
| MCP resources | 13 |
| Data stores | 12 |
| Workflows | 9 |
| Features | 27 |
| Promotion threshold | 0.62 confidence |
| Calibrated accuracy | 97.5%+ above threshold |

---

## License

MIT
