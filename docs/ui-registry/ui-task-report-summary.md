# Task Report Summary

> Present a structured end-of-task report for multi-step DreamGraph extension tasks, consolidating operations, file changes, graph updates, warnings, and filtered stdout into a Copilot-style summary artifact.

**ID:** `ui_task_report_summary`  
**Category:** feedback  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| task_name | `string` | ✅ | Human-readable task name included in the final report header. |
| operations | `array<object>` | ❌ | Chronological operations with action, tool, detail, timestamp, and optional duration. |
| file_changes | `array<object>` | ❌ | Files changed during the task, grouped by kind and optionally annotated with entity names. |
| graph_updates | `array<object>` | ❌ | Knowledge-graph updates such as UI, features, workflows, ADR, cognitive, or API surface changes. |
| errors | `array<object>` | ❌ | Warnings and errors captured during execution. |
| stdout | `string` | ❌ | Accumulated stdout/stderr chunks from tool or command execution. |

### Outputs

*No outputs defined.*

## Interactions

- **review_task_outcome** — Read the final structured summary of what changed and what completed.
- **inspect_relevant_output** — Review filtered diagnostic output chosen for relevance rather than raw verbosity.
- **audit_graph_updates** — Check whether the task also updated graph state alongside source changes.

## Visual Semantics

- **Role:** card
- **Emphasis:** secondary
- **Density:** comfortable
- **Chrome:** embedded

### State Styling

- **successful** — Use calm completion emphasis with readable structure over celebratory styling.
- **warning_present** — Escalate specific sections that need review while keeping the overall report scannable.
- **error_present** — Promote the failure summary and relevant evidence without collapsing detail sections.

## Layout Semantics

- **Pattern:** stack
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** scroll, collapse

### Layout Hierarchy

- **summary_header** — primary
- **change_and_graph_sections** — primary
- **supporting_output** — secondary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| vscode | `Structured report generator` | extensions/vscode/src/task-reporter.ts | Tracks task operations in memory, groups file changes by kind, filters stdout for relevant lines, and emits a final Copilot-style summary string. |

**Used by features:** feature_vscode_extension, feature_agentic_tool_execution_loop, feature_ui_registry

**Tags:** vscode, reporting, verification, task-summary, stdout-filtering, visual-meta-v3
