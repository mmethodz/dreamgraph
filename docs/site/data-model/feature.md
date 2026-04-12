---
title: "Feature"
---

# Feature

> Defines a feature within the DreamGraph system, including its metadata, status, and relationships to other features or workflows. Features are essential for building the knowledge graph.

**Table:** `feature`  
**Storage:** json  

## Fields

| Field | Type | Description |
|-------|------|-------------|
| id | string | Unique identifier for the feature. |
| status | string | Current status of the feature. |

## Relationships

| Target | Type | Description |
|--------|------|-------------|
| workflow | links_to | - |

