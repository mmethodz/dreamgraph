# DreamGraph Architecture

Version: **7.1.0**
License: **DreamGraph Source-Available Community License v2.0**

## Overview

DreamGraph is an instance-scoped, graph-first cognitive daemon for development environments. Its primary architectural rule is that the knowledge graph is authoritative: features, workflows, data models, ADRs, UI elements, and tensions represent the system at a higher semantic level than any individual source file.

Core architectural surfaces:

- **Daemon runtime** — serves MCP tools, dashboard routes, orchestration, and cognitive workflows
- **Instance subsystem** — isolates projects and runtime state by UUID-scoped instance boundaries
- **Knowledge graph** — captures system structure, behavior, decisions, and unresolved tensions
- **CLI (`dg`)** — lifecycle management, status, scanning, and operational commands
- **VS Code extension** — dashboard embedding, chat UX, daemon/MCP client integration, changed-files UX

## Instance Model

Each DreamGraph instance has its own root directory under the master directory (typically `~/.dreamgraph/<uuid>/`). The instance stores:

- `instance.json` — identity and lifecycle metadata
- `config/` — instance config such as policies and MCP repository bindings
- `data/` — graph and cognitive JSON state
- `runtime/` — locks, temp files, and transient runtime state
- `logs/` — daemon and subsystem logs
- `exports/` — generated outputs and snapshots

The instance scope enforces project and repository boundaries. Repository bindings are security-relevant because they expand the set of filesystem paths considered in-bounds.

## Runtime Surfaces

### Daemon
The daemon hosts:
- MCP tools
- dashboard HTTP routes
- orchestration routes
- cognitive scheduling and dream-cycle execution
- project/graph scanning and enrichment

### CLI
The `dg` CLI is responsible for:
- creating and starting instances
- showing status and daemon metadata
- scanning and operational commands
- user-facing control flow for local installations

### VS Code Extension
The extension integrates DreamGraph into the editor and currently lives under `extensions/vscode/src/`.

## Source Layout

This section is generated from the repository source tree. It should list all current files under the primary source roots.

```text
src/
  src/api/routes.ts
  src/cli/commands/attach.ts
  src/cli/commands/curate.ts
  src/cli/commands/enrich.ts
  src/cli/commands/export.ts
  src/cli/commands/fork.ts
  src/cli/commands/init.ts
  src/cli/commands/instances.ts
  src/cli/commands/lifecycle-ops.ts
  src/cli/commands/migrate.ts
  src/cli/commands/restart.ts
  src/cli/commands/scan.ts
  src/cli/commands/schedule.ts
  src/cli/commands/start.ts
  src/cli/commands/status.ts
  src/cli/commands/stop.ts
  src/cli/dg.ts
  src/cli/utils/daemon.ts
  src/cli/utils/mcp-call.ts
  src/cognitive/adversarial.ts
  src/cognitive/causal.ts
  src/cognitive/dreamer.ts
  src/cognitive/engine.ts
  src/cognitive/event-router.ts
  src/cognitive/federation.ts
  src/cognitive/graph-rag.ts
  src/cognitive/intervention.ts
  src/cognitive/llm.ts
  src/cognitive/lucid.ts
  src/cognitive/metacognition.ts
  src/cognitive/narrator.ts
  src/cognitive/normalizer.ts
  src/cognitive/register.ts
  src/cognitive/scheduler.ts
  src/cognitive/temporal.ts
  src/cognitive/types.ts
  src/config/config.ts
  src/discipline/artifacts.ts
  src/discipline/manifest.ts
  src/discipline/prompts.ts
  src/discipline/protection.ts
  src/discipline/register.ts
  src/discipline/session.ts
  src/discipline/state-machine.ts
  src/discipline/tool-proxy.ts
  src/discipline/tools.ts
  src/discipline/types.ts
  src/index.ts
  src/instance/bootstrap.ts
  src/instance/index.ts
  src/instance/lifecycle.ts
  src/instance/policies.ts
  src/instance/registry.ts
  src/instance/scope.ts
  src/instance/types.ts
  src/resources/register.ts
  src/server/dashboard.ts
  src/server/server.ts
  src/tools/adr-historian.ts
  src/tools/api-surface.ts
  src/tools/code-senses.ts
  src/tools/db-senses.ts
  src/tools/enrich-seed-data.ts
  src/tools/get-workflow.ts
  src/tools/git-senses.ts
  src/tools/init-graph.ts
  src/tools/living-docs-exporter.ts
  src/tools/query-resource.ts
  src/tools/register.ts
  src/tools/runtime-senses.ts
  src/tools/scan-project.ts
  src/tools/search-data-model.ts
  src/tools/solidify-insight.ts
  src/tools/ui-registry.ts
  src/tools/visual-architect.ts
  src/tools/web-senses.ts
  src/types/index.ts
  src/utils/atomic-write.ts
  src/utils/cache.ts
  src/utils/engine-env.ts
  src/utils/errors.ts
  src/utils/logger.ts
  src/utils/metrics.ts
  src/utils/mutex.ts
  src/utils/paths.ts
  src/utils/senses.ts
extensions/vscode/src/
  extensions/vscode/src/architect-llm.ts
  extensions/vscode/src/autonomy-contract.ts
  extensions/vscode/src/autonomy-loop.ts
  extensions/vscode/src/autonomy-structured.ts
  extensions/vscode/src/autonomy.ts
  extensions/vscode/src/changed-files-view.ts
  extensions/vscode/src/chat-memory.ts
  extensions/vscode/src/chat-panel.ts
  extensions/vscode/src/chat-panel.ts.good
  extensions/vscode/src/command-runner.ts
  extensions/vscode/src/commands.ts
  extensions/vscode/src/context-builder.ts
  extensions/vscode/src/context-inspector.ts
  extensions/vscode/src/daemon-client.ts
  extensions/vscode/src/dashboard-view.ts
  extensions/vscode/src/extension.ts
  extensions/vscode/src/graph-signal.ts
  extensions/vscode/src/health-monitor.ts
  extensions/vscode/src/instance-resolver.ts
  extensions/vscode/src/intent-detector.ts
  extensions/vscode/src/local-tools.ts
  extensions/vscode/src/mcp-client.ts
  extensions/vscode/src/prompts/architect-core.ts
  extensions/vscode/src/prompts/architect-explain.ts
  extensions/vscode/src/prompts/architect-patch.ts
  extensions/vscode/src/prompts/architect-suggest.ts
  extensions/vscode/src/prompts/architect-validate.ts
  extensions/vscode/src/prompts/index.ts
  extensions/vscode/src/reporting.ts
  extensions/vscode/src/status-bar.ts
  extensions/vscode/src/task-reporter.ts
  extensions/vscode/src/test/autonomy-actions.test.ts
  extensions/vscode/src/test/autonomy-contract.test.ts
  extensions/vscode/src/test/autonomy-loop.test.ts
  extensions/vscode/src/test/autonomy-prompt.test.ts
  extensions/vscode/src/test/autonomy-reporting.test.ts
  extensions/vscode/src/test/autonomy-structured.test.ts
  extensions/vscode/src/test/autonomy.test.ts
  extensions/vscode/src/test/card-renderer.test.ts
  extensions/vscode/src/test/chat-memory.test.ts
  extensions/vscode/src/test/entity-links.test.ts
  extensions/vscode/src/test/render-markdown.test.ts
  extensions/vscode/src/test/slice4-redaction.test.ts
  extensions/vscode/src/test/slice4-ui.test.ts
  extensions/vscode/src/test/slice4-verify.test.ts
  extensions/vscode/src/test/slice5-actions.test.ts
  extensions/vscode/src/test/slice5-audit.test.ts
  extensions/vscode/src/test/slice5-next-pass.test.ts
  extensions/vscode/src/test/slice5-runtime.test.ts
  extensions/vscode/src/test/slice5-ui.test.ts
  extensions/vscode/src/test/webview-bundle.test.ts
  extensions/vscode/src/types.ts
  extensions/vscode/src/webview/card-renderer.ts
  extensions/vscode/src/webview/entity-links.ts
  extensions/vscode/src/webview/index.ts
  extensions/vscode/src/webview/protocol.ts
  extensions/vscode/src/webview/render-markdown.ts
  extensions/vscode/src/webview/styles.ts
scripts/
  scripts/_codeql_scan.cjs
  scripts/_codeql_scan.js
  scripts/_fix_alert3.cjs
  scripts/_fix_codeql.cjs
  scripts/_grep_out.txt
  scripts/_grep.cjs
  scripts/_grep2.cjs
  scripts/_insights_out.json
  scripts/_mcp_call.cjs
  scripts/_mcp_init.json
  scripts/_mcp_insights.json
  scripts/_mcp_root.txt
  scripts/enrich-graph.mjs
  scripts/generate-architecture-tree.mjs
  scripts/install.ps1
  scripts/install.sh
```

## Version Semantics

A DreamGraph installation may surface more than one version value:

- **Created With** — the version recorded in an instance identity file when the instance was created
- **Daemon Version** — the version reported by the currently running daemon binary
- **Package Version** — the repository/package version declared in `package.json`

These values can legitimately differ after upgrades or when an older instance continues to run under a newer daemon.

## Licensing

DreamGraph is distributed under the **DreamGraph Source-Available Community License v2.0**. It is source-available and should not be described as OSI-approved open source unless a specific edition is separately released under such a license.

See `LICENSE` for the authoritative license text.
