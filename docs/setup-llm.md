# LLM Setup Guide

This guide provides the correct DreamGraph LLM setup for both the daemon-side cognitive engine and the VS Code Architect.

## 1. Daemon-side engine configuration

DreamGraph reads per-instance engine settings from:

```text
~/.dreamgraph/<instance-uuid>/config/engine.env
```

These values are loaded into `process.env` at startup and override global environment variables for that instance.

### Supported core variables

```bash
DREAMGRAPH_LLM_PROVIDER=openai
DREAMGRAPH_LLM_URL=https://api.openai.com/v1
DREAMGRAPH_LLM_API_KEY=****
DREAMGRAPH_LLM_MODEL=gpt-4o-mini
DREAMGRAPH_LLM_TEMPERATURE=0.7
DREAMGRAPH_LLM_MAX_TOKENS=2048
```

### Dreamer / Normalizer split configuration

DreamGraph also supports separate settings for the two main cognitive LLM roles:

- **Dreamer**: creative hypothesis generation
- **Normalizer**: validation / truth filtering

Example:

```bash
DREAMGRAPH_LLM_PROVIDER=openai
DREAMGRAPH_LLM_URL=https://api.openai.com/v1
DREAMGRAPH_LLM_API_KEY=****

DREAMGRAPH_LLM_DREAMER_MODEL=gpt-4o-mini
DREAMGRAPH_LLM_DREAMER_TEMPERATURE=0.9
DREAMGRAPH_LLM_DREAMER_MAX_TOKENS=10240

DREAMGRAPH_LLM_NORMALIZER_MODEL=gpt-5.4-nano
DREAMGRAPH_LLM_NORMALIZER_TEMPERATURE=0.1
DREAMGRAPH_LLM_NORMALIZER_MAX_TOKENS=4096
```

Behavior:

- `DREAMGRAPH_LLM_MODEL`, `DREAMGRAPH_LLM_TEMPERATURE`, and `DREAMGRAPH_LLM_MAX_TOKENS` act as base defaults.
- `DREAMGRAPH_LLM_DREAMER_*` overrides apply only to the Dreamer.
- `DREAMGRAPH_LLM_NORMALIZER_*` overrides apply only to the Normalizer.
- If no Normalizer temperature is set, DreamGraph defaults it to `0.1`.

## 2. VS Code Architect configuration

The VS Code extension uses separate settings from the daemon.

Configure via:

- `dreamgraph.architect.provider`
- `dreamgraph.architect.model`
- `dreamgraph.architect.baseUrl` (when needed)
- `DreamGraph: Set Architect API Key` command for secrets

Important:

- daemon-side `engine.env` controls DreamGraph's internal cognitive engine
- VS Code Architect settings control the editor chat agent
- they are related but separate configuration surfaces

## 3. Anthropic / Opus 4.7 notes

If using Anthropic in the Architect, also see:

- [anthropic-opus-4-7.md](./anthropic-opus-4-7.md)

Key Anthropic extension settings:

- `dreamgraph.architect.anthropic.effort`
- `dreamgraph.architect.anthropic.adaptiveThinking`
- `dreamgraph.architect.anthropic.showThinkingSummary`

## 4. Common setup mistakes

### Wrong variable prefix

Do **not** use outdated `DG_LLM_*` names for engine configuration.

Use:

- `DREAMGRAPH_LLM_PROVIDER`
- `DREAMGRAPH_LLM_URL`
- `DREAMGRAPH_LLM_API_KEY`
- `DREAMGRAPH_LLM_MODEL`
- `DREAMGRAPH_LLM_DREAMER_*`
- `DREAMGRAPH_LLM_NORMALIZER_*`

### Confusing daemon config with extension config

These are different:

- `engine.env` configures the daemon's cognitive engine
- VS Code settings configure the Architect chat provider/model

### Expecting `.vscode/settings.json` to mirror all UI changes

Some Architect UI changes may persist to VS Code user settings rather than workspace settings.

## 5. Quick verification checklist

- `engine.env` exists under the correct instance `config/` directory
- variables use the `DREAMGRAPH_LLM_*` prefix
- provider, URL, and API key are present for cloud providers
- Dreamer and Normalizer overrides are set only when needed
- VS Code Architect provider/model are configured separately
- after changes, restart the daemon if needed
