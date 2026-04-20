"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReportingMode = getReportingMode;
exports.getTraceVisibility = getTraceVisibility;
exports.getAutonomyMode = getAutonomyMode;
exports.getAutonomyPassBudget = getAutonomyPassBudget;
exports.parseAutonomyRequest = parseAutonomyRequest;
exports.getReportingInstructionBlock = getReportingInstructionBlock;
const vscode = __importStar(require("vscode"));
function getReportingMode() {
    const value = (vscode.workspace.getConfiguration('dreamgraph.architect').get('reportingMode') ?? 'standard').toLowerCase();
    return value === 'quiet' || value === 'deep' || value === 'forensic' ? value : 'standard';
}
function getTraceVisibility() {
    const value = (vscode.workspace.getConfiguration('dreamgraph.architect').get('traceVisibility') ?? 'compact').toLowerCase();
    return value === 'hidden' || value === 'expanded' ? value : 'compact';
}
function getAutonomyMode() {
    const value = (vscode.workspace.getConfiguration('dreamgraph.architect').get('autonomyMode') ?? 'cautious').toLowerCase();
    return value === 'conscientious' || value === 'eager' || value === 'autonomous' ? value : 'cautious';
}
function getAutonomyPassBudget() {
    const value = vscode.workspace.getConfiguration('dreamgraph.architect').get('autoPassBudget');
    return typeof value === 'number' && value > 0 ? value : undefined;
}
function parseAutonomyRequest(text, current) {
    const lower = text.toLowerCase();
    const mode = lower.includes('autonomous') ? 'autonomous'
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
function getReportingInstructionBlock() {
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
//# sourceMappingURL=reporting.js.map