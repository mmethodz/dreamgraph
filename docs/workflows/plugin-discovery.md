# Plugin Discovery Process

> This process identifies and registers available plugins for the DreamGraph system. It scans the extensions directory and loads any compatible plugins.

**Trigger:** Server startup  
**Source files:** src/instance/registry.ts  

## Flowchart

```mermaid
flowchart TD
    S1["Scan Extensions Directory"]
    S2["Load Plugins"]
    S1 --> S2
    S3["Validate Plugins"]
    S2 --> S3
```

## Steps

### 1. Scan Extensions Directory

Look for plugin files in the extensions directory.

### 2. Load Plugins

Load and register each discovered plugin into the system.

### 3. Validate Plugins

Check that each loaded plugin meets the necessary criteria for operation.

