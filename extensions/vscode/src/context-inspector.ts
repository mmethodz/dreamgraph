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

  logContextRequestBoundary(event: {
    instanceId?: string;
    intentMode?: string;
  }): void {
    const ts = new Date().toISOString();
    this._contextChannel.appendLine("");
    this._contextChannel.appendLine(
      `[${ts}] ── Request boundary ──${event.intentMode ? ` intent=${event.intentMode}` : ""}${event.instanceId ? ` instance=${event.instanceId}` : ""}`,
    );
  }

  /**
   * Log a context envelope to the output channel.
   */
  logEnvelope(envelope: EditorContextEnvelope): void {
    const ts = new Date().toISOString();

    this._contextChannel.appendLine(
      `[${ts}] Intent: ${envelope.intentMode} (confidence: ${envelope.intentConfidence.toFixed(2)})`,
    );

    if (envelope.instanceId) {
      this._contextChannel.appendLine(`[${ts}] Instance: ${envelope.instanceId}`);
    }

    if (envelope.activeFile) {
      const anchorHint = envelope.activeFile.selection?.summary
        ? `selection anchor: ${envelope.activeFile.selection.summary}`
        : `cursor anchor near the current focus point in ${envelope.activeFile.path} (approximate only; may drift)`;
      this._contextChannel.appendLine(
        `[${ts}] Active file: ${envelope.activeFile.path} (${envelope.activeFile.languageId}; ${anchorHint})`,
      );
      this._contextChannel.appendLine(
        `[${ts}] Cursor: line ${envelope.activeFile.cursorLine}, column ${envelope.activeFile.cursorColumn}`,
      );
      if (envelope.activeFile.selection) {
        this._contextChannel.appendLine(
          `[${ts}] Selection: lines ${envelope.activeFile.selection.startLine}-${envelope.activeFile.selection.endLine}`,
        );
      }
      if (envelope.activeFile.selection?.summary) {
        this._contextChannel.appendLine(
          `[${ts}] Selection anchor: ${envelope.activeFile.selection.summary}`,
        );
      }
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

    if (envelope.environmentContext) {
      this._contextChannel.appendLine(`[${ts}] Environment context:`);
      if (envelope.environmentContext.workspaceRuntime) {
        this._contextChannel.appendLine(
          `  - Workspace runtime: ${envelope.environmentContext.workspaceRuntime}`,
        );
      }
      if (envelope.environmentContext.workspacePackageManager) {
        this._contextChannel.appendLine(
          `  - Package manager: ${envelope.environmentContext.workspacePackageManager}`,
        );
      }
      const entries = envelope.environmentContext.entries ?? [];
      this._contextChannel.appendLine(`  - Rendered scopes: ${entries.length}`);
      for (const entry of entries) {
        this._contextChannel.appendLine(
          `    - ${entry.scope}: ${entry.runtime}; ${entry.moduleSystem}; ${entry.role}`,
        );
        if (entry.framework) {
          this._contextChannel.appendLine(`      framework: ${entry.framework}`);
        }
        if (entry.keyDependencies.length > 0) {
          this._contextChannel.appendLine(
            `      dependencies: ${entry.keyDependencies.slice(0, 5).join(", ")}`,
          );
        }
      }
    } else {
      this._contextChannel.appendLine(`[${ts}] Environment context: (not loaded)`);
    }

    if (envelope.graphContext) {
      const gc = envelope.graphContext;
      this._contextChannel.appendLine(`[${ts}] Graph context:`);
      this._contextChannel.appendLine(
        `  - Features (${gc.relatedFeatures.length}): ${gc.relatedFeatures.map((f) => `${f.id}:${f.name}`).join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - Workflows (${gc.relatedWorkflows.length}): ${gc.relatedWorkflows.map((w) => `${w.id}:${w.name}`).join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - ADRs (${gc.applicableAdrs.length}): ${gc.applicableAdrs.map((a) => `${a.id}:${a.title}`).join(", ") || "(none)"}`,
      );
      this._contextChannel.appendLine(
        `  - UI patterns (${gc.uiPatterns.length}): ${gc.uiPatterns.map((u) => `${u.id}:${u.name}`).join(", ") || "(none)"}`,
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

    this._contextChannel.appendLine("");
  }

  logReasoningPacket(packet: import("./types.js").ReasoningPacket): void {
    const ts = new Date().toISOString();
    const instrumentation = packet.instrumentation;

    this._contextChannel.appendLine(`[${ts}] Context packet summary:`);
    this._contextChannel.appendLine(
      `  - Intent: ${packet.task.intentMode}`,
    );
    this._contextChannel.appendLine(
      `  - Task: ${packet.task.summary}`,
    );
    this._contextChannel.appendLine(
      `  - Primary anchor: ${packet.primaryAnchor?.label ?? "(none)"}`,
    );
    this._contextChannel.appendLine(
      `  - Secondary anchors: ${packet.secondaryAnchors.length}`,
    );
    this._contextChannel.appendLine(
      `  - Evidence included: ${packet.evidence.length}`,
    );
    this._contextChannel.appendLine(
      `  - Evidence omitted: ${packet.omitted.length}`,
    );
    this._contextChannel.appendLine(
      `  - Token usage: ${packet.tokenUsage.used}/${packet.tokenUsage.budget} (reserved ${packet.tokenUsage.reserved})`,
    );

    if (instrumentation) {
      this._contextChannel.appendLine(`[${ts}] Context packet layers:`);
      this._contextChannel.appendLine(
        `  - task: ${instrumentation.layerTokenEstimates.task} tokens`,
      );
      this._contextChannel.appendLine(
        `  - environment: ${instrumentation.layerTokenEstimates.environment} tokens`,
      );
      this._contextChannel.appendLine(
        `  - code: ${instrumentation.layerTokenEstimates.code} tokens`,
      );
      this._contextChannel.appendLine(
        `  - graph: ${instrumentation.layerTokenEstimates.graph} tokens`,
      );
      this._contextChannel.appendLine(
        `  - notes: ${instrumentation.layerTokenEstimates.notes} tokens`,
      );
      this._contextChannel.appendLine(
        `  - total evidence: ${instrumentation.layerTokenEstimates.totalEvidence} tokens`,
      );
      this._contextChannel.appendLine(
        `  - included by kind: ${this._formatCounts(instrumentation.evidenceCounts.includedByKind)}`,
      );
      this._contextChannel.appendLine(
        `  - omitted by kind: ${this._formatCounts(instrumentation.evidenceCounts.omittedByKind)}`,
      );

      if (instrumentation.environment) {
        this._contextChannel.appendLine(`[${ts}] Environment metrics:`);
        this._contextChannel.appendLine(
          `  - matched scopes: ${instrumentation.environment.matchedScopes.join(", ") || "(none)"}`,
        );
        this._contextChannel.appendLine(
          `  - rendered scopes: ${instrumentation.environment.renderedScopeCount}`,
        );
        this._contextChannel.appendLine(
          `  - environment bytes/tokens: ${instrumentation.environment.bytes} bytes / ${instrumentation.environment.tokenEstimate} tokens`,
        );
      }

      if (instrumentation.cacheChurn) {
        this._contextChannel.appendLine(`[${ts}] Cache churn:`);
        this._contextChannel.appendLine(
          `  - stable prefix hash: ${instrumentation.cacheChurn.stablePrefixHash}`,
        );
        this._contextChannel.appendLine(
          `  - stable prefix bytes/tokens: ${instrumentation.cacheChurn.stablePrefixBytes} bytes / ${instrumentation.cacheChurn.stablePrefixTokenEstimate} tokens`,
        );
        this._contextChannel.appendLine(
          `  - stable reuse ratio: ${instrumentation.cacheChurn.stableReuseRatio ?? "n/a"}`,
        );
        this._contextChannel.appendLine(
          `  - churned: ${instrumentation.cacheChurn.churned}`,
        );
        this._contextChannel.appendLine(
          `  - packet volatility key: ${instrumentation.cacheChurn.packetVolatilityKey}`,
        );
      }
    }

    if (packet.evidence.length > 0) {
      this._contextChannel.appendLine(`[${ts}] Included evidence:`);
      for (const item of packet.evidence) {
        this._contextChannel.appendLine(
          `  - [${item.kind}] ${item.title} — ${item.tokenCost} tokens${item.required ? " (required)" : ""}`,
        );
      }
    }

    if (packet.omitted.length > 0) {
      this._contextChannel.appendLine(`[${ts}] Omitted evidence:`);
      for (const item of packet.omitted) {
        this._contextChannel.appendLine(
          `  - [${item.kind ?? "unknown"}] ${item.title} — ${item.reason}`,
        );
      }
    }

    this._contextChannel.appendLine("");
  }

  logTimeoutDiagnostics(event: {
    provider: string;
    model?: string;
    mode: 'stream' | 'tool';
    timeoutMs: number;
    recoveryAttempted: boolean;
    recovered: boolean;
    toolCount?: number;
    usedReducedContext?: boolean;
    errorMessage: string;
  }): void {
    const ts = new Date().toISOString();
    this._contextChannel.appendLine(`[${ts}] Timeout diagnostics:`);
    this._contextChannel.appendLine(`  - provider: ${event.provider}`);
    this._contextChannel.appendLine(`  - model: ${event.model ?? "(unknown)"}`);
    this._contextChannel.appendLine(`  - request mode: ${event.mode}`);
    this._contextChannel.appendLine(`  - timeout budget: ${event.timeoutMs} ms`);
    this._contextChannel.appendLine(`  - tool count: ${event.toolCount ?? 0}`);
    this._contextChannel.appendLine(`  - reduced context: ${event.usedReducedContext ? "yes" : "no"}`);
    this._contextChannel.appendLine(`  - recovery attempted: ${event.recoveryAttempted ? "yes" : "no"}`);
    this._contextChannel.appendLine(`  - recovered: ${event.recovered ? "yes" : "no"}`);
    this._contextChannel.appendLine(`  - error: ${event.errorMessage}`);
    this._contextChannel.appendLine("");
  }

  /**
   * Show and focus the context output channel.
   */
  showContextChannel(): void {
    this._contextChannel.show(true);
  }

  clearContextChannel(): void {
    this._contextChannel.clear();
  }

  /**
   * Append a one-off informational line to the DreamGraph Context channel.
   * Used for ad-hoc diagnostics like tool-selection rationale.
   */
  appendContextLine(line: string): void {
    const ts = new Date().toISOString();
    this._contextChannel.appendLine(`[${ts}] ${line}`);
  }

  /**
   * Log a structured LLM request-budget summary to the DreamGraph Context channel.
   * Called from the architect-llm budget guard before every outbound LLM call.
   */
  logRequestBudget(summary: {
    callsite: string;
    model: string;
    inputChars: number;
    approxTokens: number;
    sections: Array<{ name: string; chars: number; approxTokens: number }>;
    warn?: boolean;
  }): void {
    const ts = new Date().toISOString();
    const flag = summary.warn ? "⚠ OVERSIZED" : "ok";
    this._contextChannel.appendLine("");
    this._contextChannel.appendLine(
      `[${ts}] llm_input_budget [${flag}] callsite=${summary.callsite} model=${summary.model}`,
    );
    this._contextChannel.appendLine(
      `  total: ${summary.inputChars.toLocaleString()} chars (~${summary.approxTokens.toLocaleString()} tokens)`,
    );
    this._contextChannel.appendLine(`  top sections by size:`);
    for (const s of summary.sections) {
      this._contextChannel.appendLine(
        `    - ${s.name.padEnd(28)} ${s.chars.toLocaleString().padStart(10)} chars  (~${s.approxTokens.toLocaleString()} tok)`,
      );
    }
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

  private _formatCounts(
    counts: Partial<Record<string, number>>,
  ): string {
    const entries = Object.entries(counts).filter(([, value]) => typeof value === "number" && value > 0);
    return entries.length > 0
      ? entries.map(([key, value]) => `${key}=${value}`).join(", ")
      : "(none)";
  }

  /* ---- Dispose ---- */

  dispose(): void {
    this._contextChannel.dispose();
    this._statusChannel.dispose();
  }
}
