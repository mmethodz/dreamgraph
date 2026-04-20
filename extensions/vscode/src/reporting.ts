import * as vscode from 'vscode';
import type { AutonomyMode } from './autonomy.js';

export type ReportingMode = 'quiet' | 'standard' | 'deep' | 'forensic';
export type TraceVisibility = 'hidden' | 'compact' | 'expanded';

export function getReportingMode(): ReportingMode {
  const value = (vscode.workspace.getConfiguration('dreamgraph.architect').get<string>('reportingMode') ?? 'standard').toLowerCase();
  return value === 'quiet' || value === 'deep' || value === 'forensic' ? value : 'standard';
}

export function getTraceVisibility(): TraceVisibility {
  const value = (vscode.workspace.getConfiguration('dreamgraph.architect').get<string>('traceVisibility') ?? 'compact').toLowerCase();
  return value === 'hidden' || value === 'expanded' ? value : 'compact';
}

export function getAutonomyMode(): AutonomyMode {
  const value = (vscode.workspace.getConfiguration('dreamgraph.architect').get<string>('autonomyMode') ?? 'cautious').toLowerCase();
  return value === 'conscientious' || value === 'eager' || value === 'autonomous' ? value : 'cautious';
}

export function getAutonomyPassBudget(): number | undefined {
  const value = vscode.workspace.getConfiguration('dreamgraph.architect').get<number>('autoPassBudget');
  return typeof value === 'number' && value > 0 ? value : undefined;
}

export function parseAutonomyRequest(text: string, current: { mode: AutonomyMode; remainingAutoPasses: number; completedAutoPasses: number; totalAuthorizedPasses?: number }) {
  const lower = text.toLowerCase();
  const mode: AutonomyMode =
    lower.includes('autonomous') ? 'autonomous'
      : lower.includes('eager') ? 'eager'
        : lower.includes('conscientious') ? 'conscientious'
          : lower.includes('cautious') ? 'cautious'
            : current.mode;
  const budgetMatch = lower.match(/next\s+(\d+)\s+passes|for\s+the\s+next\s+(\d+)\s+passes|for\s+(\d+)\s+passes/);
  const parsedBudget = budgetMatch ? Number(budgetMatch[1] ?? budgetMatch[2] ?? budgetMatch[3]) : current.totalAuthorizedPasses;
  return {
    mode,
    remainingAutoPasses: typeof parsedBudget === 'number' && parsedBudget > 0 ? parsedBudget : current.remainingAutoPasses,
    completedAutoPasses: 0,
    totalAuthorizedPasses: typeof parsedBudget === 'number' && parsedBudget > 0 ? parsedBudget : current.totalAuthorizedPasses,
  };
}

export function getReportingInstructionBlock(): string {
  const mode = getReportingMode();
  const trace = getTraceVisibility();
  return [
    '## Reporting Contract',
    `- **Narrative verbosity:** ${mode}`,
    `- **Trace visibility:** ${trace}`,
    '- Use layered verbosity: compress the same grounded result rather than becoming more rambling.',
    '- Structure responses using these sections when applicable: Executive Summary, Findings, Graph Updates, Evidence, Uncertainty, Recommended Next Step, Raw Trace.',
    '- In Evidence sections, prefer semantic anchors (entity names, workflow steps, ADR ids, file paths, stable excerpts). If line numbers are shown, mark them as approximate drift-prone hints rather than canonical references.',
    mode === 'quiet'
      ? '- Quiet mode: show only what started, what finished, key result counts, blocking failures, the visible pass counters when active, and the next suggested step.'
      : mode === 'standard'
        ? '- Standard mode: show what was inspected, major findings, graph updates, uncertainty, visible counters when active, and the next step.'
        : mode === 'deep'
          ? '- Deep mode: include tool flow, inspected paths/files, grounded findings, evidence basis, confidence/uncertainty, architectural interpretation, selected next actions, counter transitions, and next best action.'
          : '- Forensic mode: include everything in deep mode plus full provenance, failed attempts/adaptations, raw tool output sections, schema/constraint details, tension rationale, stall-detection signals, action-selection provenance, and counter snapshots.',
    trace === 'hidden'
      ? '- Keep tool trace out of the main response unless explicitly required.'
      : trace === 'compact'
        ? '- Keep tool trace compact and summarized.'
        : '- Expand provenance and tool trace details.'
  ].join('\n');
}
