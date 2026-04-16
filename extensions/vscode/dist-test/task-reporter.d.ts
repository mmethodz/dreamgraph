import * as vscode from "vscode";
export type ChangeKind = "created" | "modified" | "deleted" | "renamed" | "moved" | "entity_modified";
export interface OperationEntry {
    when: string;
    action: string;
    detail?: string;
    tool?: string;
    durationMs?: number;
}
export interface FileChangeEntry {
    path: string;
    kind: ChangeKind;
    entities?: {
        name: string;
        parent?: string;
    }[];
}
export interface GraphUpdateEntry {
    target: "features" | "workflows" | "data_model" | "capabilities" | "adr" | "ui" | "cognitive" | "api_surface" | "other";
    summary: string;
}
export interface TaskReportOptions {
    taskName: string;
    includeStdoutTail?: number;
}
/**
 * TaskReporter — accumulate actions, file changes, tool calls and errors during a multi‑step task
 * and emit a Copilot‑style final report.
 */
export declare class TaskReporter implements vscode.Disposable {
    private readonly options;
    private ops;
    private fileChanges;
    private graphUpdates;
    private errors;
    private stdoutChunks;
    private startedAt;
    private endedAt?;
    constructor(options: TaskReportOptions);
    addOp(op: OperationEntry): void;
    addFileChange(change: FileChangeEntry): void;
    addGraphUpdate(update: GraphUpdateEntry): void;
    addError(message: string, tool?: string): void;
    addStdout(data: string): void;
    private filterRelevantStdout;
    end(): void;
    toCopilotStyleSummary(success: boolean): string;
    dispose(): void;
}
export declare function nowIso(): string;
//# sourceMappingURL=task-reporter.d.ts.map