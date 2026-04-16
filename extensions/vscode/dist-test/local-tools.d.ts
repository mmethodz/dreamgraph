/**
 * Local Extension Tools — executed directly in the VS Code extension host.
 *
 * These tools do NOT require an MCP daemon connection. They use VS Code APIs
 * and Node child_process directly for maximum speed and reliability.
 *
 * Tools:
 *   run_command   — Shell execution with stdout/stderr capture + OutputChannel
 *   modify_entity — Entity-level code editing via VS Code symbol provider
 *   write_file    — Create or overwrite a file in the workspace
 *   read_local_file — Read a local file (full or line range)
 *
 * Also exports registerRunnerCommands() for manual palette access to run_command.
 */
import * as vscode from 'vscode';
export declare const LOCAL_TOOL_DEFINITIONS: readonly [{
    readonly name: "run_command";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly command: {
                readonly type: "string";
                readonly description: "Shell command to execute (e.g. \"npm run build\", \"tsc --noEmit\").";
            };
            readonly cwd: {
                readonly type: "string";
                readonly description: "Working directory, relative to workspace root. Defaults to workspace root.";
            };
            readonly timeoutMs: {
                readonly type: "number";
                readonly description: "Timeout in ms (default 60 000, max 300 000).";
            };
        };
        readonly required: readonly ["command"];
    };
}, {
    readonly name: "modify_entity";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly filePath: {
                readonly type: "string";
                readonly description: "Absolute or workspace-relative path to the file.";
            };
            readonly entity: {
                readonly type: "string";
                readonly description: "Name of the entity to replace.";
            };
            readonly parentEntity: {
                readonly type: "string";
                readonly description: "Parent class/interface name for members. Omit for top-level entities.";
            };
            readonly newContent: {
                readonly type: "string";
                readonly description: "Complete replacement code for the entity.";
            };
        };
        readonly required: readonly ["filePath", "entity", "newContent"];
    };
}, {
    readonly name: "write_file";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly filePath: {
                readonly type: "string";
                readonly description: "Absolute or workspace-relative path.";
            };
            readonly content: {
                readonly type: "string";
                readonly description: "Full file content to write.";
            };
        };
        readonly required: readonly ["filePath", "content"];
    };
}, {
    readonly name: "read_local_file";
    readonly description: string;
    readonly inputSchema: {
        readonly type: "object";
        readonly properties: {
            readonly filePath: {
                readonly type: "string";
                readonly description: "Absolute or workspace-relative path.";
            };
            readonly startLine: {
                readonly type: "number";
                readonly description: "1-based start line (inclusive). Omit to read entire file.";
            };
            readonly endLine: {
                readonly type: "number";
                readonly description: "1-based end line (inclusive).";
            };
        };
        readonly required: readonly ["filePath"];
    };
}];
export declare function isLocalTool(name: string): boolean;
export declare function executeLocalTool(name: string, input: Record<string, unknown>): Promise<string>;
export declare function registerRunnerCommands(ctx: vscode.ExtensionContext): void;
//# sourceMappingURL=local-tools.d.ts.map