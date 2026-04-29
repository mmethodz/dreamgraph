# 12. Troubleshooting & FAQ

> **TL;DR** — Run `dg status <name>` first. It answers most "what's wrong?" questions in one line.

This page is organized by symptom. Skim until you see your problem.

---

## Install / `dg` command

### `dg` command not found after install

PATH changes only apply to **new** terminals. Open a fresh shell.

If a new shell still doesn't see it:

- **Windows:** check that `%USERPROFILE%\.dreamgraph\bin` is in your user PATH (System Properties → Environment Variables).
- **macOS/Linux:** check that `~/.local/bin` (or `/usr/local/bin` if installed there) is in your shell rc file:
  ```bash
  export PATH="$HOME/.local/bin:$PATH"
  ```

### PowerShell execution policy error

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

### Build fails

Make sure Node is 20+ and npm is 8+. Try a manual build to see real errors:

```bash
npm install
npm run build
```

### Installer skipped the VS Code extension

The installer only installs the extension if `code` is on PATH. Install manually:

```bash
cd extensions/vscode
npm run build
code --install-extension dreamgraph-vscode-8.2.0.vsix
```

---

## Daemon

### `dg start` says "already running"

There's an existing daemon for this instance. Either use it (`dg status`) or replace it (`dg restart`).

### Daemon won't start — port in use

DreamGraph auto-picks a free port if your preferred one is busy. If startup still fails, the message names the conflicting process. Pick a different port:

```powershell
dg start my-project --http --port 8300
```

### Daemon started but nothing responds

```powershell
dg status my-project
```

If status shows "running" but the actual port is different from what you typed, that's the auto-pick. Use the actual port shown by status.

### Daemon died unexpectedly

Check the log:

```bash
~/.dreamgraph/<instance-uuid>/logs/daemon-<date>.log
```

Common causes:

- Out of memory on a large monorepo scan
- LLM provider returning errors that bubbled up
- File-system permission errors on `~/.dreamgraph/`

Restart with:

```powershell
dg restart my-project
```

### Watcher spam / `cache.invalidated` every 30s

Fixed in v8.1.0+. If you're seeing this, you're on an older daemon. Pull the latest, run the installer, restart.

---

## VS Code extension

### Extension didn't activate

1. Reload window: `Ctrl+Shift+P` → **Reload Window**.
2. Check it's installed: Extensions panel → search "DreamGraph".
3. If installed but inactive, check the Output panel → "DreamGraph" channel for errors.

### Extension activation error: "Cannot find module"

Runtime dependencies didn't install. Fix:

```powershell
# Windows
cd "$env:USERPROFILE\.vscode\extensions\siteledger.dreamgraph-vscode-8.2.0"
npm install --omit=dev
```

Then reload.

### Sidebar disappeared

Click the **DreamGraph** indicator in the bottom status bar. Or:

> `Ctrl+Shift+P` → **DreamGraph: Show Dashboard**

This is intentional v8.x behavior — the sidebar no longer auto-restores on every editor focus event.

### Architect won't reply

Three usual causes:

1. **No API key.** Run `Ctrl+Shift+P` → **DreamGraph: Set Architect API Key**.
2. **Wrong model id.** Check `dreamgraph.architect.model` in settings. Typos here are silent.
3. **Wrong base URL.** If you set `dreamgraph.architect.baseUrl` to a custom value, double-check it.

### Dashboard / Explorer stuck on "Loading…"

Stale daemon connection. `Ctrl+Shift+P` → **DreamGraph: Connect to Daemon**, reconnect.

---

## Graph quality

### Candidates panel shows "? → ? edge"

Fixed in v8.1.0+. Stale candidates whose underlying dream entity was pruned are now hidden from the actionable list and shown as a count: *"N stale candidate(s) hidden."* If you still see "? → ?" rows, you're on older code — upgrade.

### Dream cycles produce zero candidates

A few possibilities:

- **Empty graph.** Run `dg scan` first.
- **No LLM configured** and you asked for `strategy=llm_dream`. Switch to a structural strategy or wire an LLM.
- **Strategy benched.** The engine benches strategies that produce zero results for several cycles. It probes them every 6th cycle. Run a couple more cycles or use `strategy=all`.

### Dream cycles produce too many candidates

You're on `policy=creative`, or your repo just has lots of inferable structure. Either:

- Switch to `policy=balanced` or `strict` (edit `instance.json`, restart).
- Lower `max_dreams` per cycle.
- Run `dg curate` to merge near-duplicates.

### Tensions are exploding

The engine caps active tensions at 200 (lowest-urgency auto-archive when the cap is hit), so this is bounded — but it can still feel noisy. Triage in batches:

- Reject obvious false positives.
- `wont_fix` anything about removed code.
- Resolve anything you've actually fixed.

### Validated edges look wrong

Promote was too aggressive. You can:

- Manually reject (Explorer → click edge → reject mutation).
- Switch to `policy=strict`.
- Add an ADR contradicting the bad inference — future cycles will weigh it heavily.

---

## LLM / providers

### "Provider not configured" or "API key missing"

Check `~/.dreamgraph/<uuid>/config/engine.env`. Restart the daemon after editing.

### Local Ollama is very slow

That's the trade-off. You can either:

- Use a smaller model (`qwen3:8b` instead of `qwen3:14b`).
- Switch to a hosted provider for the Dreamer role only:
  ```bash
  DREAMGRAPH_LLM_DREAMER_MODEL=gpt-4o-mini
  DREAMGRAPH_LLM_NORMALIZER_MODEL=qwen3:8b
  ```
  (You'd need different provider/URL/key per role — currently the daemon uses one provider for both. Track this in your project plan if it matters.)

### OpenAI returns 401 / 403

Bad key or wrong base URL. Verify:

```bash
curl -H "Authorization: Bearer $KEY" https://api.openai.com/v1/models | head
```

### GPT-5.5 calls succeed but tool replies are blank or run together

Fixed in v8.1.0+ — the verbose-mode response extractor inserts paragraph breaks between message items. Upgrade if you're on an older version.

---

## Data and files

### Where do I find the JSON files?

```
~/.dreamgraph/<instance-uuid>/data/
```

### Can I edit them by hand?

Don't, while the daemon is running. The daemon writes atomically (`<file>.tmp` + rename), so your edits will lose to the next save. Stop the daemon first if you really must.

### How do I back up an instance?

```powershell
dg export my-project --format snapshot
```

Snapshot exports go under the instance directory. You can also just tar/zip the whole `~/.dreamgraph/<uuid>/` folder — it's all there.

### How do I migrate an old flat `data/` directory to a UUID instance?

```powershell
dg migrate --source path/to/old-data --name migrated-project
```

### How do I fork an instance to experiment?

```powershell
dg fork my-project --name my-project-experiment
```

You get a copy with a fresh UUID. Mutate freely.

---

## Versions

### `Created With` and `Daemon Version` differ in `dg status`

That's expected after upgrades. `Created With` is the DreamGraph version recorded when the instance was initialized; `Daemon Version` is what's running now. They can drift indefinitely without issue — instances are forward-compatible within a major version.

### I upgraded but behavior didn't change

You forgot to restart. After every upgrade:

```powershell
dg restart <name>
```

…and reload VS Code (`Ctrl+Shift+P` → **Reload Window**).

---

## "I just want to start over"

```powershell
dg stop my-project
dg destroy my-project --confirm
dg init --name my-project --project C:\code\my-project --transport http --port 8100
dg start my-project --http
dg scan my-project
```

Your code isn't touched. Only the DreamGraph instance data is erased.

---

## Still stuck?

1. Capture `dg status <name>` output.
2. Capture the last 50 lines of `~/.dreamgraph/<uuid>/logs/daemon-<date>.log`.
3. File an issue at <https://github.com/mmethodz/dreamgraph/issues>.

---

## Next

Last page — **[13. Glossary](13-glossary.md)** — definitions for every weird word in this guide.
