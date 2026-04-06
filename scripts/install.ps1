#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Install DreamGraph globally to ~/.dreamgraph/bin/

.DESCRIPTION
    Builds the project, deploys compiled files to the global bin directory,
    installs production dependencies, and creates PATH entries.

    After installation, `dg` and `dreamgraph` commands are available from
    any terminal session without needing to cd to the source repo.

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
$DGHome         = if ($env:DREAMGRAPH_MASTER_DIR) { $env:DREAMGRAPH_MASTER_DIR } else { Join-Path $env:USERPROFILE ".dreamgraph" }
$BinDir         = Join-Path $DGHome "bin"
$DistTarget     = Join-Path $BinDir "dist"
$TemplateTarget = Join-Path $DGHome "templates"

# ── Helpers ─────────────────────────────────────────────────────────
function Write-Step([string]$msg) { Write-Host "`n$msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "  $msg `u{2713}" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  WARNING: $msg" -ForegroundColor Yellow }

# ── Prerequisites ───────────────────────────────────────────────────
Write-Step "Checking prerequisites..."

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
Write-Ok "Node.js $nodeVersion"

$npmVersion = & npm --version 2>$null
if (-not $npmVersion) {
    Write-Error "npm is required but not found."
    exit 1
}
Write-Ok "npm $npmVersion"

# ── Validate source ────────────────────────────────────────────────
$packageJsonPath = Join-Path $SourceDir "package.json"
if (-not (Test-Path $packageJsonPath)) {
    Write-Error "No package.json found at $SourceDir. Is this the DreamGraph repo?"
    exit 1
}

$pkg = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
if ($pkg.name -ne "dreamgraph") {
    Write-Error "package.json does not appear to be DreamGraph (name: $($pkg.name))"
    exit 1
}
$version = $pkg.version
Write-Ok "DreamGraph v$version source at $SourceDir"

# ── Check existing install ─────────────────────────────────────────
if ((Test-Path $DistTarget) -and -not $Force) {
    $existingVersion = "unknown"
    $versionFile = Join-Path $BinDir "version.json"
    if (Test-Path $versionFile) {
        $existingVersion = (Get-Content $versionFile -Raw | ConvertFrom-Json).version
    }
    Write-Warn "Existing installation found (v$existingVersion)"
    $confirm = Read-Host "  Overwrite? [y/N]"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "Aborted." -ForegroundColor Red
        exit 0
    }
}

# ── Build ──────────────────────────────────────────────────────────
Write-Step "Building DreamGraph..."
Push-Location $SourceDir
try {
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & npm run build 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $ErrorActionPreference = $prevPref
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed with exit code $LASTEXITCODE"
        exit 1
    }
    Write-Ok "Build complete"
} finally {
    Pop-Location
}

$SourceDist = Join-Path $SourceDir "dist"
if (-not (Test-Path $SourceDist)) {
    Write-Error "dist/ directory not found after build"
    exit 1
}

# ── Deploy ─────────────────────────────────────────────────────────
Write-Step "Deploying to $BinDir..."

# Create bin directory
New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

# Remove old dist if present
if (Test-Path $DistTarget) {
    Remove-Item -Recurse -Force $DistTarget
}

# Copy dist
Copy-Item -Recurse -Force $SourceDist $DistTarget
Write-Ok "dist/ copied"

# Create minimal package.json with production deps only
$binPkg = [ordered]@{
    name         = "dreamgraph-global"
    version      = $version
    type         = "module"
    dependencies = [ordered]@{}
}
foreach ($dep in $pkg.dependencies.PSObject.Properties) {
    $binPkg.dependencies[$dep.Name] = $dep.Value
}
$binPkgJson = $binPkg | ConvertTo-Json -Depth 10
Set-Content -Path (Join-Path $BinDir "package.json") -Value $binPkgJson -Encoding UTF8
Write-Ok "package.json created"

# Install production deps (clean first to avoid hoisting artifacts)
Write-Host "  Installing dependencies..." -ForegroundColor Cyan
$nodeModulesDir = Join-Path $BinDir "node_modules"
if (Test-Path $nodeModulesDir) {
    Remove-Item -Recurse -Force $nodeModulesDir
}
Push-Location $BinDir
try {
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $npmOut = & npm install --omit=dev 2>&1
    $ErrorActionPreference = $prevPref
    if ($LASTEXITCODE -ne 0) {
        # Show full output on failure
        $npmOut | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
        Write-Error "npm install failed (exit code $LASTEXITCODE)"
        exit 1
    }
    # Show the summary line (last non-empty line from stdout)
    $summary = ($npmOut | Where-Object { $_ -is [string] -and $_.Trim() }) | Select-Object -Last 1
    if ($summary) {
        Write-Host "  $summary" -ForegroundColor DarkGray
    }
    Write-Ok "Dependencies installed"
} finally {
    Pop-Location
}

# ── Templates ─────────────────────────────────────────────────────
$sourceTemplates = Join-Path $SourceDir "templates"
if (Test-Path $sourceTemplates) {
    if (-not (Test-Path $TemplateTarget)) {
        Copy-Item -Recurse -Force $sourceTemplates $TemplateTarget
        Write-Ok "Templates copied"
    } else {
        Write-Host "  Templates already exist, skipping" -ForegroundColor DarkGray
    }
}

# ── Version file ───────────────────────────────────────────────────
$versionInfo = [ordered]@{
    version      = $version
    installed_at = (Get-Date -Format o)
    source       = $SourceDir
    node_version = $nodeVersion
} | ConvertTo-Json
Set-Content -Path (Join-Path $BinDir "version.json") -Value $versionInfo -Encoding UTF8

# ── Create shims ──────────────────────────────────────────────────
Write-Step "Creating command shims..."

# .cmd shims for CMD.exe
$dgCmd = @"
@echo off
node "%~dp0dist\cli\dg.js" %*
"@
Set-Content -Path (Join-Path $BinDir "dg.cmd") -Value $dgCmd -Encoding ASCII

$serverCmd = @"
@echo off
node "%~dp0dist\index.js" %*
"@
Set-Content -Path (Join-Path $BinDir "dreamgraph.cmd") -Value $serverCmd -Encoding ASCII

# .ps1 shims for PowerShell
$dgPs1 = @'
#!/usr/bin/env pwsh
& node (Join-Path $PSScriptRoot "dist/cli/dg.js") @args
'@
Set-Content -Path (Join-Path $BinDir "dg.ps1") -Value $dgPs1 -Encoding UTF8

$serverPs1 = @'
#!/usr/bin/env pwsh
& node (Join-Path $PSScriptRoot "dist/index.js") @args
'@
Set-Content -Path (Join-Path $BinDir "dreamgraph.ps1") -Value $serverPs1 -Encoding UTF8

Write-Ok "Shims created (dg.cmd, dg.ps1, dreamgraph.cmd, dreamgraph.ps1)"

# ── PATH setup ────────────────────────────────────────────────────
Write-Step "Configuring PATH..."

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable(
        "Path",
        "$BinDir;$userPath",
        "User"
    )
    Write-Ok "Added $BinDir to user PATH"
    Write-Warn "Restart your terminal for PATH changes to take effect"
} else {
    Write-Ok "$BinDir already in PATH"
}

# Update current session so verify works
$env:Path = "$BinDir;$env:Path"

# ── Verify ─────────────────────────────────────────────────────────
Write-Step "Verifying installation..."
try {
    $output = & node (Join-Path $DistTarget "cli/dg.js") --version 2>&1
    Write-Ok "$output"
} catch {
    Write-Warn "Verification failed: $_"
}

# ── Summary ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host ("=" * 50) -ForegroundColor Green
Write-Host " DreamGraph v$version installed successfully!" -ForegroundColor Green
Write-Host ("=" * 50) -ForegroundColor Green
Write-Host ""
Write-Host " Binary:   $BinDir" -ForegroundColor White
Write-Host " Run:      dg --help" -ForegroundColor White
Write-Host " Start:    dg start <instance> --http" -ForegroundColor White
Write-Host ""
