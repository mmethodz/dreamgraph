/**
 * DreamGraph Command Handlers — Layer 1 (VS Code Integration).
 *
 * Implements all v1 commands:
 *   M1: connect, reconnect, switchInstance, showStatus,
 *       openDashboard, startDaemon, stopDaemon, inspectContext
 *   M2: explainFile, checkAdrCompliance
 *   M5: openChat, setArchitectApiKey
 *
 * Plus the internal statusQuickPick (status bar click).
 *
 * @see TDD §2.6 (Commands), §5.2 (v1 Commands)
 */

import * as vscode from "vscode";
import * as cp from "node:child_process";

import type { DaemonClient } from "./daemon-client.js";
import type { McpClient } from "./mcp-client.js";
import type { HealthMonitor } from "./health-monitor.js";
import type { StatusBarManager } from "./status-bar.js";
import type { ContextInspector } from "./context-inspector.js";
import type { ArchitectLlm, ArchitectProvider, ArchitectMessage } from "./architect-llm.js";
import type { ContextBuilder } from "./context-builder.js";
import type { ChatPanel } from "./chat-panel.js";
import type { GraphSignalProvider } from "./graph-signal.js";
import type { DashboardViewProvider } from "./dashboard-view.js";
import type { ResolvedInstance, RegistryEntry } from "./types.js";
import {
  resolveInstance,
  readRegistry,
  queryCliStatus,
  type ResolveOptions,
} from "./instance-resolver.js";
import { assemblePrompt } from "./prompts/index.js";

/* ------------------------------------------------------------------ */
/*  Shared Services (injected from extension.ts)                      */
/* ------------------------------------------------------------------ */

export interface CommandServices {
  daemonClient: DaemonClient;
  mcpClient: McpClient;
  healthMonitor: HealthMonitor;
  statusBar: StatusBarManager;
  contextInspector: ContextInspector;
  architectLlm: ArchitectLlm;
  contextBuilder: ContextBuilder;
  chatPanel: ChatPanel;
  graphSignal: GraphSignalProvider;
  dashboardView: DashboardViewProvider;
  /** Get the current resolved instance */
  getInstance: () => ResolvedInstance | null;
  /** Set the current resolved instance */
  setInstance: (instance: ResolvedInstance | null) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function getConfig<T>(key: string): T | undefined {
  return vscode.workspace
    .getConfiguration("dreamgraph")
    .get<T>(key);
}

function getWorkspaceFolderPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function buildResolveOptions(): ResolveOptions {
  return {
    workspaceInstanceUuid: getConfig<string>("instanceUuid"),
    workspaceFolderPath: getWorkspaceFolderPath(),
    masterDir: getConfig<string>("masterDir") ?? "~/.dreamgraph",
    daemonHost: getConfig<string>("daemonHost") ?? "127.0.0.1",
  };
}

/* ------------------------------------------------------------------ */
/*  Command: Connect Instance (§2.3, §2.6)                            */
/* ------------------------------------------------------------------ */

export async function connectCommand(svc: CommandServices): Promise<void> {
  svc.statusBar.setConnecting();

  const options = buildResolveOptions();
  const { instance, registryEntries } = await resolveInstance(options);

  if (instance) {
    await connectToInstance(svc, instance);
  } else if (registryEntries.length > 0) {
    // Manual fallback — show quick pick
    const picked = await showInstancePicker(registryEntries, null);
    if (picked) {
      const resolved = await resolveInstance({
        ...options,
        workspaceInstanceUuid: picked.uuid,
      });
      if (resolved.instance) {
        await connectToInstance(svc, resolved.instance);
        return;
      }
    }
    svc.statusBar.setDisconnected();
    vscode.window.showInformationMessage(
      "DreamGraph: No instance selected.",
    );
  } else {
    svc.statusBar.setDisconnected();
    const action = await vscode.window.showWarningMessage(
      "DreamGraph: No instances found in registry.",
      "Open Master Dir",
    );
    if (action === "Open Master Dir") {
      const masterDir = options.masterDir.startsWith("~")
        ? options.masterDir.replace("~", require("os").homedir())
        : options.masterDir;
      void vscode.env.openExternal(vscode.Uri.file(masterDir));
    }
  }
}

/**
 * Actually connect to a resolved instance.
 */
async function connectToInstance(
  svc: CommandServices,
  instance: ResolvedInstance,
): Promise<void> {
  svc.setInstance(instance);

  if (!instance.daemon.running) {
    const shouldStart = await vscode.window.showInformationMessage(
      `DreamGraph: Daemon for "${instance.name}" is not running.`,
      "Start Daemon",
      "Cancel",
    );
    if (shouldStart === "Start Daemon") {
      await startDaemonCommand(svc);
    } else {
      svc.statusBar.setDisconnected();
      return;
    }
  }

  // Update client endpoints — port MUST come from CLI status, never hardcoded
  const host = getConfig<string>("daemonHost") ?? "127.0.0.1";
  const port = instance.daemon.port;
  if (!port) {
    vscode.window.showErrorMessage(
      `DreamGraph: Cannot determine daemon port for "${instance.name}". Is the daemon running?`,
    );
    svc.statusBar.setDisconnected();
    return;
  }
  svc.daemonClient.updateEndpoint(host, port);
  svc.mcpClient.updateBaseUrl(`http://${host}:${port}`);
  svc.dashboardView.updateDaemonUrl(host, port);

  // Start health monitoring
  const interval = getConfig<number>("healthCheckInterval") ?? 10000;
  const reconnect = getConfig<number>("reconnectInterval") ?? 30000;
  svc.healthMonitor.start(instance.uuid, interval, reconnect);

  // Connect MCP client
  try {
    await svc.mcpClient.connect();
  } catch (err) {
    vscode.window.showWarningMessage(
      `DreamGraph: MCP connection failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  svc.statusBar.update(svc.healthMonitor.state, instance.name);
}

/* ------------------------------------------------------------------ */
/*  Command: Reconnect (§2.6)                                         */
/* ------------------------------------------------------------------ */

export async function reconnectCommand(svc: CommandServices): Promise<void> {
  const instance = svc.getInstance();
  if (!instance) {
    vscode.window.showWarningMessage(
      "DreamGraph: No instance bound. Use Connect first.",
    );
    return;
  }

  svc.healthMonitor.reconnect();

  // Reconnect MCP
  try {
    await svc.mcpClient.connect();
  } catch {
    // Health monitor will handle the state
  }
}

/* ------------------------------------------------------------------ */
/*  Command: Switch Instance (§2.6.2)                                 */
/* ------------------------------------------------------------------ */

export async function switchInstanceCommand(
  svc: CommandServices,
): Promise<void> {
  const masterDir = getConfig<string>("masterDir") ?? "~/.dreamgraph";
  const registry = await readRegistry(masterDir);

  if (registry.length === 0) {
    vscode.window.showWarningMessage(
      "DreamGraph: No instances in registry.",
    );
    return;
  }

  const current = svc.getInstance();
  const picked = await showInstancePicker(registry, current);

  if (!picked) return; // user cancelled

  // Disconnect from current
  svc.healthMonitor.stop();
  await svc.mcpClient.disconnect();

  // Update workspace setting
  await vscode.workspace
    .getConfiguration("dreamgraph")
    .update("instanceUuid", picked.uuid, vscode.ConfigurationTarget.Workspace);

  // Connect to new instance
  await connectCommand(svc);
}

/* ------------------------------------------------------------------ */
/*  Command: Show Status (§2.6.1)                                     */
/* ------------------------------------------------------------------ */

export function showStatusCommand(svc: CommandServices): void {
  svc.contextInspector.showInstanceStatus(
    svc.getInstance(),
    svc.healthMonitor.state,
  );
}

/* ------------------------------------------------------------------ */
/*  Command: Open Dashboard (§2.6)                                    */
/* ------------------------------------------------------------------ */

export async function openDashboardCommand(
  _svc: CommandServices,
): Promise<void> {
  await vscode.commands.executeCommand("dreamgraph.dashboardView.focus");
}

/* ------------------------------------------------------------------ */
/*  Command: Start Daemon (§2.6.3)                                    */
/* ------------------------------------------------------------------ */

export async function startDaemonCommand(
  svc: CommandServices,
): Promise<void> {
  const instance = svc.getInstance();
  if (!instance) {
    vscode.window.showWarningMessage(
      "DreamGraph: No instance bound to workspace.",
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Starting DreamGraph daemon…",
      cancellable: true,
    },
    async (_progress, cancelToken) => {
      return new Promise<void>((resolve) => {
        const proc = cp.spawn("dg", ["start", instance.uuid], {
          shell: true,
          stdio: "ignore",
          detached: true,
        });

        proc.unref();

        // Poll via CLI status until daemon reports running (timeout 45s)
        let elapsed = 0;
        const pollInterval = 2000;
        const maxWait = 45000;

        const poller = setInterval(async () => {
          if (cancelToken.isCancellationRequested) {
            clearInterval(poller);
            resolve();
            return;
          }

          elapsed += pollInterval;

          // Query CLI for authoritative daemon status (includes port)
          const cliStatus = await queryCliStatus(instance.uuid);

          if (cliStatus?.daemon.running && cliStatus.daemon.port) {
            clearInterval(poller);

            // Update instance with real daemon info
            const updated: ResolvedInstance = {
              ...instance,
              daemon: {
                running: true,
                pid: cliStatus.daemon.pid,
                port: cliStatus.daemon.port,
                transport: (cliStatus.daemon.transport === "http" ? "http" : "stdio") as "http" | "stdio",
                version: cliStatus.daemon.version ?? cliStatus.identity.version,
              },
            };
            svc.setInstance(updated);

            // Update client endpoints to the real port
            const host = getConfig<string>("daemonHost") ?? "127.0.0.1";
            svc.daemonClient.updateEndpoint(host, cliStatus.daemon.port);
            svc.mcpClient.updateBaseUrl(`http://${host}:${cliStatus.daemon.port}`);

            svc.statusBar.update(svc.healthMonitor.state, updated.name);
            vscode.window.showInformationMessage(
              `DreamGraph: Daemon started on port ${cliStatus.daemon.port}.`,
            );
            resolve();
          } else if (elapsed >= maxWait) {
            clearInterval(poller);
            vscode.window.showErrorMessage(
              "DreamGraph: Daemon did not start within 45s.",
            );
            resolve();
          }
        }, pollInterval);
      });
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Command: Stop Daemon (§2.6.3)                                     */
/* ------------------------------------------------------------------ */

export async function stopDaemonCommand(
  svc: CommandServices,
): Promise<void> {
  const instance = svc.getInstance();
  if (!instance) {
    vscode.window.showWarningMessage(
      "DreamGraph: No instance bound to workspace.",
    );
    return;
  }

  if (!instance.daemon.running) {
    vscode.window.showInformationMessage(
      "DreamGraph: Daemon is not running.",
    );
    return;
  }

  // Disconnect first
  svc.healthMonitor.stop();
  await svc.mcpClient.disconnect();

  try {
    cp.execSync(`dg stop ${instance.uuid}`, { timeout: 10000 });
    svc.statusBar.setDisconnected();
    svc.setInstance({
      ...instance,
      daemon: { ...instance.daemon, running: false },
    });
    vscode.window.showInformationMessage(
      "DreamGraph: Daemon stopped.",
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      `DreamGraph: Failed to stop daemon — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Command: Inspect Context (§3.6)                                   */
/* ------------------------------------------------------------------ */

export function inspectContextCommand(svc: CommandServices): void {
  // Build a snapshot of the current editor context envelope
  const editor = vscode.window.activeTextEditor;
  const workspaceRoot = getWorkspaceFolderPath() ?? "";
  const instance = svc.getInstance();

  const envelope = {
    workspaceRoot,
    instanceId: instance?.uuid ?? null,
    activeFile: editor
      ? {
          path: vscode.workspace.asRelativePath(editor.document.uri),
          languageId: editor.document.languageId,
          lineCount: editor.document.lineCount,
          cursorLine: editor.selection.active.line + 1,
          cursorColumn: editor.selection.active.character + 1,
          selection: editor.selection.isEmpty
            ? null
            : {
                startLine: editor.selection.start.line + 1,
                endLine: editor.selection.end.line + 1,
                text: editor.document.getText(editor.selection),
              },
        }
      : null,
    visibleFiles: vscode.window.visibleTextEditors.map((e) =>
      vscode.workspace.asRelativePath(e.document.uri),
    ),
    changedFiles: vscode.workspace.textDocuments
      .filter((d) => d.isDirty)
      .map((d) => vscode.workspace.asRelativePath(d.uri)),
    pinnedFiles: [] as string[], // M2+: user-pinned files
    graphContext: null,
    intentMode: "manual" as const,
    intentConfidence: 1.0,
  };

  svc.contextInspector.logEnvelope(envelope);
  svc.contextInspector.showContextChannel();
}

/* ------------------------------------------------------------------ */
/*  Status Bar Quick Pick (click action)                              */
/* ------------------------------------------------------------------ */

export async function statusQuickPickCommand(
  svc: CommandServices,
): Promise<void> {
  const items: vscode.QuickPickItem[] = [
    {
      label: "$(plug) Connect Instance",
      description: "Resolve and connect",
    },
    {
      label: "$(refresh) Reconnect",
      description: "Force reconnect",
    },
    {
      label: "$(list-flat) Switch Instance",
      description: "Pick a different instance",
    },
    {
      label: "$(info) Show Status",
      description: "Full instance details",
    },
    {
      label: "$(globe) Open Dashboard",
      description: "Open web dashboard",
    },
    {
      label: "$(eye) Inspect Context",
      description: "Show context envelope",
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "DreamGraph — choose an action",
  });

  if (!picked) return;

  switch (picked.label) {
    case "$(plug) Connect Instance":
      return connectCommand(svc);
    case "$(refresh) Reconnect":
      return reconnectCommand(svc);
    case "$(list-flat) Switch Instance":
      return switchInstanceCommand(svc);
    case "$(info) Show Status":
      return showStatusCommand(svc), undefined;
    case "$(globe) Open Dashboard":
      return openDashboardCommand(svc);
    case "$(eye) Inspect Context":
      return inspectContextCommand(svc), undefined;
  }
}

/* ================================================================== */
/*  M2 COMMANDS — Context Orchestration                               */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Command: Explain File (§5.2.1)                                    */
/* ------------------------------------------------------------------ */

export async function explainFileCommand(svc: CommandServices): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("DreamGraph: No active file to explain.");
    return;
  }

  if (!svc.architectLlm.isConfigured) {
    vscode.window.showWarningMessage(
      'DreamGraph: Architect not configured. Set provider, model, and API key first.',
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DreamGraph: Explaining file…",
      cancellable: false,
    },
    async () => {
      // Build context envelope (mode: active_file via command source)
      const envelope = await svc.contextBuilder.buildEnvelope(
        undefined,
        "explainFile",
      );
      const fileContent = svc.contextBuilder.readActiveFileContent();

      // Assemble context block with token budget
      const contextBlock = svc.contextBuilder.assembleContextBlock(
        envelope,
        fileContent,
        new Map(),
      );

      // Assemble prompt
      const { system } = assemblePrompt("explain", envelope, contextBlock.text);

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const messages: ArchitectMessage[] = [
        { role: "system", content: system },
        {
          role: "user",
          content: `Explain the role and purpose of \`${filePath}\` in the system. Reference specific features, workflows, and architectural decisions.`,
        },
      ];

      try {
        const response = await svc.architectLlm.call(messages);

        // Output destination rule: if chat is visible, render there; otherwise output channel
        if (svc.chatPanel.isVisible) {
          svc.chatPanel.addExternalMessage(
            "user",
            `Explain file: ${filePath}`,
          );
          svc.chatPanel.addExternalMessage("assistant", response.content);
        } else {
          svc.contextInspector.showRawOutput(
            `--- Explain: ${filePath} ---\n\n${response.content}\n\n[${response.promptTokens} prompt + ${response.completionTokens} completion tokens, ${response.durationMs}ms]`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `DreamGraph: Explain failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Command: Check ADR Compliance (§5.2.3)                            */
/* ------------------------------------------------------------------ */

export async function checkAdrComplianceCommand(
  svc: CommandServices,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("DreamGraph: No active file to check.");
    return;
  }

  if (!svc.architectLlm.isConfigured) {
    vscode.window.showWarningMessage(
      'DreamGraph: Architect not configured. Set provider, model, and API key first.',
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DreamGraph: Checking ADR compliance…",
      cancellable: false,
    },
    async () => {
      // Build context envelope
      const envelope = await svc.contextBuilder.buildEnvelope(
        undefined,
        "checkAdrCompliance",
      );
      const fileContent = svc.contextBuilder.readActiveFileContent();

      // Assemble context block
      const contextBlock = svc.contextBuilder.assembleContextBlock(
        envelope,
        fileContent,
        new Map(),
      );

      // Assemble prompt with validate overlay
      const { system } = assemblePrompt("validate", envelope, contextBlock.text);

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);
      const messages: ArchitectMessage[] = [
        { role: "system", content: system },
        {
          role: "user",
          content: `Check if \`${filePath}\` complies with all accepted architectural decisions (ADRs). Identify any violations, cite the specific ADR and guard rail, and suggest concrete fixes.`,
        },
      ];

      try {
        const response = await svc.architectLlm.call(messages);

        // Output destination rule
        if (svc.chatPanel.isVisible) {
          svc.chatPanel.addExternalMessage(
            "user",
            `Check ADR compliance: ${filePath}`,
          );
          svc.chatPanel.addExternalMessage("assistant", response.content);
        } else {
          svc.contextInspector.showRawOutput(
            `--- ADR Compliance: ${filePath} ---\n\n${response.content}\n\n[${response.promptTokens} prompt + ${response.completionTokens} completion tokens, ${response.durationMs}ms]`,
          );
        }
      } catch (err) {
        vscode.window.showErrorMessage(
          `DreamGraph: ADR check failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );
}

/* ================================================================== */
/*  M5 COMMANDS — Chat & API Key                                      */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/*  Command: Open Chat (§5.2.11)                                      */
/* ------------------------------------------------------------------ */

export function openChatCommand(svc: CommandServices): void {
  svc.chatPanel.open();
}

/* ------------------------------------------------------------------ */
/*  Command: Set Architect API Key (§5.2.10)                          */
/* ------------------------------------------------------------------ */

export async function setArchitectApiKeyCommand(
  svc: CommandServices,
): Promise<void> {
  // Step 1: Use in-memory provider (authoritative), fall back to settings
  let provider = svc.architectLlm.provider ?? "";

  if (!provider) {
    const cfg = vscode.workspace.getConfiguration("dreamgraph.architect");
    provider = cfg.get<string>("provider") ?? "";
  }

  if (!provider) {
    const picked = await vscode.window.showQuickPick(
      [
        { label: "anthropic", description: "Anthropic (Claude)" },
        { label: "openai", description: "OpenAI (GPT)" },
        { label: "ollama", description: "Ollama (local)" },
      ],
      { placeHolder: "Select a provider first" },
    );
    if (!picked) return;
    provider = picked.label;
    await vscode.workspace.getConfiguration("dreamgraph.architect")
      .update("provider", provider, vscode.ConfigurationTarget.Global);
    await svc.architectLlm.loadConfig();
  }

  // Step 2: Ollama doesn't need a key
  if (provider === "ollama") {
    vscode.window.showInformationMessage(
      "DreamGraph: Ollama does not require an API key.",
    );
    return;
  }

  // Step 3: Prompt for key
  const key = await vscode.window.showInputBox({
    password: true,
    prompt: `Enter API key for ${provider}`,
    placeHolder: `${provider} API key`,
    validateInput: (value) => {
      if (!value || value.trim().length < 10) {
        return "API key seems too short.";
      }
      return null;
    },
  });

  if (!key) return; // user cancelled

  // Step 4: Store in SecretStorage and update in-memory config
  await svc.architectLlm.setApiKey(provider as ArchitectProvider, key.trim());
  // Refresh in-memory config with the new key (no settings round-trip needed)
  const current = svc.architectLlm.currentConfig;
  if (current) {
    svc.architectLlm.applyConfig({ ...current, apiKey: key.trim() });
  }

  vscode.window.showInformationMessage(
    `DreamGraph: ✓ API key stored for ${provider}.`,
  );
}

/* ------------------------------------------------------------------ */
/*  Instance Quick Picker (§2.6.2)                                    */
/* ------------------------------------------------------------------ */

async function showInstancePicker(
  entries: RegistryEntry[],
  current: ResolvedInstance | null,
): Promise<RegistryEntry | undefined> {
  // Query CLI status for each entry to get running/port info
  const statusResults = await Promise.all(
    entries.map(async (entry) => {
      const status = await queryCliStatus(entry.uuid);
      return { entry, status };
    }),
  );

  // Sort: running first, then alphabetical
  const sorted = [...statusResults].sort((a, b) => {
    const aRunning = a.status?.daemon.running ? 0 : 1;
    const bRunning = b.status?.daemon.running ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return a.entry.name.localeCompare(b.entry.name);
  });

  const items: (vscode.QuickPickItem & { uuid: string })[] = sorted.map(
    ({ entry, status }) => {
      const isCurrent = current?.uuid === entry.uuid;
      const isRunning = status?.daemon.running === true;
      const port = status?.daemon.port;
      const icon = isCurrent ? "$(star)" : isRunning ? "$(vm-running)" : "$(circle-slash)";
      const suffix = isCurrent
        ? ` (connected${port ? ` :${port}` : ""})`
        : isRunning
          ? ` (running :${port})`
          : " (stopped)";

      return {
        label: `${icon} ${entry.name}${suffix}`,
        description: entry.uuid.slice(0, 12) + "…",
        detail: entry.project_root ?? "(no project attached)",
        uuid: entry.uuid,
      };
    },
  );

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: "Select a DreamGraph instance",
  });

  if (!picked) return undefined;
  return entries.find((e) => e.uuid === picked.uuid);
}

/* ------------------------------------------------------------------ */
/*  Command: Show Graph Signal                                        */
/* ------------------------------------------------------------------ */

export async function showGraphSignalCommand(svc: CommandServices): Promise<void> {
  const signal = svc.graphSignal.currentSignal;
  if (!signal) {
    void vscode.window.showInformationMessage("DreamGraph: No graph context available for the current file.");
    return;
  }

  const lines: string[] = [
    `### Graph Context: ${signal.filePath}`,
    "",
  ];

  if (signal.features.length > 0) {
    lines.push(`**Related Features (${signal.featureCount}):**`);
    for (const f of signal.features) {
      lines.push(`  - ${f.id}: ${f.name}`);
    }
    lines.push("");
  }

  if (signal.tensions.length > 0) {
    lines.push(`**Active Tensions (${signal.tensionCount}):**`);
    for (const t of signal.tensions) {
      lines.push(`  - ⚡ [${t.severity}] ${t.description}`);
    }
    lines.push("");
  }

  if (signal.insights.length > 0) {
    lines.push(`**Dream Insights (${signal.insightCount}):**`);
    for (const i of signal.insights) {
      lines.push(`  - 💡 [${i.type}] ${i.insight} (confidence: ${(i.confidence * 100).toFixed(0)}%)`);
    }
    lines.push("");
  }

  if (signal.adrs.length > 0) {
    lines.push(`**Applicable ADRs (${signal.adrCount}):**`);
    for (const a of signal.adrs) {
      lines.push(`  - 📋 ${a.id}: ${a.title} [${a.status}]`);
    }
    lines.push("");
  }

  // Show in an information message with option to open chat
  const choice = await vscode.window.showInformationMessage(
    signal.summary,
    "Open Chat",
    "Dismiss",
  );
  if (choice === "Open Chat") {
    svc.chatPanel.open();
  }
}

/* ================================================================== */
/*  AUTONOMY COMMANDS                                                 */
/* ================================================================== */

export async function setAutonomyModeCommand(
  svc: CommandServices,
): Promise<void> {
  const modes = ["cautious", "conscientious", "eager", "autonomous"] as const;
  const picked = await vscode.window.showQuickPick(
    modes.map((m) => ({ label: m, description: m === "cautious" ? "(default)" : undefined })),
    { placeHolder: "Select autonomy mode" },
  );
  if (!picked) return;
  const config = vscode.workspace.getConfiguration("dreamgraph.architect");
  await config.update("autonomyMode", picked.label, vscode.ConfigurationTarget.Workspace);
  // applyAutonomySettings is called via onDidChangeConfiguration listener
}

export function resetAutonomyCommand(svc: CommandServices): void {
  svc.chatPanel.applyAutonomySettings();
}
