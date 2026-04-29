# Contributing to DreamGraph

Thanks for your interest in DreamGraph. This document explains what kinds of
contributions are welcome, what is **not** accepted, and how to propose
non-trivial changes.

## License & ownership

DreamGraph is **source-available**, not open source. See [LICENSE](LICENSE) and
[SECURITY.md](SECURITY.md) for the full terms. By submitting a contribution you
agree that it is licensed under the same terms as the rest of the repository
and that the maintainer may relicense it under future versions of the
DreamGraph license.

## Welcome contributions

- Bug reports with a clear reproduction (instance setup, command run, observed
  vs. expected behavior, daemon/extension log excerpt).
- Fixes for crashes, data-loss bugs, security issues, or correctness bugs in
  the cognitive engine, MCP tools, CLI, dashboard, Explorer, or VS Code
  extension.
- Documentation fixes for things that are wrong, broken, or out of date.
- Discussion-first proposals (open an issue) for new dream strategies, new
  MCP tools, new resource URIs, new tensions, or new graph entity types.

For anything non-trivial, **open an issue first** so we can confirm the
approach fits the architecture before you spend time on a PR.

## Not accepted

To keep the signal-to-noise ratio high, the following PRs will be closed
without review:

- **Badge-only PRs.** README badges (CodeQL, Snyk, FOSSA, CodeFactor,
  CodeRabbit, etc.) and "add our badge" PRs from third-party scanners. We pick
  badges deliberately. CodeQL Advanced is already configured in
  [.github/workflows/codeql.yml](.github/workflows/codeql.yml) and surfaced via
  badge in the README.
- **Workflow-template PRs** that drop in `.github/workflows/*.yml` without a
  prior issue (e.g. "add Dependabot", "add Greetings", "add Stale", "add
  CodeQL setup"). DreamGraph's CI/security setup is intentional. Open an
  issue first.
- **Cosmetic-only PRs** (whitespace, reformatting, renaming variables, "fix
  typos" against generated docs in `docs/`, mass dependency bumps without a
  reason).
- **AI-generated boilerplate PRs** with no demonstrated understanding of the
  cognitive engine, the AWAKE/REM/NORMALIZING state machine, or the
  data-store layout.
- **Edits to auto-generated artifacts.** Anything under `data/`, `docs/index.md`,
  `docs/live-docs/`, `docs/site/`, `docs/api-reference/`,
  `docs/architecture/`, `docs/data-model/`, `docs/features/`,
  `docs/ui-registry/`, `docs/workflows/`, `docs/narrative.md`, or built
  artifacts (`dist/`, `*.vsix`) — these are produced by the daemon, build
  pipeline, or release process. PRs that hand-edit them will be closed.

## Process for accepted PRs

1. Open an issue and get a thumbs-up on the approach.
2. Fork, branch from `main`, keep the change focused (one logical change per PR).
3. Update or add tests under [tests/](tests/). Run `npm test` and confirm all
   tests pass.
4. Run `npm run build` and `npm --prefix extensions/vscode run build` and
   confirm both are clean.
5. Update relevant documentation per the Documentation Maintenance Rule in
   [.github/copilot-instructions.md](.github/copilot-instructions.md) — version
   numbers, tool counts, resource counts, and workflow counts must stay
   consistent across `README.md`, `docs/README.md`, `docs/architecture.md`,
   `docs/tools-reference.md`, `docs/data-model.md`, and `docs/workflows.md`.
6. Open the PR with a description that explains **what** changed and **why**,
   and links the issue.

## Security

Do **not** open public issues or PRs for security vulnerabilities. Follow the
private disclosure path in [SECURITY.md](SECURITY.md).
