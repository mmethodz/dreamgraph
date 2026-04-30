# 4. LLM setup

> **TL;DR** — Edit `~/.dreamgraph/<instance-uuid>/config/engine.env`, set `DREAMGRAPH_LLM_PROVIDER`, `DREAMGRAPH_LLM_URL`, `DREAMGRAPH_LLM_API_KEY`, and a model. Restart the daemon. The VS Code Architect is configured separately in VS Code settings.

DreamGraph has **two** distinct LLM configurations. Don't mix them up:

1. **Daemon-side engine** — used by the cognitive engine (dreaming, normalizing, etc.). Lives in `engine.env`.
2. **VS Code Architect** — used by the chat panel in VS Code. Lives in VS Code settings.

You can run with only one of them configured. Many users only ever set the Architect.

---

## Part 1 — Daemon-side engine

### Where the config lives

```
~/.dreamgraph/<instance-uuid>/config/engine.env
```

You can find the UUID from `dg status <name>`.

### Minimum viable config

```bash
DREAMGRAPH_LLM_PROVIDER=openai
DREAMGRAPH_LLM_URL=https://api.openai.com/v1
DREAMGRAPH_LLM_API_KEY=sk-...
DREAMGRAPH_LLM_MODEL=gpt-4o-mini
```

After editing: **`dg restart <name>`**. Config is read at startup.

### Supported providers

| Provider | URL example | Notes |
|----------|-------------|-------|
| `openai` | `https://api.openai.com/v1` | Most common. Needs `DREAMGRAPH_LLM_API_KEY`. |
| `anthropic` | `https://api.anthropic.com` | Needs `DREAMGRAPH_LLM_API_KEY`. |
| `ollama` | `http://localhost:11434` | Local. No API key. Default model `qwen3:8b`. |
| `lmstudio` | `http://localhost:1234/v1` | Local. OpenAI-compatible server inside LM Studio. Load a model in the UI, start its server, set the model id. API key is ignored — the literal `lm-studio` is sent automatically. |
| `sampling` | — | Uses the MCP client's own sampling capability. No URL/key needed. |
| `none` | — | Disables LLM features. Structural strategies still work. |

### Dreamer / Normalizer split

The cognitive engine has two roles with very different needs:

- **Dreamer** — creative hypothesis generation. Higher temperature, larger budget.
- **Normalizer** — strict validation. Low temperature, smaller budget.

A good split for OpenAI:

```bash
DREAMGRAPH_LLM_PROVIDER=openai
DREAMGRAPH_LLM_URL=https://api.openai.com/v1
DREAMGRAPH_LLM_API_KEY=sk-...

DREAMGRAPH_LLM_DREAMER_MODEL=gpt-4o-mini
DREAMGRAPH_LLM_DREAMER_TEMPERATURE=0.9
DREAMGRAPH_LLM_DREAMER_MAX_TOKENS=10240

DREAMGRAPH_LLM_NORMALIZER_MODEL=gpt-5.4-nano
DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE=0.1
DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS=4096
```

Rules:

- `DREAMGRAPH_LLM_MODEL` / `_TEMPERATURE` / `_MAX_TOKENS` are the base defaults.
- `DREAMGRAPH_LLM_DREAMER_*` overrides only apply to the Dreamer.
- `DREAMGRAPH_LLM_NORMALIZER_*` overrides only apply to the Normalizer.
- If no Normalizer temperature is set, it defaults to `0.1`.

### Saving a config as a template

If you find a setup you like, save it as a template so future instances inherit it:

```bash
# Copy the default template scaffold
cp -r ~/.dreamgraph/templates/default ~/.dreamgraph/templates/openai

# Edit ~/.dreamgraph/templates/openai/config/engine.env to taste

# Use it on a new instance
dg init --name another-project --template openai
```

---

## Part 2 — VS Code Architect

The Architect is the chat panel in VS Code. It is configured through VS Code settings, not `engine.env`.

### Settings to configure

Open VS Code settings (`Ctrl+,`) and search for `dreamgraph.architect`:

| Setting | Purpose |
|---------|---------|
| `dreamgraph.architect.provider` | `openai`, `anthropic`, `ollama`, etc. |
| `dreamgraph.architect.model` | Model id (e.g. `gpt-5.5`, `claude-3-5-sonnet`). |
| `dreamgraph.architect.baseUrl` | Override only when needed (custom proxy, Azure, etc.). |
| `dreamgraph.architect.openai.reasoningEffort` | GPT-5.5 only: `low`, `medium`, `high`. |
| `dreamgraph.architect.openai.verbosity` | GPT-5.5 only: text verbosity. |

### Setting the API key

Don't paste the key into settings.json. Use the command palette:

> `Ctrl+Shift+P` → **DreamGraph: Set Architect API Key**

Keys are stored in VS Code's secret storage.

### GPT-5.5 / OpenAI Responses API

For `gpt-5.5*` models, the Architect uses the OpenAI Responses API (not Chat Completions). This is automatic — DreamGraph detects the model id and switches transports. You get:

- Responses-style `input` instead of `messages`
- Function-tool calling with `function_call` / `function_call_output` replay
- `reasoning.effort` and `text.verbosity` controls

The DreamGraph knowledge graph remains the source of memory; Responses API is used statelessly.

---

## Picking a model

For most users:

- **OpenAI users:** `gpt-4o-mini` for both roles is a fine starting point. Upgrade Dreamer to `gpt-4o` or `gpt-5.5` if cycles feel shallow.
- **Anthropic users:** `claude-3-5-haiku` for Normalizer, `claude-3-5-sonnet` for Dreamer.
- **Local-first / privacy-first:** Ollama with `qwen3:8b` (default) or `qwen3:14b` if your machine can handle it. Cycles will be slower.
- **LM Studio users:** any GGUF you've loaded in LM Studio works. Copy its model id from the LM Studio UI into `DREAMGRAPH_LLM_MODEL`. Start with the same model for Dreamer and Normalizer; split later if you have a smaller validator model loaded as well.

---

## Verifying it works

After editing `engine.env` and restarting:

```bash
dg restart my-project
dg status my-project
```

Then trigger a small dream cycle from the VS Code Architect or via MCP:

> Ask the Architect: *"run a dream cycle with strategy `gap_detection` and max_dreams 5"*

If you see candidate edges appear in the Explorer's Candidates panel, the LLM is wired correctly. If you get an error about provider/key, re-check `engine.env` and that you actually restarted.

---

## Next

You have an instance with a brain. Now feed it: **[5. Bootstrapping the graph](05-bootstrapping-the-graph.md)**.
