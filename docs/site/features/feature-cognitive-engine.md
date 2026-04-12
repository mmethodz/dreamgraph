---
title: "Cognitive Engine"
---

# Cognitive Engine

> Runs the DreamGraph cognitive state machine and persistence layer, managing awake, REM, normalizing, nightmare, and lucid-adjacent transitions while coordinating dream graph I/O and introspection.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** src/cognitive/engine.ts, src/cognitive/register.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| workflow_dream_cycle | feature | related_to | moderate |  |
| feature_lucid_dreaming | feature | related_to | moderate |  |
| feature_adversarial_scan | feature | related_to | moderate |  |
| feature_cognitive_scheduler | feature | related_to | moderate |  |
| data_model_tension_signal | feature | related_to | moderate |  |

**Tags:** cognitive, state-machine, dreaming

