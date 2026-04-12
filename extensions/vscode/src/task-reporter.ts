import * as vscode from "vscode";

export type ChangeKind = "created" | "modified" | "deleted" | "renamed" | "moved" | "entity_modified";

export interface OperationEntry {
  when: string; // ISO timestamp
  action: string;
  detail?: string;
  tool?: string;
  durationMs?: number;
}

export interface FileChangeEntry {
  path: string;
  kind: ChangeKind;
  entities?: { name: string; parent?: string }[];
}

export interface GraphUpdateEntry {
  target: "features" | "workflows" | "data_model" | "capabilities" | "adr" | "ui" | "cognitive" | "api_surface" | "other";
  summary: string;
}

export interface TaskReportOptions {
  taskName: string;
  includeStdoutTail?: number; // include last N lines of stdout in report body
}

/**
 * TaskReporter — accumulate actions, file changes, tool calls and errors during a multi‑step task
 * and emit a Copilot‑style final report.
 */
export class TaskReporter implements vscode.Disposable {
  private ops: OperationEntry[] = [];
  private fileChanges: FileChangeEntry[] = [];
  private graphUpdates: GraphUpdateEntry[] = [];
  private errors: { tool?: string; message: string }[] = [];
  private stdoutChunks: string[] = [];
  private startedAt = Date.now();
  private endedAt?: number;

  constructor(private readonly options: TaskReportOptions) {}

  addOp(op: OperationEntry): void {
    this.ops.push(op);
  }

  addFileChange(change: FileChangeEntry): void {
    this.fileChanges.push(change);
  }

  addGraphUpdate(update: GraphUpdateEntry): void {
    this.graphUpdates.push(update);
  }

  addError(message: string, tool?: string): void {
    this.errors.push({ message, tool });
  }

  addStdout(data: string): void {
    // Store trimmed chunks to keep memory in check
    if (!data) return;
    const trimmed = data.replace(/\x1b\[[0-9;]*m/g, ""); // strip ANSI
    this.stdoutChunks.push(trimmed);
    // keep last ~200 KB max
    const joined = this.stdoutChunks.join("");
    if (joined.length > 200_000) {
      // drop oldest half
      const half = Math.ceil(this.stdoutChunks.length / 2);
      this.stdoutChunks = this.stdoutChunks.slice(half);
    }
  }

  private filterRelevantStdout(stdout: string): string {
    const lines = stdout.split(/\r?\n/);
    const interesting = lines.filter((l) =>
      /\b(ERROR|ERR!|WARN|warning|fail|failed|failure|success|compiled|built|bundle|diagnostic|ts\d{3,4}|eslint|test|passing|skipping|deprecated)\b/i.test(l)
    );
    // If nothing matched, take the last N lines
    const tailCount = this.options.includeStdoutTail ?? 40;
    if (interesting.length === 0) {
      return lines.slice(Math.max(0, lines.length - tailCount)).join("\n");
    }
    // Limit to last 200 relevant lines to avoid spam
    return interesting.slice(-200).join("\n");
  }

  end(): void {
    this.endedAt = Date.now();
  }

  toCopilotStyleSummary(success: boolean): string {
    const durMs = (this.endedAt ?? Date.now()) - this.startedAt;
    const minutes = Math.floor(durMs / 60000);
    const seconds = Math.round((durMs % 60000) / 1000);
    const duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

    const filesByKind = new Map<ChangeKind, FileChangeEntry[]>();
    for (const fc of this.fileChanges) {
      const arr = filesByKind.get(fc.kind) ?? [];
      arr.push(fc);
      filesByKind.set(fc.kind, arr);
    }

    const filesSection = Array.from(filesByKind.entries())
      .map(([kind, arr]) => {
        const items = arr
          .map((f) => {
            const ents = f.entities && f.entities.length > 0
              ? ` (entities: ${f.entities.map((e) => (e.parent ? `${e.parent}.${e.name}` : e.name)).join(", ")})`
              : "";
            return `- ${f.path}${ents}`;
          })
          .join("\n");
        return `• ${kind}: ${arr.length}\n${items}`;
      })
      .join("\n");

    const opsSection = this.ops
      .map((o) => `- ${o.when} ${o.action}${o.tool ? ` [${o.tool}]` : ""}${o.detail ? ` — ${o.detail}` : ""}`)
      .join("\n");

    const graphSection = this.graphUpdates
      .map((g) => `- (${g.target}) ${g.summary}`)
      .join("\n");

    const errSection = this.errors.map((e) => `- ${e.tool ? `[${e.tool}] ` : ""}${e.message}`).join("\n");

    const stdoutJoined = this.stdoutChunks.join("");
    const stdoutSection = stdoutJoined ? this.filterRelevantStdout(stdoutJoined) : "";

    const header = success ? "Task completed successfully" : "Task completed with issues";

    return [
      `${header}: ${this.options.taskName} (${duration})`,
      "",
      opsSection ? "What I did:" : "",
      opsSection,
      "",
      filesSection ? "Files changed:" : "",
      filesSection,
      "",
      graphSection ? "Graph updates:" : "",
      graphSection,
      "",
      errSection ? "Errors/Warnings:" : "",
      errSection,
      "",
      stdoutSection ? "Relevant output:" : "",
      stdoutSection,
    ]
      .filter(Boolean)
      .join("\n");
  }

  dispose(): void {
    // no-op
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
