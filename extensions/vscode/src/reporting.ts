import * as vscode from 'vscode';

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

export function getReportingInstructionBlock(): string {
  const mode = getReportingMode();
  const trace = getTraceVisibility();
  return [
    '## Reporting Contract',
    `- **Narrative verbosity:** ${mode}`,
    `- **Trace visibility:** ${trace}`,
    '- Use layered verbosity: compress the same grounded result rather than becoming more rambling.',
    '- Structure responses using these sections when applicable: Executive Summary, Findings, Graph Updates, Evidence, Uncertainty, Recommended Next Step, Raw Trace.',
    mode === 'quiet'
      ? '- Quiet mode: show only what started, what finished, key result counts, blocking failures, and the next suggested step.'
      : mode === 'standard'
        ? '- Standard mode: show what was inspected, major findings, graph updates, uncertainty, and the next step.'
        : mode === 'deep'
          ? '- Deep mode: include tool flow, inspected paths/files, grounded findings, evidence basis, confidence/uncertainty, architectural interpretation, and next best action.'
          : '- Forensic mode: include everything in deep mode plus full provenance, failed attempts/adaptations, raw tool output sections, schema/constraint details, and tension rationale.',
    trace === 'hidden'
      ? '- Keep tool trace out of the main response unless explicitly required.'
      : trace === 'compact'
        ? '- Keep tool trace compact and summarized.'
        : '- Expand provenance and tool trace details.'
  ].join('\n');
}
