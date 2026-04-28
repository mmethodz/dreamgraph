# Commands Flow

> Commands — 15 source file(s): src/cli/commands/attach.ts, src/cli/commands/curate.ts, src/cli/commands/enrich.ts, src/cli/commands/export.ts, src/cli/commands/fork.ts, src/cli/commands/init.ts, src/cli/commands/instances.ts, src/cli/commands/lifecycle-ops.ts, src/cli/commands/migrate.ts, src/cli/commands/restart.ts, src/cli/commands/scan.ts, src/cli/commands/schedule.ts, src/cli/commands/start.ts, src/cli/commands/status.ts, src/cli/commands/stop.ts

**Trigger:** Source: src/cli/commands/attach.ts  
**Source files:** src/cli/commands/attach.ts, src/cli/commands/curate.ts, src/cli/commands/enrich.ts, src/cli/commands/export.ts, src/cli/commands/fork.ts, src/cli/commands/init.ts, src/cli/commands/instances.ts, src/cli/commands/lifecycle-ops.ts, src/cli/commands/migrate.ts, src/cli/commands/restart.ts, src/cli/commands/scan.ts, src/cli/commands/schedule.ts, src/cli/commands/start.ts, src/cli/commands/status.ts, src/cli/commands/stop.ts  

## Flowchart

```mermaid
flowchart TD
    S1["attach"]
    S2["curate"]
    S1 --> S2
    S3["enrich"]
    S2 --> S3
    S4["export"]
    S3 --> S4
    S5["fork"]
    S4 --> S5
    S6["init"]
    S5 --> S6
    S7["instances"]
    S6 --> S7
    S8["lifecycle-ops"]
    S7 --> S8
    S9["migrate"]
    S8 --> S9
    S10["restart"]
    S9 --> S10
    S11["scan"]
    S10 --> S11
    S12["schedule"]
    S11 --> S12
    S13["start"]
    S12 --> S13
    S14["status"]
    S13 --> S14
    S15["stop"]
    S14 --> S15
```

## Steps

### 1. attach

Implemented in src/cli/commands/attach.ts

### 2. curate

Implemented in src/cli/commands/curate.ts

### 3. enrich

Implemented in src/cli/commands/enrich.ts

### 4. export

Implemented in src/cli/commands/export.ts

### 5. fork

Implemented in src/cli/commands/fork.ts

### 6. init

Implemented in src/cli/commands/init.ts

### 7. instances

Implemented in src/cli/commands/instances.ts

### 8. lifecycle-ops

Implemented in src/cli/commands/lifecycle-ops.ts

### 9. migrate

Implemented in src/cli/commands/migrate.ts

### 10. restart

Implemented in src/cli/commands/restart.ts

### 11. scan

Implemented in src/cli/commands/scan.ts

### 12. schedule

Implemented in src/cli/commands/schedule.ts

### 13. start

Implemented in src/cli/commands/start.ts

### 14. status

Implemented in src/cli/commands/status.ts

### 15. stop

Implemented in src/cli/commands/stop.ts

