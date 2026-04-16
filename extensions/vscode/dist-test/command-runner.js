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
exports.CommandRunner = void 0;
exports.runBuildAndInstall = runBuildAndInstall;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const task_reporter_js_1 = require("./task-reporter.js");
class CommandRunner {
    reporter;
    constructor(reporter) {
        this.reporter = reporter;
    }
    async runSequence(commands) {
        const results = [];
        for (const spec of commands) {
            const label = spec.name ?? spec.cmd;
            this.reporter.addOp({ when: (0, task_reporter_js_1.nowIso)(), action: `run: ${label}`, tool: "cmd", detail: spec.cwd });
            const res = await this.runOne(spec);
            results.push(res);
            if (res.exitCode !== 0) {
                this.reporter.addError(`Command failed (${label}) with exit code ${res.exitCode}`, "cmd");
                break; // stop on first failure
            }
        }
        return results;
    }
    runOne(spec) {
        return new Promise((resolve) => {
            const child = (0, child_process_1.spawn)(spec.cmd, {
                cwd: spec.cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                env: { ...process.env, ...(spec.env ?? {}) },
                shell: true,
            });
            let buffer = "";
            child.stdout?.on("data", (d) => {
                const s = d.toString();
                buffer += s;
                this.reporter.addStdout(s);
            });
            child.stderr?.on("data", (d) => {
                const s = d.toString();
                buffer += s;
                this.reporter.addStdout(s);
            });
            child.on("close", (code) => {
                resolve({ exitCode: code ?? -1, output: buffer });
            });
        });
    }
}
exports.CommandRunner = CommandRunner;
async function runBuildAndInstall(force = true) {
    const reporter = new task_reporter_js_1.TaskReporter({ taskName: "Build VSCode extension and install DreamGraph", includeStdoutTail: 60 });
    const runner = new CommandRunner(reporter);
    // Determine repo root and scripts path
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const extDir = root ? `${root}/extensions/vscode` : undefined;
    const installCmd = process.platform === "win32"
        ? `pwsh -NoProfile -ExecutionPolicy Bypass -File ./scripts/install.ps1 ${force ? "-force" : ""} -Verbose`
        : `bash ./scripts/install.sh ${force ? "-f" : ""} -v`;
    const cmds = [
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
//# sourceMappingURL=command-runner.js.map