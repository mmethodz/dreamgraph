import { TaskReporter } from "./task-reporter.js";
export interface CmdSpec {
    cmd: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    name?: string;
}
export interface RunResult {
    exitCode: number;
    output: string;
}
export declare class CommandRunner {
    private readonly reporter;
    constructor(reporter: TaskReporter);
    runSequence(commands: CmdSpec[]): Promise<RunResult[]>;
    private runOne;
}
export declare function runBuildAndInstall(force?: boolean): Promise<{
    success: boolean;
    summary: string;
    exitCode: number;
}>;
//# sourceMappingURL=command-runner.d.ts.map