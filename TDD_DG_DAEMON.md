# TDD: `dg start/stop` Daemon Management & Global Binary Installation

**DreamGraph v6.1.0 "La Catedral"**
**Status:** Implementation-Ready
**Date:** 2026-04-06

---

## 1. Executive Summary

This TDD specifies three interconnected features:

1. **`dg start / stop / restart`** — Spawn and manage DreamGraph MCP server processes as background daemons, with PID tracking, health verification, port collision detection, lock-file safety, process ownership validation, log rotation, crash detection, version mismatch warnings, and machine-readable `--json` output.
2. **Global binary installation** — Deploy the compiled DreamGraph server to `~/.dreamgraph/bin/` so `dg` and `dreamgraph` are available from any directory regardless of source checkout.
3. **Install scripts** — One-command install for PowerShell (Windows) and Bash (Linux/macOS).

---

## 2. Architecture Overview

### 2.1 Current State

```
Source repo (dreamgraph/)
├── dist/                      ← tsc output
│   ├── index.js               ← dreamgraph entry (stdio|http)
│   └── cli/dg.js              ← dg CLI entry
├── package.json               ← bin: { dreamgraph, dg }
└── src/
    ├── index.ts               ← parseArgs → startStdio() | startHTTP()
    ├── cli/dg.ts              ← 10 commands, no start/stop
    ├── instance/lifecycle.ts  ← resolves DREAMGRAPH_INSTANCE_UUID
    └── server/server.ts       ← createServer(), SIGINT/SIGTERM handlers
```

- **Server supports**: stdio (default) and Streamable HTTP (`--transport http --port N`)
- **Instance resolution**: `DREAMGRAPH_INSTANCE_UUID` env var → `loadInstance(uuid)` → `InstanceScope`
- **No daemon infrastructure exists**: no PID files, no health checks, no start/stop commands

### 2.2 Target State

```
~/.dreamgraph/                     ← DREAMGRAPH_MASTER_DIR
├── bin/                           ← NEW — global binary installation
│   ├── dist/                      ← compiled JS from source repo
│   │   ├── index.js
│   │   ├── cli/dg.js
│   │   └── ... (full dist tree)
│   ├── node_modules/              ← production dependencies
│   └── package.json               ← minimal manifest for node_modules
├── instances.json                 ← master registry
├── templates/
│   └── default/                   ← data file templates
├── <uuid>/                        ← instance directory
│   ├── instance.json
│   ├── config/
│   │   ├── mcp.json
│   │   ├── policies.json
│   │   └── schema_version.json
│   ├── data/
│   ├── runtime/
│   │   ├── server.json            ← NEW — rich PID + metadata file
│   │   ├── server.lock            ← NEW — start operation lock
│   │   ├── locks/
│   │   ├── cache/
│   │   └── temp/
│   ├── logs/
│   │   ├── server.log             ← NEW — stdout/stderr capture
│   │   ├── server.log.1           ← NEW — rotated log (max 10 MB)
│   │   └── ...
│   └── exports/
└── ...
```

---

## 3. Feature 1: `dg start / stop / restart`

### 3.1 Command Specifications

#### `dg start <query> [--http] [--port <n>] [--foreground]`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `<query>` | positional | required | UUID or instance name |
| `--http` | flag | false | Use Streamable HTTP transport (default: stdio) |
| `--port` | number | 8100 | Port for HTTP mode |
| `--foreground` | flag | false | Run in foreground (don't detach) |
| `--json` | flag | false | Machine-readable JSON output (for scripting) |
| `--master-dir` | path | `~/.dreamgraph` | Override master directory |

**Behavior:**

1. Resolve instance by `<query>` via `findInstance(registry, query)`
2. Verify instance status is `"active"` (not archived/corrupted)
3. **Version mismatch check** (NEW):
   - Read `~/.dreamgraph/bin/version.json` → `runtimeVersion`
   - Compare against CLI's own version (`config.server.version`)
   - If mismatch → print warning:
     ```
     ⚠ CLI version (6.2.0) differs from installed runtime (6.1.0)
       Run install script to update, or use --foreground for local dev.
     ```
   - Continue (warning only, not blocking)
4. **Acquire start lock** (NEW):
   - Create `runtime/server.lock` with advisory file lock
   - If lock already held → print error: "Another start operation is in progress" and exit 1
   - Lock released automatically at end of start (or on error)
   - Prevents race conditions from concurrent `dg start` calls
5. Check if already running:
   - Read `runtime/server.json` if it exists
   - Verify PID is alive (`process.kill(pid, 0)`)
   - **Validate process ownership** (NEW): confirm stored metadata matches
   - If alive AND owned → print error: "Instance already running (PID <pid>)" and exit 1
   - If stale PID file → clean up (delete runtime files) and continue
6. **Port collision detection** (NEW, HTTP mode only):
   - Before spawning, probe the target port with `net.createServer().listen()`
   - If `EADDRINUSE` → auto-increment port up to `startPort + 10`
   - Use `findAvailablePort(requestedPort)` → returns first free port
   - If all 10 attempts fail → print error: "No available port in range <start>-<start+10>" and exit 1
   - If auto-incremented → print notice: "Port <requested> in use, using <actual> instead"
7. Determine binary path:
   - If `~/.dreamgraph/bin/dist/index.js` exists → use it (global install)
   - Else → use `require.resolve("dreamgraph")` or fall back to local `./dist/index.js`
8. Spawn server process:
   ```
   node <binPath>/dist/index.js [--transport http [--port <n>]]
   ```
   With environment:
   ```
   DREAMGRAPH_INSTANCE_UUID=<uuid>
   DREAMGRAPH_MASTER_DIR=<masterDir>
   ```
9. Detach: `child_process.spawn()` with `{ detached: true, stdio: ['ignore', logFd, logFd] }`
   - `logFd` = file descriptor for `<instanceRoot>/logs/server.log`
   - **Log rotation** (NEW): before opening, rotate if `server.log` > 10 MB
   - Call `child.unref()` so parent can exit
10. Write **rich metadata file** `runtime/server.json` (NEW, replaces plain PID file):
    ```json
    {
      "pid": 12345,
      "uuid": "abc-def-...",
      "command": "dreamgraph",
      "bin_path": "/home/user/.dreamgraph/bin/dist/index.js",
      "transport": "http",
      "port": 8100,
      "started_at": "2026-04-06T10:30:00.000Z",
      "version": "6.1.0"
    }
    ```
11. If HTTP mode, health-check loop:
    - Poll `http://localhost:<port>/health` every 500ms, max 10 attempts
    - On success → print "Instance <name> started (PID <pid>, HTTP :<port>)"
    - On timeout → read last 5 lines of `logs/server.log` and display as diagnostic
12. If stdio mode → print "Instance <name> started (PID <pid>, stdio)"
13. Update `instance.json` → `last_active_at` = now
14. Update registry → `last_active_at` = now
15. Release start lock
16. **JSON output** (NEW): if `--json` flag:
    ```json
    {
      "status": "started",
      "pid": 12345,
      "uuid": "abc-def-...",
      "name": "weather-app",
      "transport": "http",
      "port": 8100,
      "bin_path": "/home/user/.dreamgraph/bin/dist/index.js",
      "version": "6.1.0"
    }
    ```
    When `--json` is set, suppress all human-readable output; emit only the JSON object to stdout.

**`--foreground` mode:**
- Skip detach, run in current process (useful for debugging)
- **Debug diagnostics** (NEW): print resolved paths and env before starting:
  ```
  [debug] Instance:   abc-def-... (weather-app)
  [debug] Bin path:   ~/.dreamgraph/bin/dist/index.js
  [debug] Transport:  http
  [debug] Port:       8100
  [debug] Data dir:   ~/.dreamgraph/abc-def-.../data
  [debug] Env:
           DREAMGRAPH_INSTANCE_UUID=abc-def-...
           DREAMGRAPH_MASTER_DIR=~/.dreamgraph
  ```
- stdout/stderr go to terminal directly
- SIGINT/SIGTERM handled normally (triggers `stopScheduler()`)

#### `dg stop <query> [--force] [--timeout <ms>]`

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `<query>` | positional | required | UUID or instance name |
| `--force` | flag | false | Send SIGKILL immediately |
| `--timeout` | number | 5000 | Graceful shutdown timeout in ms |
| `--json` | flag | false | Machine-readable JSON output |
| `--master-dir` | path | `~/.dreamgraph` | Override master directory |

**Behavior:**

1. Resolve instance by `<query>` via `findInstance(registry, query)`
2. Read `runtime/server.json`:
   - If missing → print "Instance <name> is not running" and exit 0
3. Parse PID and metadata from file
4. Check if PID is alive:
   - If dead → clean up runtime files, print "Instance not running (stale PID cleaned)" and exit 0
5. **Validate process ownership** (NEW):
   - Verify `server.json.uuid` matches the resolved instance UUID
   - Verify `server.json.command === "dreamgraph"`
   - On mismatch → print error: "PID <pid> does not belong to this instance (possible PID reuse). Use --force to override." and exit 1
   - `--force` skips ownership check
6. Send signal:
   - Default: `process.kill(pid, 'SIGTERM')` (graceful — triggers `stopScheduler()`)
   - `--force`: `process.kill(pid, 'SIGKILL')` (immediate)
7. Wait for process to exit:
   - Poll `process.kill(pid, 0)` every 200ms up to `--timeout`
   - On exit → clean up runtime files, print "Instance <name> stopped"
   - On timeout → prompt: "Process didn't exit. Send SIGKILL?" → if yes, `SIGKILL` then clean up
8. **Graceful shutdown confirmation** (NEW):
   - After SIGTERM, read last lines of `logs/server.log`
   - Look for "Scheduler stopped" or "Shutdown complete" marker
   - Print: "Scheduler stopped cleanly" if found, or "Warning: clean shutdown not confirmed in logs" if not
9. Clean up:
   - Delete `runtime/server.json`
   - Delete `runtime/server.lock` (if exists)
10. **JSON output** (NEW): if `--json` flag:
    ```json
    {
      "status": "stopped",
      "pid": 12345,
      "uuid": "abc-def-...",
      "name": "weather-app",
      "graceful": true,
      "scheduler_clean": true
    }
    ```

**Windows note:**
- `process.kill(pid, 'SIGTERM')` on Windows sends a terminate signal
- `process.kill(pid, 0)` works cross-platform for checking process existence
- Use `taskkill /PID <pid> /F` as fallback if `process.kill` fails on Windows

#### `dg restart <query> [--http] [--port <n>]`

**Behavior:**
1. `dg stop <query> --timeout 5000`
2. Wait 500ms
3. `dg start <query> [--http] [--port <n>]`

### 3.2 Runtime Metadata Format

**`runtime/server.json`** — Rich metadata file (replaces plain PID file):
```json
{
  "pid": 12345,
  "uuid": "abc-def-...",
  "command": "dreamgraph",
  "bin_path": "/home/user/.dreamgraph/bin/dist/index.js",
  "transport": "http",
  "port": 8100,
  "started_at": "2026-04-06T10:30:00.000Z",
  "version": "6.1.0"
}
```

**Fields:**

| Field | Type | Purpose |
|-------|------|--------|
| `pid` | number | OS process ID |
| `uuid` | string | Instance UUID — used for ownership validation |
| `command` | string | Always `"dreamgraph"` — used for ownership validation |
| `bin_path` | string | Absolute path to the `index.js` that was spawned |
| `transport` | string | `"http"` or `"stdio"` |
| `port` | number\|null | Port number (HTTP mode) or `null` (stdio) |
| `started_at` | string | ISO 8601 timestamp |
| `version` | string | DreamGraph version at start time |

**`runtime/server.lock`** — Advisory lock file (exists only during `dg start` operation):
- Created atomically with `{ flag: 'wx' }` (exclusive write)
- Contains the CLI process PID
- Deleted on start completion or error
- Stale lock detection: if lock file age > 30 seconds, consider it stale and overwrite

### 3.3 Status Enhancement (with Crash Detection)

Extend `dg status` to show daemon state **and auto-detect crashes**:

**Crash detection flow** (runs automatically on every `dg status` call):
1. Read `runtime/server.json`
2. If file exists, check if PID is alive via `process.kill(pid, 0)`
3. If PID is dead:
   - Print: `⚠ Server process (PID <pid>) is no longer running (crashed or killed)`
   - Clean up `runtime/server.json` and `runtime/server.lock`
   - Show last 10 lines of `logs/server.log` as diagnostic
4. If PID is alive, validate ownership (uuid + command match)

**Enhanced output:**

```
  Daemon
  ────────────────────────────────────────
  Running:         ● Yes (PID 12345)       ← or "○ No" or "⚠ Crashed"
  Transport:       Streamable HTTP         ← or "stdio"
  Port:            8100                    ← or "(N/A)"
  Uptime:          2h 34m                  ← computed from server.json started_at
  Version:         6.1.0                   ← from server.json
  Bin Path:        ~/.dreamgraph/bin/...   ← from server.json
  Log File:        ~/.dreamgraph/<uuid>/logs/server.log
  Log Size:        2.4 MB                  ← helps monitor rotation needs
```

### 3.4 Process Lifecycle

```
                  ┌─────────┐
                  │ dg start│
                  └────┬────┘
                       │
              ┌────────▼────────┐
              │ Version mismatch│
              │ check (warn)    │
              └────────┬────────┘
                       │
              ┌────────▼────────┐     ┌──────────────┐
              │ Acquire startup │────►│ Lock held:   │
              │ lock (server.   │     │ exit 1       │
              │ lock)           │     └──────────────┘
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Resolve instance│
              │ Check not       │
              │ already running │
              │ (ownership      │
              │  validated)     │
              └────────┬────────┘
                       │
              ┌────────▼────────┐     ┌──────────────┐
              │ Port collision  │────►│ Auto-incr    │
              │ check (HTTP)    │     │ port +1..+10 │
              └────────┬────────┘     └──────┬───────┘
                       │◄─────────────────────┘
              ┌────────▼────────┐
              │ Rotate log if   │
              │ > 10 MB         │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Resolve binary  │
              │ path (global or │
              │ local)          │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Spawn detached  │
              │ node process    │
              │ w/ instance env │
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ Write server.   │
              │ json (rich      │
              │ metadata)       │
              └────────┬────────┘
                       │
              ┌────────▼────────┐     ┌──────────────┐
              │ Health check    │────►│ Timeout:     │
              │ (HTTP only)     │     │ show log tail│
              └────────┬────────┘     └──────────────┘
                       │
              ┌────────▼────────┐
              │ Release lock    │
              │ Print success   │
              │ (or --json)     │
              │ Exit 0          │
              └─────────────────┘


          ┌─────────┐
          │ dg stop │
          └────┬────┘
               │
      ┌────────▼────────┐
      │ Read server.json│───── not found ───► "Not running" exit 0
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │ Check PID alive │───── dead ───► Clean files, "Not running" exit 0
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │ Validate process│───── mismatch ───► "PID reuse" exit 1
      │ ownership (uuid,│                    (unless --force)
      │ command)        │
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │ SIGTERM (or     │
      │ SIGKILL --force)│
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │ Wait for exit   │───── timeout ───► Offer SIGKILL
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │ Check scheduler │
      │ shutdown in logs│
      └────────┬────────┘
               │
      ┌────────▼────────┐
      │ Clean server.   │
      │ json + lock.    │
      │ Print ok / json │
      └─────────────────┘


      ┌───────────┐
      │ dg status │
      └─────┬─────┘
            │
      ┌─────▼──────────┐
      │ Read server.   │───── not found ───► "○ Not running"
      │ json           │
      └─────┬──────────┘
            │
      ┌─────▼──────────┐
      │ Check PID alive│───── dead ───► "⚠ Crashed"
      │ + ownership    │               Clean stale files
      └─────┬──────────┘               Show log tail
            │
      ┌─────▼──────────┐
      │ Print daemon   │
      │ section:       │
      │ PID, transport,│
      │ port, uptime,  │
      │ version, log sz│
      └────────────────┘
```

### 3.5 New Source Files

| File | Purpose |
|------|---------|
| `src/cli/commands/start.ts` | `cmdStart()` — spawn/foreground daemon, port detection, lock, ownership, version check, log rotation, `--json` |
| `src/cli/commands/stop.ts` | `cmdStop()` — graceful/force stop, ownership validation, shutdown verification, `--json` |
| `src/cli/commands/restart.ts` | `cmdRestart()` — stop then start |
| `src/cli/utils/daemon.ts` | Shared: `ServerMeta`, `resolveBinPath()`, `readServerMeta()`, `writeServerMeta()`, `acquireStartLock()`, `isProcessAlive()`, `validateOwnership()`, `findAvailablePort()`, `rotateLogIfNeeded()`, `readLogTail()`, `checkVersionMismatch()`, `verifyGracefulShutdown()`, `healthCheck()`, `cleanRuntimeFiles()`, `resolveInstanceForCommand()` |

### 3.6 CLI Router Updates (dg.ts)

Add to the router switch:

```typescript
case "start":
  await cmdStart(positional.slice(1), flags);
  break;

case "stop":
  await cmdStop(positional.slice(1), flags);
  break;

case "restart":
  await cmdRestart(positional.slice(1), flags);
  break;
```

Add to usage:

```
  start <query> [--http] [--port <n>]   Start a server process for an instance
  stop <query> [--force]                Stop a running server process
  restart <query> [--http] [--port <n>] Restart a server process

  All commands support --json for machine-readable output.
```

---

## 4. Feature 2: Global Binary Installation

### 4.1 Design Rationale

Currently, `dg` and `dreamgraph` binaries resolve to `./dist/` within whichever clone of the repo you're in. This means:

- You must `cd` to the source repo before running `dg` commands
- Multiple checkouts create confusion about which version is running
- `npm link` works but is fragile across Node version changes

**Solution:** Install the compiled server to `~/.dreamgraph/bin/` and add that to PATH.

### 4.2 Directory Layout

```
~/.dreamgraph/bin/
├── package.json                ← { "type": "module", "dependencies": {...} }
├── node_modules/               ← production deps only
└── dist/                       ← compiled JS (mirror of repo dist/)
    ├── index.js                ← MCP server entry point
    ├── cli/
    │   └── dg.js               ← CLI entry point
    ├── server/
    ├── instance/
    ├── cognitive/
    ├── config/
    ├── tools/
    ├── resources/
    ├── discipline/
    ├── types/
    └── utils/
```

### 4.3 Binary Resolution Chain

When `dg start` spawns a server, it needs to find the `index.js` entry point. The resolution order:

1. **`DREAMGRAPH_BIN_DIR` env var** — explicit override (for testing)
2. **`~/.dreamgraph/bin/dist/index.js`** — global install location
3. **Relative to `dg.js` itself** — `../../dist/index.js` (dev/local mode)

```typescript
function resolveBinPath(): string {
  // 1. Explicit override
  const envBin = process.env.DREAMGRAPH_BIN_DIR;
  if (envBin) {
    const p = resolve(envBin, "dist", "index.js");
    if (existsSync(p)) return p;
  }

  // 2. Global install
  const masterDir = resolveMasterDir();
  const globalPath = resolve(masterDir, "bin", "dist", "index.js");
  if (existsSync(globalPath)) return globalPath;

  // 3. Local (relative to this CLI file)
  const localPath = resolve(
    fileURLToPath(import.meta.url), "..", "..", "..", "index.js"
  );
  if (existsSync(localPath)) return localPath;

  throw new Error(
    "DreamGraph server binary not found. Run install script or set DREAMGRAPH_BIN_DIR."
  );
}
```

### 4.4 Version Tracking

Write `~/.dreamgraph/bin/version.json` during install:

```json
{
  "version": "6.1.0",
  "installed_at": "2025-07-15T10:30:00.000Z",
  "source": "C:\\Users\\Mika Jussila\\source\\repos\\dreamgraph",
  "node_version": "v22.15.0"
}
```

This enables future `dg update` / `dg self-update` commands and version mismatch warnings.

---

## 5. Feature 3: Install Scripts

### 5.1 Install Steps (Shared Logic)

Both scripts perform the same steps:

1. **Verify prerequisites**: Node.js ≥ 18, npm
2. **Build the project**: `npm run build` in the source repo
3. **Create `~/.dreamgraph/bin/`** directory
4. **Copy `dist/`** to `~/.dreamgraph/bin/dist/`
5. **Create minimal `package.json`** in `~/.dreamgraph/bin/` with only production dependencies
6. **Install production deps**: `npm install --omit=dev` in `~/.dreamgraph/bin/`
7. **Copy templates**: `templates/` → `~/.dreamgraph/templates/` (if not already present)
8. **Write `version.json`** with install metadata
9. **Create symlinks/shims** for `dg` and `dreamgraph` on PATH
10. **Verify installation**: `dg --version`

### 5.2 PowerShell Script (`scripts/install.ps1`)

```powershell
#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install DreamGraph globally to ~/.dreamgraph/bin/

.DESCRIPTION
    Builds the project, deploys compiled files to the global bin directory,
    installs production dependencies, and creates PATH entries.

.PARAMETER SourceDir
    Path to the DreamGraph source repository (default: current directory)

.PARAMETER Force
    Overwrite existing installation without prompting

.EXAMPLE
    .\scripts\install.ps1
    .\scripts\install.ps1 -SourceDir C:\repos\dreamgraph -Force
#>

param(
    [string]$SourceDir = (Get-Location).Path,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ── Config ──────────────────────────────────────────────────────────
$DGHome     = Join-Path $env:USERPROFILE ".dreamgraph"
$BinDir     = Join-Path $DGHome "bin"
$DistTarget = Join-Path $BinDir "dist"
$TemplateTarget = Join-Path $DGHome "templates"

# ── Prerequisites ───────────────────────────────────────────────────
Write-Host "`n🔍 Checking prerequisites..." -ForegroundColor Cyan

$nodeVersion = & node --version 2>$null
if (-not $nodeVersion) {
    Write-Error "Node.js is required but not found. Install from https://nodejs.org/"
    exit 1
}
$major = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) {
    Write-Error "Node.js >= 18 required (found $nodeVersion)"
    exit 1
}
Write-Host "  Node.js $nodeVersion ✓" -ForegroundColor Green

$npmVersion = & npm --version 2>$null
if (-not $npmVersion) {
    Write-Error "npm is required but not found."
    exit 1
}
Write-Host "  npm $npmVersion ✓" -ForegroundColor Green

# ── Validate source ────────────────────────────────────────────────
$packageJson = Join-Path $SourceDir "package.json"
if (-not (Test-Path $packageJson)) {
    Write-Error "No package.json found at $SourceDir. Is this the DreamGraph repo?"
    exit 1
}

$pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
if ($pkg.name -ne "dreamgraph") {
    Write-Error "package.json does not appear to be DreamGraph (name: $($pkg.name))"
    exit 1
}
$version = $pkg.version
Write-Host "  DreamGraph v$version source at $SourceDir ✓" -ForegroundColor Green

# ── Check existing install ─────────────────────────────────────────
if ((Test-Path $DistTarget) -and -not $Force) {
    $existingVersion = "unknown"
    $versionFile = Join-Path $BinDir "version.json"
    if (Test-Path $versionFile) {
        $existingVersion = (Get-Content $versionFile -Raw | ConvertFrom-Json).version
    }
    Write-Host "`n⚠  Existing installation found (v$existingVersion)" -ForegroundColor Yellow
    $confirm = Read-Host "  Overwrite? [y/N]"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Red
        exit 0
    }
}

# ── Build ──────────────────────────────────────────────────────────
Write-Host "`n🔨 Building DreamGraph..." -ForegroundColor Cyan
Push-Location $SourceDir
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed with exit code $LASTEXITCODE"
        exit 1
    }
    Write-Host "  Build complete ✓" -ForegroundColor Green
} finally {
    Pop-Location
}

$SourceDist = Join-Path $SourceDir "dist"
if (-not (Test-Path $SourceDist)) {
    Write-Error "dist/ directory not found after build"
    exit 1
}

# ── Deploy ─────────────────────────────────────────────────────────
Write-Host "`n📦 Deploying to $BinDir..." -ForegroundColor Cyan

# Create directories
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

# Remove old dist if present
if (Test-Path $DistTarget) {
    Remove-Item -Recurse -Force $DistTarget
}

# Copy dist
Copy-Item -Recurse -Force $SourceDist $DistTarget
Write-Host "  dist/ copied ✓" -ForegroundColor Green

# Create minimal package.json with production deps only
$binPkg = @{
    name         = "dreamgraph-global"
    version      = $version
    type         = "module"
    dependencies = @{}
}
# Copy production dependencies from source package.json
foreach ($dep in $pkg.dependencies.PSObject.Properties) {
    $binPkg.dependencies[$dep.Name] = $dep.Value
}
$binPkgJson = $binPkg | ConvertTo-Json -Depth 10
Set-Content -Path (Join-Path $BinDir "package.json") -Value $binPkgJson -Encoding UTF8
Write-Host "  package.json created ✓" -ForegroundColor Green

# Install production deps
Write-Host "  Installing dependencies..." -ForegroundColor Cyan
Push-Location $BinDir
try {
    & npm install --omit=dev 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Error "npm install failed"
        exit 1
    }
    Write-Host "  Dependencies installed ✓" -ForegroundColor Green
} finally {
    Pop-Location
}

# ── Templates ─────────────────────────────────────────────────────
$sourceTemplates = Join-Path $SourceDir "templates"
if (Test-Path $sourceTemplates) {
    if (-not (Test-Path $TemplateTarget)) {
        Copy-Item -Recurse -Force $sourceTemplates $TemplateTarget
        Write-Host "  Templates copied ✓" -ForegroundColor Green
    } else {
        Write-Host "  Templates already exist, skipping" -ForegroundColor DarkGray
    }
}

# ── Version file ───────────────────────────────────────────────────
$versionInfo = @{
    version      = $version
    installed_at = (Get-Date -Format o)
    source       = $SourceDir
    node_version = $nodeVersion
} | ConvertTo-Json
Set-Content -Path (Join-Path $BinDir "version.json") -Value $versionInfo -Encoding UTF8

# ── PATH / Shims ──────────────────────────────────────────────────
Write-Host "`n🔗 Setting up PATH..." -ForegroundColor Cyan

# Create .cmd shims in ~/.dreamgraph/bin/ for dg and dreamgraph
$dgShim = @"
@echo off
node "%~dp0dist\cli\dg.js" %*
"@
Set-Content -Path (Join-Path $BinDir "dg.cmd") -Value $dgShim -Encoding ASCII

$dgPsShim = @"
#!/usr/bin/env pwsh
& node (Join-Path `$PSScriptRoot "dist/cli/dg.js") @args
"@
Set-Content -Path (Join-Path $BinDir "dg.ps1") -Value $dgPsShim -Encoding UTF8

$serverShim = @"
@echo off
node "%~dp0dist\index.js" %*
"@
Set-Content -Path (Join-Path $BinDir "dreamgraph.cmd") -Value $serverShim -Encoding ASCII

Write-Host "  Shims created ✓" -ForegroundColor Green

# Add to user PATH if not already there
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        "$BinDir;$userPath",
        "User"
    )
    Write-Host "  Added $BinDir to user PATH ✓" -ForegroundColor Green
    Write-Host "  ⚠ Restart your terminal for PATH changes to take effect" -ForegroundColor Yellow
} else {
    Write-Host "  $BinDir already in PATH ✓" -ForegroundColor Green
}

# Also update current session
$env:Path = "$BinDir;$env:Path"

# ── Verify ─────────────────────────────────────────────────────────
Write-Host "`n✅ Verifying installation..." -ForegroundColor Cyan
try {
    $output = & node (Join-Path $DistTarget "cli/dg.js") --version 2>&1
    Write-Host "  $output ✓" -ForegroundColor Green
} catch {
    Write-Host "  ⚠ Verification failed: $_" -ForegroundColor Yellow
}

# ── Done ────────────────────────────────────────────────────────────
Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host " DreamGraph v$version installed successfully!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host " Binary:  $BinDir" -ForegroundColor White
Write-Host " Run:     dg --help" -ForegroundColor White
Write-Host " Start:   dg start <instance-name> --http" -ForegroundColor White
Write-Host ""
```

### 5.3 Bash Script (`scripts/install.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

# ── DreamGraph Global Installer ─────────────────────────────────────
#
# Usage:
#   ./scripts/install.sh [--source <dir>] [--force]
#
# Builds DreamGraph, deploys to ~/.dreamgraph/bin/, and creates
# symlinks on PATH.

# ── Defaults ────────────────────────────────────────────────────────
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source)  SOURCE_DIR="$2"; shift 2 ;;
        --force)   FORCE=true; shift ;;
        --help|-h)
            echo "Usage: install.sh [--source <dir>] [--force]"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

DG_HOME="${DREAMGRAPH_MASTER_DIR:-$HOME/.dreamgraph}"
BIN_DIR="$DG_HOME/bin"
DIST_TARGET="$BIN_DIR/dist"
TEMPLATE_TARGET="$DG_HOME/templates"

# ── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'  # No Color

info()  { echo -e "${CYAN}$*${NC}"; }
ok()    { echo -e "  ${GREEN}$* ✓${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠ $*${NC}"; }
fail()  { echo -e "${RED}Error: $*${NC}"; exit 1; }

# ── Prerequisites ───────────────────────────────────────────────────
info "\n🔍 Checking prerequisites..."

NODE_VERSION=$(node --version 2>/dev/null || true)
[[ -z "$NODE_VERSION" ]] && fail "Node.js is required but not found."
MAJOR=$(echo "$NODE_VERSION" | sed 's/^v\([0-9]*\)\..*/\1/')
[[ "$MAJOR" -lt 18 ]] && fail "Node.js >= 18 required (found $NODE_VERSION)"
ok "Node.js $NODE_VERSION"

NPM_VERSION=$(npm --version 2>/dev/null || true)
[[ -z "$NPM_VERSION" ]] && fail "npm is required but not found."
ok "npm $NPM_VERSION"

# ── Validate source ────────────────────────────────────────────────
PACKAGE_JSON="$SOURCE_DIR/package.json"
[[ ! -f "$PACKAGE_JSON" ]] && fail "No package.json at $SOURCE_DIR"

PKG_NAME=$(node -e "console.log(require('$PACKAGE_JSON').name)")
[[ "$PKG_NAME" != "dreamgraph" ]] && fail "Not a DreamGraph repo (name: $PKG_NAME)"

VERSION=$(node -e "console.log(require('$PACKAGE_JSON').version)")
ok "DreamGraph v$VERSION source at $SOURCE_DIR"

# ── Check existing install ─────────────────────────────────────────
if [[ -d "$DIST_TARGET" ]] && [[ "$FORCE" != "true" ]]; then
    EXISTING="unknown"
    if [[ -f "$BIN_DIR/version.json" ]]; then
        EXISTING=$(node -e "console.log(require('$BIN_DIR/version.json').version)")
    fi
    warn "Existing installation found (v$EXISTING)"
    read -rp "  Overwrite? [y/N] " confirm
    [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { echo "Aborted."; exit 0; }
fi

# ── Build ──────────────────────────────────────────────────────────
info "\n🔨 Building DreamGraph..."
(cd "$SOURCE_DIR" && npm run build)
ok "Build complete"

SOURCE_DIST="$SOURCE_DIR/dist"
[[ ! -d "$SOURCE_DIST" ]] && fail "dist/ not found after build"

# ── Deploy ─────────────────────────────────────────────────────────
info "\n📦 Deploying to $BIN_DIR..."

mkdir -p "$BIN_DIR"

# Remove old dist
[[ -d "$DIST_TARGET" ]] && rm -rf "$DIST_TARGET"

# Copy dist
cp -r "$SOURCE_DIST" "$DIST_TARGET"
ok "dist/ copied"

# Create minimal package.json
node -e "
  const pkg = require('$PACKAGE_JSON');
  const binPkg = {
    name: 'dreamgraph-global',
    version: pkg.version,
    type: 'module',
    dependencies: pkg.dependencies || {}
  };
  require('fs').writeFileSync(
    '$BIN_DIR/package.json',
    JSON.stringify(binPkg, null, 2)
  );
"
ok "package.json created"

# Install production deps
info "  Installing dependencies..."
(cd "$BIN_DIR" && npm install --omit=dev 2>&1 | tail -1)
ok "Dependencies installed"

# ── Templates ─────────────────────────────────────────────────────
if [[ -d "$SOURCE_DIR/templates" ]]; then
    if [[ ! -d "$TEMPLATE_TARGET" ]]; then
        cp -r "$SOURCE_DIR/templates" "$TEMPLATE_TARGET"
        ok "Templates copied"
    else
        echo "  Templates already exist, skipping"
    fi
fi

# ── Version file ───────────────────────────────────────────────────
node -e "
  require('fs').writeFileSync('$BIN_DIR/version.json', JSON.stringify({
    version: '$VERSION',
    installed_at: new Date().toISOString(),
    source: '$SOURCE_DIR',
    node_version: '$NODE_VERSION'
  }, null, 2));
"

# ── Symlinks ──────────────────────────────────────────────────────
info "\n🔗 Creating symlinks..."

# Determine link target directory
LINK_DIR="$HOME/.local/bin"
if [[ -d "/usr/local/bin" ]] && [[ -w "/usr/local/bin" ]]; then
    LINK_DIR="/usr/local/bin"
fi
mkdir -p "$LINK_DIR"

# Create wrapper scripts (more robust than symlinks for Node.js)
cat > "$LINK_DIR/dg" << 'SHIM'
#!/usr/bin/env bash
exec node "$HOME/.dreamgraph/bin/dist/cli/dg.js" "$@"
SHIM
chmod +x "$LINK_DIR/dg"

cat > "$LINK_DIR/dreamgraph" << 'SHIM'
#!/usr/bin/env bash
exec node "$HOME/.dreamgraph/bin/dist/index.js" "$@"
SHIM
chmod +x "$LINK_DIR/dreamgraph"
ok "Shims created in $LINK_DIR"

# Check if LINK_DIR is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$LINK_DIR"; then
    warn "$LINK_DIR is not in your PATH"
    echo "  Add to your shell rc:"
    echo "    export PATH=\"$LINK_DIR:\$PATH\""
fi

# ── Verify ─────────────────────────────────────────────────────────
info "\n✅ Verifying installation..."
OUTPUT=$(node "$DIST_TARGET/cli/dg.js" --version 2>&1 || true)
ok "$OUTPUT"

# ── Done ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN} DreamGraph v$VERSION installed successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════${NC}"
echo ""
echo " Binary:  $BIN_DIR"
echo " Links:   $LINK_DIR/dg, $LINK_DIR/dreamgraph"
echo " Run:     dg --help"
echo " Start:   dg start <instance-name> --http"
echo ""
```

---

## 6. Implementation Plan

### Phase 1: Daemon Utilities (Foundation)

**File: `src/cli/utils/daemon.ts`**

Shared utilities for all daemon commands:

```typescript
// ── Runtime metadata ─────────────────────────────────────────────
export interface ServerMeta {
  pid: number;
  uuid: string;
  command: "dreamgraph";
  bin_path: string;
  transport: "http" | "stdio";
  port: number | null;
  started_at: string;
  version: string;
}

// ── Binary resolution ────────────────────────────────────────────
export function resolveBinPath(): string;

// ── Runtime file I/O ─────────────────────────────────────────────
export function readServerMeta(instanceRoot: string): ServerMeta | null;
export function writeServerMeta(instanceRoot: string, meta: ServerMeta): Promise<void>;
export function cleanRuntimeFiles(instanceRoot: string): Promise<void>;

// ── Lock file ────────────────────────────────────────────────────
export function acquireStartLock(instanceRoot: string): Promise<() => Promise<void>>;
// Returns a release function. Throws if lock already held (non-stale).

// ── Process management ───────────────────────────────────────────
export function isProcessAlive(pid: number): boolean;
export function validateOwnership(meta: ServerMeta, expectedUuid: string): boolean;
// Checks meta.uuid === expectedUuid && meta.command === "dreamgraph"
export function waitForExit(pid: number, timeoutMs: number): Promise<boolean>;

// ── Port management ──────────────────────────────────────────────
export function isPortInUse(port: number): Promise<boolean>;
export function findAvailablePort(startPort: number, maxAttempts?: number): Promise<number>;
// Tries startPort, startPort+1, ..., startPort+maxAttempts. Throws if all in use.

// ── Health check ─────────────────────────────────────────────────
export function healthCheck(port: number, timeoutMs: number): Promise<boolean>;

// ── Log management ───────────────────────────────────────────────
export function rotateLogIfNeeded(logPath: string, maxBytes?: number): Promise<void>;
// Default maxBytes = 10 * 1024 * 1024 (10 MB)
// Rotates: server.log → server.log.1, server.log.1 → server.log.2, max 3 generations
export function readLogTail(logPath: string, lines?: number): Promise<string>;
// Returns last N lines. Default 10.

// ── Version check ────────────────────────────────────────────────
export function checkVersionMismatch(cliVersion: string): { mismatch: boolean; runtimeVersion: string | null };
// Reads ~/.dreamgraph/bin/version.json, compares with cliVersion

// ── Shutdown verification ────────────────────────────────────────
export function verifyGracefulShutdown(logPath: string): Promise<boolean>;
// Reads last 20 lines, looks for "Scheduler stopped" or "stopScheduler"

// ── Instance resolution ──────────────────────────────────────────
export function resolveInstanceForCommand(
  query: string | undefined, flags: ParsedArgs["flags"]
): Promise<{ entry: RegistryEntry; instanceRoot: string; masterDir: string }>;
```

### Phase 2: `dg start` Command

**File: `src/cli/commands/start.ts`**

- `cmdStart(positional, flags)` — main implementation
- Version mismatch check against `bin/version.json`
- Acquires `runtime/server.lock` before any mutation
- Validates PID ownership via `server.json` metadata
- Port collision detection with auto-increment (`findAvailablePort()`)
- Log rotation before opening log FD (`rotateLogIfNeeded()`)
- Uses `child_process.spawn` with `detached: true`
- Passes `DREAMGRAPH_INSTANCE_UUID` and `DREAMGRAPH_MASTER_DIR` as env vars
- Writes rich `runtime/server.json` metadata
- Health check for HTTP mode (with log tail diagnostic on failure)
- `--foreground` mode prints debug diagnostics (paths, env vars) before exec
- `--json` mode emits machine-readable JSON to stdout, suppresses human text
- Releases lock on success or error (finally block)

### Phase 3: `dg stop` Command

**File: `src/cli/commands/stop.ts`**

- `cmdStop(positional, flags)` — main implementation
- Reads `runtime/server.json` for PID and metadata
- Validates process ownership (uuid + command) before sending signal
- Cross-platform SIGTERM/SIGKILL handling
- Stale PID cleanup with ownership-aware detection
- Graceful timeout with SIGKILL escalation
- Shutdown verification: checks log for scheduler stop confirmation
- `--json` mode emits machine-readable JSON to stdout

### Phase 4: `dg restart` Command

**File: `src/cli/commands/restart.ts`**

- `cmdRestart(positional, flags)` — delegates to stop then start

### Phase 5: Status Enhancement (with Crash Detection)

**Modify: `src/cli/commands/status.ts`**

- Add daemon section showing PID, transport, port, uptime, version, bin path, log size
- Read from `runtime/server.json` (single rich metadata file)
- **Crash detection**: if `server.json` exists but PID is dead:
  - Auto-clean stale runtime files
  - Show `⚠ Crashed` state with last 10 lines of log
- Ownership validation on live PIDs
- `--json` flag for machine-readable full status output

### Phase 6: CLI Router Update

**Modify: `src/cli/dg.ts`**

- Add `start`, `stop`, `restart` cases to the router
- Update help text
- Add imports

### Phase 7: Install Scripts

**Create: `scripts/install.ps1`** (PowerShell, Windows)
**Create: `scripts/install.sh`** (Bash, Linux/macOS)

### Phase 8: Documentation & Versioning

- Update `README.md` — new commands in tool table, env vars
- Update `docs/tools-reference.md` — CLI section
- Update `docs/architecture.md` — global bin layout diagram
- Version bump to 6.1.0

---

## 7. Edge Cases & Error Handling

### 7.1 Stale PID Files

If the server crashes without cleaning up:
- `server.json` exists but process is gone
- `isProcessAlive(pid)` returns false → auto-cleanup before start
- `dg status` also detects this (crash detection) and cleans up proactively

### 7.2 Port Conflicts (HTTP Mode)

**Pre-spawn detection** (NEW):
- Before spawning, `findAvailablePort(requestedPort)` probes the port
- Uses `net.createServer().listen()` → if `EADDRINUSE`, try next port
- Auto-increment range: `requestedPort` to `requestedPort + 10`
- If all 10 ports busy → clear error with the range that was attempted

**Post-spawn failure**:
- If server itself fails to bind (race condition between probe and spawn):
  - Health check times out
  - `dg start` reads last 5 lines of `logs/server.log` and displays them
  - User sees: "Health check failed. Recent log output: ..."

### 7.3 Instance Not Found

- `findInstance()` returns undefined → clear error message with suggestion: `Run 'dg instances list'`

### 7.4 Permission Errors

- `runtime/` or `logs/` not writable → fail with clear path in error message
- On Linux, `/usr/local/bin` not writable → fall back to `~/.local/bin`

### 7.5 Windows-Specific

- No POSIX signals — `process.kill(pid, 'SIGTERM')` works in Node.js on Windows
- `.cmd` shims needed (`.sh` won't work on CMD)
- `.ps1` shims for PowerShell users
- PATH modification via `[Environment]::SetEnvironmentVariable()` (User scope)
- `taskkill /PID <pid> /F` as last-resort fallback

### 7.6 Multiple Servers for Same Instance

- Prevented by PID ownership check + lock file in `dg start`
- If you `dg start` while already running → error with existing PID
- Lock file prevents two concurrent `dg start` calls from racing
- `--force` flag not provided for start (stop first, then start)

### 7.7 PID Reuse by OS (NEW)

- OS may recycle PIDs after process exit
- `server.json` stores `uuid` and `command` fields
- Before killing, `dg stop` validates: `meta.uuid === instance.uuid && meta.command === "dreamgraph"`
- On mismatch → refuses to send signal (unless `--force`), prints clear warning
- `dg status` also validates and auto-cleans on mismatch

### 7.8 Concurrent Start Race Condition (NEW)

- Two `dg start` calls for the same instance at the same time
- First call acquires `runtime/server.lock` → proceeds
- Second call fails to acquire lock → "Another start operation in progress"
- Stale lock detection: if lock file is > 30 seconds old, treat as stale (crashed CLI)

### 7.9 Log File Growth (NEW)

- `server.log` rotated before each start if > 10 MB
- Rotation chain: `server.log` → `server.log.1` → `server.log.2` → `server.log.3` (deleted)
- Maximum 3 generations retained
- `dg status` shows current log file size as diagnostic

### 7.10 Version Mismatch (NEW)

- CLI binary version (from `config.server.version`) compared to installed runtime (`bin/version.json`)
- On mismatch → warning printed (not blocking)
- Helps diagnose: "I updated the code but forgot to re-install"
- `dg status` also shows the running server's version (from `server.json`)

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Test | File | Description |
|------|------|-------------|
| `resolveBinPath()` | `daemon.test.ts` | Global → local fallback chain |
| `readServerMeta()` / `writeServerMeta()` | `daemon.test.ts` | Read/write/missing/corrupt file handling |
| `isProcessAlive()` | `daemon.test.ts` | Live PID, dead PID, invalid PID |
| `validateOwnership()` | `daemon.test.ts` | Matching uuid+command, mismatched uuid, mismatched command, corrupted meta |
| `waitForExit()` | `daemon.test.ts` | Timeout behavior, immediate exit |
| `cleanRuntimeFiles()` | `daemon.test.ts` | Removes server.json + server.lock, idempotent on missing files |
| `healthCheck()` | `daemon.test.ts` | HTTP mock success/timeout/connection refused |
| `isPortInUse()` | `daemon.test.ts` | Free port, occupied port |
| `findAvailablePort()` | `daemon.test.ts` | First free, auto-increment, all-occupied error |
| `acquireStartLock()` | `daemon.test.ts` | Fresh acquire, already locked, stale lock (> 30s) |
| `rotateLogIfNeeded()` | `daemon.test.ts` | Under threshold (no-op), over threshold (rotates), multiple generations, missing file |
| `readLogTail()` | `daemon.test.ts` | Normal file, empty file, missing file |
| `checkVersionMismatch()` | `daemon.test.ts` | Match, mismatch, missing version.json |
| `verifyGracefulShutdown()` | `daemon.test.ts` | Scheduler-stopped marker found, not found, missing log |

### 8.2 Integration Tests

| Test | Description |
|------|-------------|
| `dg start` → `dg status` → `dg stop` | Full lifecycle in HTTP mode |
| `dg start` (already running) | Should fail with PID message |
| `dg start` concurrent | Second call blocked by lock file |
| `dg stop` (not running) | Should succeed gracefully |
| `dg stop` (PID reuse) | Should refuse without --force |
| `dg restart` | Stop + start in sequence |
| Stale PID cleanup | Kill process, verify `dg start` recovers |
| Crash detection | Kill process, verify `dg status` detects and cleans |
| Port conflict | Start two instances on same port → auto-increment |
| Port exhaustion | All ports in range occupied → clear error |
| Log rotation | Create 15 MB log, verify rotation on next start |
| Version mismatch warning | CLI v6.2 vs runtime v6.1 → warning printed |
| `--json` output | Verify valid JSON from start, stop, status |
| `--foreground` debug output | Verify diagnostic lines printed before exec |
| Graceful shutdown | SIGTERM → verify scheduler stop confirmed in log |

### 8.3 Install Script Tests

| Test | Description |
|------|-------------|
| Fresh install | No existing `~/.dreamgraph/bin/` |
| Upgrade install | Existing version, `--force` |
| PATH already set | Idempotent PATH handling |
| Missing Node.js | Prerequisite check |
| Version file written | Verify version.json contents |

---

## 9. Environment Variables (New)

| Variable | Default | Description |
|----------|---------|-------------|
| `DREAMGRAPH_BIN_DIR` | `~/.dreamgraph/bin` | Override global binary location |
| `DREAMGRAPH_LOG_LEVEL` | `info` | Server log verbosity when daemonized |

Existing variables (unchanged):
| Variable | Default | Description |
|----------|---------|-------------|
| `DREAMGRAPH_INSTANCE_UUID` | (none) | Target instance for server process |
| `DREAMGRAPH_MASTER_DIR` | `~/.dreamgraph` | Master directory location |
| `DREAMGRAPH_DATA_DIR` | `data` | Data directory (legacy mode) |
| `DREAMGRAPH_REPOS` | `{}` | Repository paths (legacy mode) |

---

## 10. Migration Notes

### From Current Workflow

**Before (v6.0):**
```bash
# Terminal 1: Keep open
cd ~/repos/dreamgraph
$env:DREAMGRAPH_INSTANCE_UUID = "abc-123"
node dist/index.js --transport http
# ... runs in foreground, terminal blocked
```

**After (v6.1):**
```bash
# From anywhere
dg start my-project --http
# Server runs in background, terminal free
# Later:
dg status my-project   # Check it's running (auto-detects crashes)
dg stop my-project     # Clean shutdown (verifies scheduler stopped)

# Scripting / CI:
dg start my-project --http --json | jq .port
dg stop my-project --json
```

### Backward Compatibility

- All existing CLI commands unchanged
- `dg status` enhanced but backward-compatible (new section appended)
- Legacy flat mode still works (no UUID → no daemon features)
- `dreamgraph` entry point unchanged — `dg start` simply spawns it with proper env vars
- Install is optional — everything still works from the source repo with `node dist/`

---

## 11. Implementation Checklist

**Phase 1 — Daemon Utilities:**
- [ ] `src/cli/utils/daemon.ts` — `ServerMeta` type, `readServerMeta()`, `writeServerMeta()`
- [ ] `src/cli/utils/daemon.ts` — `resolveBinPath()` (env → global → local chain)
- [ ] `src/cli/utils/daemon.ts` — `acquireStartLock()` / release (with 30s stale detection)
- [ ] `src/cli/utils/daemon.ts` — `isProcessAlive()`, `validateOwnership()`, `waitForExit()`
- [ ] `src/cli/utils/daemon.ts` — `isPortInUse()`, `findAvailablePort()` (auto-increment)
- [ ] `src/cli/utils/daemon.ts` — `rotateLogIfNeeded()`, `readLogTail()` (10 MB threshold, 3 generations)
- [ ] `src/cli/utils/daemon.ts` — `checkVersionMismatch()`, `verifyGracefulShutdown()`
- [ ] `src/cli/utils/daemon.ts` — `healthCheck()`, `cleanRuntimeFiles()`, `resolveInstanceForCommand()`

**Phase 2 — Commands:**
- [ ] `src/cli/commands/start.ts` — `cmdStart()` with lock, port detection, ownership, log rotation, version check, `--json`, `--foreground` debug
- [ ] `src/cli/commands/stop.ts` — `cmdStop()` with ownership validation, shutdown verification, `--json`
- [ ] `src/cli/commands/restart.ts` — `cmdRestart()` delegates to stop then start

**Phase 3 — Existing code updates:**
- [ ] `src/cli/dg.ts` — Router updates (3 new cases + help text)
- [ ] `src/cli/commands/status.ts` — Daemon section with crash detection, ownership check, log size, version, `--json`

**Phase 4 — Install infrastructure:**
- [ ] `scripts/install.ps1` — PowerShell installer
- [ ] `scripts/install.sh` — Bash installer

**Phase 5 — Tests:**
- [ ] `tests/daemon.test.ts` — Unit tests for all daemon utilities (14 test groups)
- [ ] `tests/daemon-integration.test.ts` — Integration tests for start/stop/status lifecycle (15 scenarios)

**Phase 6 — Documentation & Versioning:**
- [ ] `package.json` version → 6.1.0
- [ ] `src/config/config.ts` version → 6.1.0
- [ ] `README.md` — CLI commands, env vars, architecture, `--json` flag
- [ ] `docs/architecture.md` — Global bin layout, source layout, `server.json` schema
- [ ] `docs/tools-reference.md` — CLI reference section
- [ ] `docs/README.md` — Version update
- [ ] Build verified clean (`npm run build`)

---

## 12. Architecture Decision Records

Five ADRs have been registered for the decisions in this TDD. Each ADR includes context, alternatives considered, consequences, and guard rails that **must not be violated** during implementation.

### ADR-003: Rich server.json Metadata File for Daemon Process Tracking

**Decision:** Write `runtime/server.json` with 8 fields (pid, uuid, command, bin_path, transport, port, started_at, version). Validate ownership (uuid + command match) before sending any signal to prevent PID reuse attacks.

**Guard Rails:**
1. Do NOT send signals to a PID without first validating server.json ownership (uuid + command match)
2. Do NOT remove the `command` field from server.json — it is the secondary ownership check
3. Do NOT write server.json before the child process has been successfully spawned
4. Do NOT delete server.json on server startup — only `dg stop` and crash-detection cleanup should remove it
5. server.json MUST be written atomically (write to temp file, then rename) to prevent partial reads

**Affects:** Section 3.1 (`dg start` behavior steps 8–9), Section 3.2 (`dg stop` behavior step 2)

### ADR-004: Pre-spawn Port Collision Detection with Auto-Increment for HTTP Transport

**Decision:** Before spawning, probe the target port using `net.createServer().listen()`. If EADDRINUSE, auto-increment by 1 up to `startPort + 10`. Write actual port to server.json.

**Guard Rails:**
1. Do NOT probe ports in stdio mode — port detection is only for HTTP transport
2. Do NOT exceed 10 port attempts — if 10 consecutive ports are busy, something is wrong
3. Do NOT spawn the server process before port availability is confirmed
4. The final resolved port MUST be written to server.json, not the originally requested port

**Affects:** Section 3.1 (`dg start` behavior step 5), Section 6 (implementation plan — daemon utilities)

### ADR-005: Global Binary Installation to ~/.dreamgraph/bin/ with Version Tracking

**Decision:** Deploy compiled `dist/` and production `node_modules` to `~/.dreamgraph/bin/`. Binary resolution chain: (1) DREAMGRAPH_BIN_DIR env var, (2) `~/.dreamgraph/bin/dist/index.js`, (3) relative to CLI file. Write `bin/version.json` for mismatch detection.

**Guard Rails:**
1. Do NOT modify the source repo's `dist/` or `node_modules/` during install — only copy FROM source TO `~/.dreamgraph/bin/`
2. Do NOT install devDependencies in the global bin — production deps only (`--omit=dev`)
3. Do NOT assume `~/.dreamgraph/bin/` is on PATH — scripts must add it if missing
4. DREAMGRAPH_BIN_DIR env var MUST take precedence over default `~/.dreamgraph/bin/` for testing
5. `version.json` MUST be written on every install (not just first install) to track upgrades

**Affects:** Section 4 (global binary installation), Section 5 (install scripts)

### ADR-006: Detached Daemon Process Spawning with Log Capture and Rotation

**Decision:** Use `child_process.spawn()` with `{ detached: true, stdio: ['ignore', logFd, logFd] }`. Call `child.unref()` to let CLI exit. Log rotation before FD open: > 10 MB triggers `.log → .1 → .2 → .3` rotation (max 3 generations). Health check for HTTP: poll `/health` every 500ms, max 10 attempts.

**Guard Rails:**
1. Do NOT use `shell: true` in spawn options — prevents proper detach and adds security risk
2. Do NOT redirect stdout/stderr to `'pipe'` in daemon mode — use file descriptors only (pipes buffer and block)
3. `child.unref()` MUST be called after spawn in daemon mode to allow CLI to exit
4. Log rotation MUST happen before opening the log FD, not after
5. DREAMGRAPH_INSTANCE_UUID MUST be set in the spawn environment — only way the server knows which instance to load
6. Do NOT use `process.fork()` — it creates an IPC channel that keeps the parent alive

**Affects:** Section 3.1 (`dg start` behavior steps 6–7), Section 6 (implementation plan), Section 7 (edge cases)

### ADR-007: Advisory Lock File for Preventing Concurrent dg start Race Conditions

**Decision:** Create `runtime/server.lock` using `fs.writeFile` with `{ flag: 'wx' }` (exclusive-create). Lock contains CLI PID. Released in `finally` block. Stale detection: age > 30s → treat as crashed CLI, delete and retry.

**Guard Rails:**
1. Do NOT use server.lock for anything other than the start operation — it is an advisory lock, not a runtime indicator
2. server.lock MUST be deleted in a `finally` block to ensure cleanup on both success and error paths
3. Stale lock threshold (30 seconds) MUST be generous enough that slow machines don't false-positive
4. Do NOT check server.lock in `dg status` or `dg stop` — those commands use server.json for state

**Affects:** Section 3.1 (`dg start` behavior step 3), Section 7.1 (race condition handling)
