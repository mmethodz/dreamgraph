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
import type {
  EditorContextEnvelope,
  HealthState,
  ResolvedInstance,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Context Inspector                                                 */
/* ------------------------------------------------------------------ */

export class ContextInspector implements vscode.Disposable {
  private readonly _contextChannel: vscode.OutputChannel;
  private readonly _statusChannel: vscode.OutputChannel;

  constructor() {
    this._contextChannel = vscode.window.createOutputChannel(
      "DreamGraph Context",
    );
    this._statusChannel = vscode.window.createOutputChannel(
      "DreamGraph: Instance Status",
    );
  }

  /* ---- Context Envelope Logging (§3.6) ---- */

  /**
   * Log a context envelope to the output channel.
   */
  logEnvelope(envelope: EditorContextEnvelope): void {
    const ts = new Date().toISOString();

    this._contextChannel.appendLine(
      `[${ts}] Intent: ${envelope.intentMode} (confidence: ${envelope.intentConfidence.toFixed(2)})`,
    );

    if (envelope.activeFile) {
      this._contextChannel.appendLine(
        `[${ts}] Active file: ${envelope.activeFile.path} (${envelope.activeFile.languageId}, line ${envelope.activeFile.cursorLine})`,
      );
    } else {
      this._contextChannel.appendLine(`[${ts}] Active file: (none)`);
    }

    if (envelope.visibleFiles.length > 0) {
      this._contextChannel.appendLine(
        `[${ts}] Visible files: ${envelope.visibleFiles.join(", ")}`,
      );
    }

    if (envelope.changedFiles.length > 0) {
      this._contextChannel.appendLine(
        `[${ts}] Changed files: ${envelope.changedFiles.join(", ")}`,
      );
    }

    if (envelope.graphContext) {
      const gc = envelope.graphContext;
      this._contextChannel.appendLine(`[${ts}] Graph context:`);
      this._contextChannel.appendLine(
        `  - Features: ${gc.relatedFeatures.join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - Workflows: ${gc.relatedWorkflows.join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - ADRs: ${gc.applicableAdrs.join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - UI patterns: ${gc.uiPatterns.join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - Tensions: ${gc.activeTensions} active`,
      );
      this._contextChannel.appendLine(
        `  - Cognitive state: ${gc.cognitiveState}`,
      );
    } else {
      this._contextChannel.appendLine(`[${ts}] Graph context: (not loaded)`);
    }

    this._contextChannel.appendLine(""); // blank separator
  }

  /**
   * Show and focus the context output channel.
   */
  showContextChannel(): void {
    this._contextChannel.show(true);
  }

  /* ---- Instance Status (§2.6.1) ---- */

  /**
   * Format and display full instance status in the status output channel.
   */
  showInstanceStatus(
    instance: ResolvedInstance | null,
    health: HealthState,
  ): void {
    this._statusChannel.clear();

    const header = "DreamGraph Instance Status";
    const sep = "─".repeat(header.length + 4);

    this._statusChannel.appendLine(header);
    this._statusChannel.appendLine(sep);

    if (!instance) {
      this._statusChannel.appendLine("No instance bound to workspace.");
      this._statusChannel.appendLine("");
      this._statusChannel.appendLine(
        'Use "DreamGraph: Connect Instance" to bind an instance.',
      );
      this._statusChannel.show(true);
      return;
    }

    const statusIcon =
      health.status === "connected"
        ? "✓"
        : health.status === "degraded"
          ? "⚠"
          : "✗";

    const lines: [string, string][] = [
      ["Name", instance.name],
      ["UUID", instance.uuid],
      ["Mode", instance.mode],
      ["Status", `${health.status} ${statusIcon}`],
      ["Daemon PID", instance.daemon.pid?.toString() ?? "—"],
      ["Port", instance.daemon.port?.toString() ?? "—"],
      ["Transport", instance.daemon.transport],
      ["Version", instance.daemon.version ?? "—"],
      ["Latency", `${health.latencyMs}ms`],
      ["Cognitive", health.cognitiveState.toUpperCase()],
      ["Sessions", health.sessions.toString()],
      ["LLM", health.llmAvailable ? "available" : "unavailable"],
      ["Source", instance.source],
    ];

    const maxKeyLen = Math.max(...lines.map(([k]) => k.length));
    for (const [key, value] of lines) {
      this._statusChannel.appendLine(
        `  ${key.padEnd(maxKeyLen + 2)}${value}`,
      );
    }

    this._statusChannel.appendLine("");
    this._statusChannel.appendLine(
      `Last check: ${health.lastCheck.toISOString()}`,
    );
    this._statusChannel.show(true);
  }

  /* ---- Raw Output (M2+ command results) ---- */

  /**
   * Show raw text output in the context channel (used for Architect responses
   * when the chat panel is not visible).
   */
  showRawOutput(text: string): void {
    this._contextChannel.appendLine(text);
    this._contextChannel.appendLine("");
    this._contextChannel.show(true);
  }

  /* ---- Dispose ---- */

  dispose(): void {
    this._contextChannel.dispose();
    this._statusChannel.dispose();
  }
}
