---
title: "Seed Data Enrichment"
---

# Seed Data Enrichment

> Accepts curated structured entities and merges or replaces them into the persisted fact graph, acting as the canonical write path for features, workflows, data model entities, and capabilities.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** src/tools/enrich-seed-data.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_seed_graph_storage | feature | related_to | moderate |  |
| feature_project_scanning | feature | related_to | moderate |  |
| feature_query_resource | feature | related_to | moderate |  |

**Tags:** enrichment, graph, write-path

