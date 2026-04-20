# Per-File Write Mutex for Architect Tools

> Canonical extension-host safety feature for architect local write tools. Serializes concurrent file mutations per target path to prevent racing modify/write operations inside the VS Code extension host.

**Repository:**   
**Domain:** core  
**Status:** active  
**Source files:** extensions/vscode/src/local-tools.ts, extensions/vscode/src/command-runner.ts  

## Relationships

| Target | Type | Relationship | Strength | Description |
|--------|------|--------------|----------|-------------|
| feature_vscode_extension | feature | related_to | moderate |  |
| feature_agentic_tool_execution_loop | feature | related_to | moderate |  |

**Tags:** vscode, local-tools, mutex, write-safety, concurrency

