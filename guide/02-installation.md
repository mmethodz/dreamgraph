# 2. Installation

> **TL;DR** — Clone the repo, run `scripts/install.ps1 -Force` (Windows) or `bash scripts/install.sh --force` (macOS/Linux), open a new terminal, and run `dg --version`.

---

## Prerequisites

| Requirement | Minimum | Why |
|-------------|---------|-----|
| Node.js | 20+ | The build, the daemon, and the CLI all run on Node. |
| npm | 8+ | Comes with Node. |
| Git | any | To clone the repo and so DreamGraph can read commit history. |
| VS Code | 1.100+ | Optional. Skip if you only want the CLI/MCP server. |
| PowerShell 7+ *(Windows)* | 7+ | The installer is a `.ps1` script. |

Quick prerequisite check:

```bash
node --version
npm --version
git --version
code --version   # optional
```

---

## Install in one command

### Windows (PowerShell)

```powershell
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
.\scripts\install.ps1 -Force
```

### macOS / Linux

```bash
git clone https://github.com/mmethodz/dreamgraph.git
cd dreamgraph
bash scripts/install.sh --force
```

`-Force` / `--force` overwrites any existing install. Use it on first install too — it's safe and idempotent.

---

## What the installer does (so you can sanity-check it)

1. **Checks prerequisites** — refuses to run if Node is too old.
2. **Builds DreamGraph** — TypeScript compile + Vite build for the Explorer SPA.
3. **Deploys to `~/.dreamgraph/bin/`** — copies the compiled output, writes a production `package.json`, runs `npm install --omit=dev`.
4. **Copies templates** — default instance scaffolding goes to `~/.dreamgraph/templates/`.
5. **Packages and installs the VS Code extension** — only if `code` is on PATH.
6. **Creates `dg` and `dreamgraph` shims** — these are what you'll type day-to-day.
7. **Configures PATH** — adds `~/.dreamgraph/bin` to your user PATH on Windows; uses `~/.local/bin` or `/usr/local/bin` on Unix.
8. **Verifies** — runs `dg --version` to confirm.

---

## Post-install: open a NEW terminal

The installer modifies PATH. Your **current** terminal won't see the change. Open a fresh one and run:

```bash
dg --version
# DreamGraph CLI v8.1.0 (Atlas)

dg --help
# (lists every subcommand)
```

If `dg` is not found, see [Troubleshooting](12-troubleshooting-faq.md#dg-command-not-found-after-install).

---

## VS Code extension

If `code` was on PATH during install, the extension is already installed. Reload VS Code:

> `Ctrl+Shift+P` → "Reload Window"

You should see a **DreamGraph** icon in the activity bar (left sidebar).

If `code` was missing, install the extension manually:

```bash
cd extensions/vscode
npm run build
code --install-extension dreamgraph-vscode-8.1.0.vsix
```

---

## Upgrading

Pull the latest code and re-run the installer with the force flag:

```bash
git pull
# Windows
.\scripts\install.ps1 -Force
# macOS/Linux
bash scripts/install.sh --force
```

After upgrading: **restart any running daemons and reload VS Code windows**. The old runtime stays in memory until you do.

```bash
dg restart <instance-name>
```

---

## Uninstall

### Windows

```powershell
# Stop any running daemons first
dg stop <instance-name>

# Remove the install directory
Remove-Item -Recurse -Force "$env:USERPROFILE\.dreamgraph"

# Remove from PATH manually via System Properties → Environment Variables
# (look for an entry ending in \.dreamgraph\bin)
```

### macOS / Linux

```bash
dg stop <instance-name>
rm -rf ~/.dreamgraph
rm -f ~/.local/bin/dg ~/.local/bin/dreamgraph
# (or /usr/local/bin/ depending on where the installer put the shims)
```

To uninstall the VS Code extension: extensions panel → search "DreamGraph" → Uninstall.

---

## Where things live after install

| Path | What's there |
|------|--------------|
| `~/.dreamgraph/bin/` | The deployed runtime. |
| `~/.dreamgraph/templates/` | Instance scaffolding templates. |
| `~/.dreamgraph/<instance-uuid>/` | Per-instance data: config, graph data, logs. |
| `~/.dreamgraph/registry.json` | The list of all your instances. |

You'll get to know `<instance-uuid>` directories well — the graph data lives there.

---

## Next

Installer worked? Move to **[3. Your first instance](03-first-instance.md)**.
