# Semantic Anchor Promotion

> Resolves editor positions into canonical graph-backed semantic anchors. Five-pass rebuild complete: (1) focused_excerpt now calls _trimActiveFile instead of getText(); (2) _promoteAnchor updates label to canonical entity name after promotion; (3) _collectEvidenceItems uses per-entity relevance from graphContext via aggregateRelevance(max); (4) _promoteAnchor uses scored ranking (exact=1.0, prefix=0.75, substring=0.5, threshold=0.5) across all entity kinds; (5) _applyBudget private helper consolidates the budget-allocation loop previously duplicated between buildReasoningPacket and assembleContextBlock. All five changes compiled and verified.

**Repository:**   
**Domain:** core  
**Status:** active  

**Tags:** context-assembly, adr-046, anchor-lifecycle, label-sync, relevance-propagation, scored-promotion, budget-consolidation

