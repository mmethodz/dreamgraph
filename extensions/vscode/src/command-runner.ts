import * as vscode from "vscode";
import { spawn } from "child_process";
import { TaskReporter, nowIso } from "./task-reporter.js";

export interface CmdSpec {
  cmd: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  name?: string; // friendly label
}

export interface RunResult {
  exitCode: number;
  output: string;
}

export class CommandRunner {
  constructor(private readonly reporter: TaskReporter) {}

  async runSequence(commands: CmdSpec[]): Promise<RunResult[]> {
    const results: RunResult[] = [];
    for (const spec of commands) {
      const label = spec.name ?? spec.cmd;
      this.reporter.addOp({ when: nowIso(), action: `run: ${label}`, tool: "cmd", detail: spec.cwd });
      const res = await this.runOne(spec);
      results.push(res);
      if (res.exitCode !== 0) {
        this.reporter.addError(`Command failed (${label}) with exit code ${res.exitCode}`, "cmd");
        break; // stop on first failure
      }
    }
    return results;
  }

  private runOne(spec: CmdSpec): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => {
      const child = spawn(spec.cmd, {
        cwd: spec.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        env: { ...process.env, ...(spec.env ?? {}) },
        shell: true,
      });

      let buffer = "";

      child.stdout?.on("data", (d: Buffer) => {
        const s = d.toString();
        buffer += s;
        this.reporter.addStdout(s);
      });

      child.stderr?.on("data", (d: Buffer) => {
        const s = d.toString();
        buffer += s;
        this.reporter.addStdout(s);
      });

      child.on("close", (code: number | null) => {
        resolve({ exitCode: code ?? -1, output: buffer });
      });
    });
  }
}

export async function runBuildAndInstall(force = true): Promise<{ success: boolean; summary: string; exitCode: number }>{
  const reporter = new TaskReporter({ taskName: "Build VSCode extension and install DreamGraph", includeStdoutTail: 60 });
  const runner = new CommandRunner(reporter);

  // Determine repo root and scripts path
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const extDir = root ? `${root}/extensions/vscode` : undefined;

  const installCmd = process.platform === "win32"
    ? `pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/install.ps1 ${force ? "-force" : ""} -Verbose`
    : `bash ./scripts/install.sh ${force ? "-f" : ""} -v`;

  const cmds: CmdSpec[] = [
    { cmd: "npm ci", cwd: extDir, name: "npm ci (vscode)" },
    { cmd: "npm run build", cwd: extDir, name: "build (vscode)" },
    { cmd: installCmd, cwd: root, name: "install dreamgraph" },
  ];

  const results = await runner.runSequence(cmds);
  const last = results[results.length - 1];
  const success = last?.exitCode === 0 && results.every((r) => r.exitCode === 0);
  reporter.end();
  const summary = reporter.toCopilotStyleSummary(success);

  // Show in an output channel mimicking Copilot
  const channel = vscode.window.createOutputChannel("DreamGraph • Tasks");
  channel.clear();
  channel.appendLine(summary);
  channel.show(true);

  return { success, summary, exitCode: last?.exitCode ?? -1 };
}
