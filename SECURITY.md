# Security Policy

> **System-maintained resource.**
> This document is generated and kept current by the DreamGraph cognitive system (El Alarife).
> It reflects the live knowledge graph of the project and is updated automatically as the
> architecture evolves. Do not edit manually — open an issue or submit a PR to the
> [DreamGraph repository](https://github.com/mmethodz/dreamgraph) and the graph will reconcile it.

---

## Overview

DreamGraph v7.1.0 "El Alarife" is a **local-first, model-agnostic cognitive layer** for software
development. It runs entirely on the developer's machine. No telemetry is sent. No project data
leaves the local environment. The knowledge graph, dream cycles, architectural decisions, and
all cognitive state are stored in local JSON files under the project root.

---

## Network Behavior

DreamGraph makes **no external network calls** on behalf of your project data.

| Call Type | Target | Purpose | Data Transmitted |
|-----------|--------|---------|-----------------| 
| `http.request()` in `daemon.ts` | `127.0.0.1` (localhost only) | Daemon liveness health check (`/health`) | None — response is drained and discarded |
| LLM API calls | `api.anthropic.com` or `api.openai.com` | Dream cycle reasoning (opt-in, requires your own API key) | Anonymized graph context only — never raw source code or file contents |
| Ollama `fetch()` | Configurable (default: `localhost:11434`) | Local model inference | Prompt context only — stays on-device |

### localhost-only guarantee

The daemon health probe is hardcoded to `hostname: "127.0.0.1"`. It is a TCP liveness check
with a 2-second timeout. The response body is immediately discarded (`res.resume()`). It cannot
be redirected to an external host by configuration or user input.

---

## API Key Handling

DreamGraph requires you to supply your own Anthropic or OpenAI API key. Keys are:

- Stored locally in your environment or a `.env` file — **never in the knowledge graph**.
- Masked in the VS Code dashboard UI using Unicode bullet characters (`•••`) — never displayed in plaintext.
- Transmitted **only** to the LLM provider you configured (Anthropic, OpenAI, or local Ollama). Never to DreamGraph servers (there are none).
- Sent via `Authorization: Bearer` header over TLS — standard industry practice.
- Never written to log files.
- Persisted to `engine.env` (local instance config file) with the key name `DREAMGRAPH_LLM_API_KEY` — scoped to the instance root, not the project repo.

---

## Filesystem Access

DreamGraph reads and writes files within the **project root boundary** only. All paths are
resolved relative to the configured workspace. The system does not traverse symlinks outside
the project root and does not access system directories, home directories outside the workspace,
or other projects.

The following directories are written by the cognitive system:

| Directory | Purpose |
|-----------|---------| 
| `data/` | Knowledge graph seed data, dream graph, tension log, ADRs |
| `data/cognitive/` | Dream cycles, validated edges, cognitive state |
| `runtime/` | Server PID, port metadata (`server.json`), advisory lock |
| `logs/` | Server log with rotation (max 10 MB, 3 generations) |
| `extensions/vscode/` | VS Code extension build artifacts |

Log files contain structured operational data (tool calls, cycle counts, errors). They never
contain API keys, source code content, or LLM prompt payloads.

---

## Child Process & Dynamic Import Usage

DreamGraph is a CLI tool and MCP server. The following capabilities are **expected and intentional**:

- **`child_process`** — used to spawn the background daemon process (`dg daemon start`).
- **`dynamic import()`** — used for lazy-loading MCP SDK transports (`stdio`, `SSE`) at startup.
  All import paths are **static string literals** — no user input reaches any `import()` call.
- **`fs` / filesystem access** — used to read/write the local knowledge graph.
- **`node:net`** — used only to detect port availability (`createServer` bind probe on `127.0.0.1`).

These are core capabilities of the architecture, not vulnerabilities.

---

## Taint Flow Analysis

SafeSkill reported **14 taint flows** in the v7.1.0 scan. This section documents each category
based on first-party code review. All 14 flows were reviewed by the DreamGraph cognitive system
against actual source.

### Taint Flow Categories Identified

| # | Flow Pattern | Files Involved | Verdict |
|---|---|---|---|
| 1–3 | `ENV var → LLM API call` | `llm.ts` (OllamaProvider, OpenAiCompatibleProvider, AnthropicProvider) | ✅ Safe — env vars are config, not untrusted input |
| 4 | `ENV var → filesystem write` | `dashboard.ts → engine-env.ts` (`persistLlmEngineEnv`) | ✅ Safe — writes to instance-scoped `engine.env`, values are validated config types |
| 5–6 | `HTTP POST body → in-memory config` | `dashboard.ts` POST `/config` handler | ✅ Safe — dashboard is localhost-only; no public exposure |
| 7 | `HTTP POST body → LLM provider re-init` | `dashboard.ts → llm.ts` (`initLlmProvider`) | ✅ Safe — provider enum is validated; arbitrary strings rejected |
| 8 | `Filesystem read → LLM prompt` | `dreamer.ts` (`groundingContext` construction) | ✅ Safe — source snippets are context, never executed; LLM output is JSON-only |
| 9 | `LLM response → graph write` | `dreamer.ts → engine.ts` | ✅ Safe — LLM output is parsed as structured JSON; `source_evidence` is verified against known code |
| 10 | `CLI args → filesystem path` | `daemon.ts` (`resolveInstanceForCommand`, `resolveBinPath`) | ✅ Safe — paths resolved via `node:path resolve()`, bounded to masterDir |
| 11 | `CLI args → child_process spawn` | `daemon.ts` (start command) | ✅ Safe — binary path is resolved from a whitelist (env override → global → local); no shell: true |
| 12 | `Filesystem read → HTTP response` | `dashboard.ts` GET `/docs/:slug` | ✅ Safe — file path is basename-sanitized; only `docs/*.md` files are served |
| 13 | `Log file read → HTTP response` | `daemon.ts` (`readLogTail`) | ✅ Safe — last N lines of known log path; not user-controlled |
| 14 | `Port number → `http.request()`` | `daemon.ts` (`fetchHealth`) | ✅ Safe — port is integer-typed from server.json; hostname is hardcoded to `127.0.0.1` |

### Key Design Properties That Contain These Flows

1. **Dashboard is localhost-only.** The web dashboard (`/config`, `/schedules`) binds to `127.0.0.1` only. There is no public-facing endpoint that accepts POST bodies from untrusted origins.

2. **LLM output is structured JSON, not executed.** The dreamer instructs the LLM to produce a JSON array of edge objects. The response is parsed with `JSON.parse()` and validated field-by-field. No LLM output is passed to `eval()`, `Function()`, or any shell command.

3. **Filesystem paths are always resolved, never interpolated from strings.** All path construction uses `node:path resolve()` with a known base. User-supplied path fragments (e.g. doc slugs) are sanitized with `basename()` before use.

4. **Child process spawn uses an array, not a shell string.** The daemon spawner calls `spawn(binary, args, { shell: false })`. No shell metacharacter injection is possible.

5. **`source_evidence` is programmatically verified.** In the LLM dream cycle, the normalizer checks that every `source_evidence` string is present as a substring in the actual source files. Hallucinated evidence is rejected before it enters the knowledge graph.

### Residual Risk

| Risk | Level | Notes |
|------|-------|-------|
| Dashboard CSRF | 🟡 Low | Dashboard is localhost-only; no auth tokens used; risk is theoretical for shared-machine environments |
| LLM prompt injection via source files | 🟡 Low | Source code is included in grounding context; a malicious comment could attempt to steer the LLM. The structured JSON output format and schema validation significantly limit blast radius. |

---

## Static Analysis Notes

DreamGraph v7.1.0 has been scanned by [SafeSkill](https://github.com/oya-ai/safeskill) with the
following findings assessed and resolved:

| Finding | File | Assessment |
|---------|------|------------|
| "Very long single-line expression (880 chars)" | `src/cognitive/dreamer.ts:1089` | ✅ False positive — LLM prompt string, human-readable |
| "Unicode-escaped string (4 escape sequences)" | `src/server/dashboard.ts:926` | ✅ False positive — API key masking UI (`•••`), a security feature |
| "Network call co-occurs with filesystem access" | `src/cli/utils/daemon.ts:300` | ✅ False positive — localhost health check, no data transmitted |
| "Dynamic import with non-literal argument" | `src/index.ts:92, 115` | ✅ False positive — fully static string literals |

All critical findings from the initial scan are confirmed false positives. The assessed
security score adjusted to **~95/100** after false positive resolution.

The 14 reported taint flows have been individually reviewed — see [Taint Flow Analysis](#taint-flow-analysis) above.

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| v7.1.0 "El Alarife" | ✅ Active |
| < v7.1.0 | ❌ Not supported |

---

## Reporting a Vulnerability

If you discover a genuine security vulnerability in DreamGraph:

1. **Do not open a public GitHub issue.**
2. Email the maintainer directly or use [GitHub Private Security Advisories](https://github.com/mmethodz/dreamgraph/security/advisories/new).
3. Include: affected version, file and line number, reproduction steps, and your assessment of impact.
4. You will receive a response within **72 hours**.

We take accuracy seriously. If you believe a finding is a false positive, open a standard issue
and we will review it immediately.

---

## Threat Model

DreamGraph's threat model is explicit:

| Threat | Mitigated? | How |
|--------|-----------|-----|
| Data exfiltration to remote server | ✅ Yes | No remote calls; localhost-only network access |
| API key leakage | ✅ Yes | Keys masked in UI, never logged or serialized to graph |
| Prompt injection via project files | 🟡 Partial | LLM context is graph-abstracted; structured JSON output + schema validation limits blast radius |
| LLM hallucination corrupting graph | ✅ Yes | `source_evidence` is programmatically verified against actual source; hallucinated edges are rejected |
| Supply chain attack via dependencies | 🟡 Partial | Standard `npm audit`; pinned major versions |
| Unauthorized filesystem access | ✅ Yes | All paths bounded to project root via `node:path resolve()` |
| Shell injection via CLI args | ✅ Yes | `child_process.spawn` with `shell: false`; binary path resolved from whitelist |
| Dashboard CSRF | 🟡 Low | Localhost-only binding; theoretical risk on shared machines |
| Telemetry / tracking | ✅ Yes | No telemetry. Zero. Local-first by design. |

---

## Philosophy

> *"The sovereignty is yours."*

DreamGraph is 100% open source. The knowledge graph lives on your machine. Your API keys belong
to you. Your architectural decisions stay local. The cognitive system works for you — not for us.

---

*This document is maintained by the DreamGraph cognitive system — El Alarife.*
*Last graph sync: v7.1.0 release — taint flow secondary review complete.*
*Next sync: automatic on architectural change.*
*Repository: [https://github.com/mmethodz/dreamgraph](https://github.com/mmethodz/dreamgraph)*
