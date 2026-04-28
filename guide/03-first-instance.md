# 3. Your first instance

> **TL;DR** — `dg init --name my-project --project /path/to/repo --transport http --port 8100`, then `dg start my-project --http`, then `dg status my-project`.

An **instance** is one DreamGraph brain. It owns a graph, a configuration, a daemon process, and (usually) one or more attached repositories. You can have as many instances as you want — typically one per project or product.

---

## Step 1 — Create the instance

```powershell
dg init --name my-project --project C:\code\my-project --transport http --port 8100
```

Flags:

| Flag | What it does | Default |
|------|--------------|---------|
| `--name <n>` | Human-readable instance name. Used in every other command. | random |
| `--project <path>` | Attach a repo immediately. You can do this later. | — |
| `--transport <http\|stdio>` | How the daemon exposes itself. Use `http` unless you have a specific MCP-stdio reason. | `http` |
| `--port <n>` | Preferred HTTP port. If busy, DreamGraph picks the next free one. | `8010` |
| `--template <name>` | Which template under `~/.dreamgraph/templates/` to seed config from. | `default` |
| `--policy <strict\|balanced\|creative>` | Cognitive engine policy profile. `balanced` is fine. | `balanced` |

What this creates:

- A new `~/.dreamgraph/<uuid>/` directory containing `config/`, `data/`, `logs/`.
- A registry entry so `dg` can find it by name.
- A seeded `config/engine.env` (next chapter wires it to your LLM).

You can now refer to the instance by name (`my-project`) instead of the UUID.

---

## Step 2 — Start the daemon

```powershell
dg start my-project --http
```

You'll see something like:

```
✓ DreamGraph daemon started — my-project (PID 17756, HTTP :8010)
```

The daemon now runs in the background. It will keep running until you stop it (or you reboot).

> **Stdio mode (advanced):** if an MCP client manages the process directly (e.g. Claude Desktop wants to spawn DreamGraph itself), use `dg start my-project --foreground` instead. Background stdio is intentionally rejected.

---

## Step 3 — Check status

```powershell
dg status my-project
```

This is the single most useful command in the system. It shows:

- Instance UUID and name
- Attached project root
- Daemon running state, PID, transport, port
- DreamGraph version recorded at instance creation, and the daemon version actually running
- Cognitive state (AWAKE/REM/etc.)
- Dream cycle count
- Counts: nodes, edges, tensions (active/resolved), ADRs, UI elements

If anything is off, `dg status` is your first stop.

---

## Step 4 — Attach a repo (if you didn't at init)

```powershell
dg attach C:\code\my-project --instance my-project
```

You can attach more than one repo to a single instance. See [11. Multi-repo](11-multi-repo.md).

To detach:

```powershell
dg detach --instance my-project
```

---

## Lifecycle commands at a glance

```powershell
dg start my-project --http      # start the daemon
dg stop my-project              # graceful stop (SIGTERM)
dg stop my-project --force      # SIGKILL
dg restart my-project           # stop + start
dg status my-project            # current state
```

---

## Listing all instances

```powershell
dg instances
dg instances list --status active
dg instances switch my-project    # set the "active" instance for this shell
```

The active instance is what `dg` uses when you omit the `<query>` argument.

---

## Common first-instance pitfalls

- **Forgot to start the daemon.** `dg status` will say "not running."
- **Port collision.** DreamGraph auto-picks a free port if your preferred one is busy. Look at the actual port in `dg status`, not the one you asked for.
- **Wrong project path.** `--project` must be an absolute path that exists.
- **Created the instance but never wired an LLM.** Most cognitive features will degrade gracefully but produce thin results. See [4. LLM setup](04-llm-setup.md).

---

## Next

Wire it to a model: **[4. LLM setup](04-llm-setup.md)**.
