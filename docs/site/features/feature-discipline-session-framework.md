---
title: "Discipline Session Framework"
---

# Discipline Session Framework

> Imposes a phase-governed workflow for autonomous engineering tasks across ingest, audit, plan, execute, and verify phases, with tool gating, artifact tracking, and evidence requirements.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** src/discipline/register.ts, src/discipline/state-machine.ts, src/discipline/session.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| workflow_discipline_task_lifecycle | feature | related_to | moderate |  |
| data_model_discipline_session | feature | related_to | moderate |  |
| data_model_delta_entry | feature | related_to | moderate |  |

**Tags:** discipline, governance, verification

