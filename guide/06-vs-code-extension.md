# 6. The VS Code extension

> **TL;DR** — Click the **DreamGraph** icon in the activity bar. You get a chat panel (Architect), a dashboard, an Explorer view, and a changed-files panel. The status-bar item is your bring-it-back button if a panel disappears.

The extension is the easiest way to live with DreamGraph. This page is a guided tour.

---

## First-time activation

1. Reload VS Code after installing the extension (`Ctrl+Shift+P` → **Reload Window**).
2. Open the workspace folder for a repo you've attached to a DreamGraph instance.
3. Click the **DreamGraph** icon in the left activity bar.

The extension auto-discovers a running daemon on the standard ports and connects. If multiple instances are running, you can switch via the command palette.

---

## The four panels

### 1. Architect (chat)

The Architect is a conversational AI that has every DreamGraph MCP tool wired up. It can:

- Read your code with repo awareness (`read_source_code`)
- Query the graph (`query_resource system://features`, etc.)
- Run dream cycles, record ADRs, resolve tensions
- Edit files when you ask it to

It uses whichever model you configured in [4. LLM setup](04-llm-setup.md) under `dreamgraph.architect.*` settings.

Useful behavior:

- **Ask architectural questions first.** *"What workflows touch the user table?"* gets a graph-grounded answer; *"how do I write a for loop"* doesn't need the graph.
- **Mention files by path.** The Architect honors workspace-relative paths.
- **Ask it to record decisions.** *"Record an ADR: we picked Postgres because we need real transactions."*
- **Ask it to run cycles.** *"Run a dream cycle focused on tensions."*

### 2. Dashboard

A read-only summary of the current instance:

- Cognitive state (AWAKE/REM/etc.)
- Counts: nodes, edges, tensions, ADRs, dream cycles run
- Recent events (cycles, normalizations, tension creations)
- Connection state (which instance, which port, which version)

Use the dashboard as your at-a-glance health check. If you only look at one panel, look here.

### 3. DreamGraph Explorer

The interactive graph view. Big enough to deserve its own page — see [7. The Explorer](07-the-explorer.md).

### 4. Changed files

Lists files modified since the last commit (or since you opened the workspace). Each row is a quick way to ask the Architect "what does this change touch in the graph?" without you having to type the path.

---

## The status bar item

When all DreamGraph panels are hidden (e.g. a layout change collapsed the sidebar), a small **DreamGraph** indicator appears in the bottom status bar. Click it to bring the activity-bar container back.

This was a deliberate change in v8.x — older versions auto-restored the sidebar on every editor focus event, which caused multi-second cursor stalls. The status bar is the new safe entry point.

You can also use:

- `Ctrl+Shift+P` → **DreamGraph: Show Dashboard**
- `Ctrl+Shift+P` → **DreamGraph: Open Chat**

---

## Connecting to a daemon

If the extension can't find a daemon, you'll see a "Disconnected" badge. Reconnect via:

> `Ctrl+Shift+P` → **DreamGraph: Connect to Daemon**

You can paste a URL like `http://localhost:8010` or pick from a discovered list.

If the daemon isn't running:

```powershell
dg start my-project --http
```

…then click reconnect.

---

## Local tools

The extension exposes a small set of **local tools** to the Architect that act on your VS Code workspace directly (open file, show diff, run task, etc.). These are separate from MCP tools — they need direct access to VS Code's API.

You don't have to do anything to enable them. The Architect picks them as needed.

---

## Useful commands

`Ctrl+Shift+P` and type "DreamGraph":

| Command | Effect |
|---------|--------|
| **DreamGraph: Show Dashboard** | Pop the dashboard view forward. |
| **DreamGraph: Open Chat** | Focus the Architect chat. |
| **DreamGraph: Open Explorer** | Open the graph Explorer. |
| **DreamGraph: Set Architect API Key** | Store an LLM key in VS Code's secret storage. |
| **DreamGraph: Connect to Daemon** | Connect/reconnect to a running instance. |
| **DreamGraph: Reload Window** | (Use the built-in `Reload Window` after upgrades.) |

---

## When something seems wrong

1. **Status bar shows "Disconnected"** — the daemon isn't running or moved ports. Run `dg status <name>`.
2. **Panel is empty / shows "Loading…" forever** — usually a stale connection. `Ctrl+Shift+P` → **DreamGraph: Connect to Daemon**, then reconnect.
3. **Architect won't reply** — no API key configured, or the model id is wrong. See [4. LLM setup](04-llm-setup.md) §VS Code Architect.
4. **Sidebar disappeared** — click the DreamGraph status-bar item.
5. **You upgraded but behavior didn't change** — reload the VS Code window. The old extension code is still in memory.

---

## Next

The Explorer is where the graph comes alive: **[7. The Explorer](07-the-explorer.md)**.
