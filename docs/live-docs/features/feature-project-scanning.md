# Project Scanning

> Scans repositories to discover source files and attempts semantic extraction of features, workflows, and data model entities, serving as the high-level onboarding and refresh pipeline for graph population.

**Repository:** dreamgraph  
**Domain:** core  
**Status:** active  
**Source files:** src/tools/scan-project.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_seed_enrichment | feature | related_to | moderate |  |
| feature_graph_bootstrap | feature | related_to | moderate |  |
| feature_api_surface_extraction | feature | related_to | moderate |  |

**Tags:** scan, discovery, llm, onboarding

