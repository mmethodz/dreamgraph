# Installing DreamGraph v7.0.0 "El Alarife"

One-command install from source. Builds the MCP server, deploys the `dg` CLI globally, and installs the VS Code extension.

---

## Prerequisites

| Requirement | Minimum | Check |
|-------------|---------|-------|
| **Node.js** | v18+ | `node --version` |
| **npm** | 8+ | `npm --version` |
| **Git** | any | `git --version` |
| **VS Code** | 1.100+ | Optional -- extension install is skipped if `code` is not in PATH |

---

## Quick Install

### Windows (PowerShell)

```powershell
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
.\scripts\install.ps1
```

### Linux / macOS (Bash)

```bash
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
bash scripts/install.sh
```

That's it. After install, open a **new terminal** and run:

```bash
dg --version          # DreamGraph CLI v7.0.0 (El Alarife)
dg --help             # Show all commands
```

---

## What the Installer Does

1. **Checks prerequisites** -- Node.js >= 18, npm available
2. **Builds** -- Runs `npm install` + `npm run build` (TypeScript compilation)
3. **Deploys to `~/.dreamgraph/bin/`** -- Copies compiled `dist/`, creates a production-only `package.json`, runs `npm install --omit=dev`
4. **Copies templates** -- Default instance templates to `~/.dreamgraph/templates/`
5. **Installs VS Code extension** -- Packages a VSIX, installs via `code --install-extension`, then installs runtime dependencies
6. **Creates command shims** -- `dg` and `dreamgraph` wrappers on PATH
7. **Configures PATH** -- Windows: adds to user PATH. Linux/macOS: creates shims in `~/.local/bin` or `/usr/local/bin`
8. **Verifies** -- Runs `dg --version` to confirm everything works

---

## Upgrade

Re-run the installer with `--force` (or `-Force` on PowerShell) to overwrite an existing installation:

```powershell
# Windows
.\scripts\install.ps1 -Force

# Linux / macOS
bash scripts/install.sh --force
```

---

## Uninstall

### Windows

```powershell
# Remove the installation directory
Remove-Item -Recurse -Force "$env:USERPROFILE\.dreamgraph"

# Remove from user PATH (edit manually or run)
$path = [Environment]::GetEnvironmentVariable("Path", "User")
$path = ($path -split ';' | Where-Object { $_ -notlike '*\.dreamgraph\bin*' }) -join ';'
[Environment]::SetEnvironmentVariable("Path", $path, "User")

# Remove VS Code extension
code --uninstall-extension siteledger.dreamgraph-vscode
```

### Linux / macOS

```bash
rm -rf ~/.dreamgraph
rm -f ~/.local/bin/dg ~/.local/bin/dreamgraph
# or if installed to /usr/local/bin:
# sudo rm -f /usr/local/bin/dg /usr/local/bin/dreamgraph

code --uninstall-extension siteledger.dreamgraph-vscode
```

---

## Custom Install Location

Set `DREAMGRAPH_MASTER_DIR` before running the installer to change the install directory:

```powershell
# Windows
$env:DREAMGRAPH_MASTER_DIR = "D:\tools\dreamgraph"
.\scripts\install.ps1

# Linux / macOS
DREAMGRAPH_MASTER_DIR=/opt/dreamgraph bash scripts/install.sh
```

---

## Installer Options

### `install.ps1` (Windows)

| Parameter | Description |
|-----------|-------------|
| `-SourceDir <path>` | Path to the DreamGraph source repo (default: current directory) |
| `-Force` | Overwrite existing installation without prompting |

### `install.sh` (Linux / macOS)

| Flag | Description |
|------|-------------|
| `--source <dir>` | Path to the DreamGraph source repo (default: parent of `scripts/`) |
| `--force` | Overwrite existing installation without prompting |
| `--help` | Show usage |

---

## Post-Install: First Run

```bash
# 1. Create your first instance
dg init --name my-project --project /path/to/your/repo

# 2. Start the daemon
dg start my-project

# 3. Open VS Code -- the DreamGraph sidebar appears automatically
code /path/to/your/repo
```

---

## Troubleshooting

### `dg` command not found after install

Open a **new terminal**. The PATH change only takes effect in new sessions.

On Linux/macOS, if `~/.local/bin` is not in your PATH, add to your shell rc file:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### VS Code extension not activating

1. Check the extension is installed: Extensions sidebar > search "DreamGraph"
2. If missing, the installer may have skipped it (VS Code `code` CLI not in PATH)
3. Manual install: `code --install-extension extensions/vscode/dreamgraph-vscode-0.1.0.vsix`
4. Reload VS Code: `Ctrl+Shift+P` > "Reload Window"

### Extension activation error (missing modules)

If the extension fails with "Cannot find module '@modelcontextprotocol/sdk'":

```powershell
# Windows
cd "$env:USERPROFILE\.vscode\extensions\siteledger.dreamgraph-vscode-0.1.0"
npm install --omit=dev

# Linux / macOS
cd ~/.vscode/extensions/siteledger.dreamgraph-vscode-0.1.0
npm install --omit=dev
```

Then reload VS Code.

### PowerShell execution policy error

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### Build fails

Make sure you have Node.js 18+ and npm installed. Run manually to see errors:

```bash
npm install
npm run build
```
