# Graph Relevance Propagation

> End-to-end propagation of per-entity relevance scores from daemon graph-context matching through to evidence item sorting. Includes two-pass anchor pre-scoring: Pass 1 file-path match, Pass 2 targeted feature_ids lookup when _preScoreFeatureId finds a candidate scoring ≥ 0.75. Direct-matched features receive relevance 1.0; merged entities are de-duplicated with relevance upgrades in-place.

**Repository:**   
**Domain:** context-assembly  
**Status:** active  
**Source files:** extensions/vscode/src/context-builder.ts, extensions/vscode/src/daemon-client.ts, src/api/routes.ts  

**Tags:** context-builder, accuracy, graph-distance

