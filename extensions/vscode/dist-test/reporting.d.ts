import type { AutonomyMode } from './autonomy.js';
export type ReportingMode = 'quiet' | 'standard' | 'deep' | 'forensic';
export type TraceVisibility = 'hidden' | 'compact' | 'expanded';
export declare function getReportingMode(): ReportingMode;
export declare function getTraceVisibility(): TraceVisibility;
export declare function getAutonomyMode(): AutonomyMode;
export declare function getAutonomyPassBudget(): number | undefined;
export declare function parseAutonomyRequest(text: string, current: {
    mode: AutonomyMode;
    remainingAutoPasses: number;
    completedAutoPasses: number;
    totalAuthorizedPasses?: number;
}): {
    mode: AutonomyMode;
    remainingAutoPasses: number;
    completedAutoPasses: number;
    totalAuthorizedPasses: number | undefined;
};
export declare function getReportingInstructionBlock(): string;
//# sourceMappingURL=reporting.d.ts.map