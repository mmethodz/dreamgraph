/**
 * DreamGraph Context Inspector — Layer 1 (VS Code Integration).
 *
 * Provides an Output Channel ("DreamGraph Context") that shows the current
 * EditorContextEnvelope for debugging and transparency.
 *
 * Also manages the "DreamGraph: Instance Status" output channel for the
 * showStatus command.
 *
 * @see TDD §3.6 (Context Inspector), §2.6.1 (showStatus)
 */
import * as vscode from "vscode";
import type { EditorContextEnvelope, HealthState, ResolvedInstance } from "./types.js";
export declare class ContextInspector implements vscode.Disposable {
    private readonly _contextChannel;
    private readonly _statusChannel;
    constructor();
    /**
     * Log a context envelope to the output channel.
     */
    logEnvelope(envelope: EditorContextEnvelope): void;
    /**
     * Show and focus the context output channel.
     */
    showContextChannel(): void;
    /**
     * Format and display full instance status in the status output channel.
     */
    showInstanceStatus(instance: ResolvedInstance | null, health: HealthState): void;
    /**
     * Show raw text output in the context channel (used for Architect responses
     * when the chat panel is not visible).
     */
    showRawOutput(text: string): void;
    dispose(): void;
}
//# sourceMappingURL=context-inspector.d.ts.map