# Project Scan Enrichment

> Deep project scan that classifies source structure and enriches feature, workflow, and data-model seeds from real source areas.

**Trigger:** scan_project invocation  
**Source files:** src/tools/scan-project.ts, src/tools/scanner-artifact-policy.ts, src/tools/structural-generators.ts  

## Flowchart

```mermaid
flowchart TD
    S1["Traverse source tree"]
    S2["Exclude generated artifacts and caches"]
    S1 --> S2
    S3["Classify files into structural groups"]
    S2 --> S3
    S4["Enrich features, workflows, and data model"]
    S3 --> S4
```

## Steps

### 1. Traverse source tree

### 2. Exclude generated artifacts and caches

### 3. Classify files into structural groups

### 4. Enrich features, workflows, and data model

