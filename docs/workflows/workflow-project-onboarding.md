# Project Onboarding and Enrichment

> High-level onboarding workflow that scans the repository, bootstraps or enriches the fact graph, and rebuilds indexable architectural memory for later querying and cognition.

**Trigger:**   
**Source files:** src/tools/init-graph.ts, src/tools/scan-project.ts, src/tools/enrich-seed-data.ts  

## Flowchart

```mermaid
flowchart TD
    S1["Discover repository files and coarse project structure."]
    S2["Generate a first-pass graph using init_graph when no seed memory exists or a reset is required."]
    S1 --> S2
    S3["Run scan_project to attempt semantic extraction of features, workflows, and data model entities."]
    S2 --> S3
    S4["Merge curated or manually derived knowledge into the seed graph through enrich_seed_data."]
    S3 --> S4
    S5["Rebuild indexes and expose resulting resources for query and downstream cognitive use."]
    S4 --> S5
```

## Steps

### 1. Discover repository files and coarse project structure.

### 2. Generate a first-pass graph using init_graph when no seed memory exists or a reset is required.

### 3. Run scan_project to attempt semantic extraction of features, workflows, and data model entities.

### 4. Merge curated or manually derived knowledge into the seed graph through enrich_seed_data.

### 5. Rebuild indexes and expose resulting resources for query and downstream cognitive use.

