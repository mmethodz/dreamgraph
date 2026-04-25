# Dashboard Surfaces

> Canonical feature for server-hosted and VS Code-embedded DreamGraph dashboard monitoring surfaces. Updated to include schedule deletion handling via explicit schedule_id posting and policy profile selection backed by per-instance config/policies.json active profile switching.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** src/server/dashboard.ts, extensions/vscode/src/dashboard-view.ts, src/instance/policies.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_cognitive_scheduler | feature | related_to | moderate |  |
| policy_management | feature | related_to | moderate |  |
| feature_vscode_extension | feature | related_to | moderate |  |

**Tags:** dashboard, monitoring, ui, canonical, policy-picker, schedule-management

