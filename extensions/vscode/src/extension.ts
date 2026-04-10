/**
 * DreamGraph VS Code Extension — Main Entry Point.
 *
 * Wires all three layers together:
 *   Layer 1: VS Code integration (commands, status bar, output channels)
 *   Layer 2: Context orchestration (Architect LLM, context builder, prompts)
 *   Layer 3: DreamGraph client (daemon HTTP, MCP, health, instance resolver)
 *
 * M1: Connect, Status, Dashboard, Inspect Context.
 * M2: Explain File, Check ADR Compliance.
 * M5: Chat panel, Set API Key.
 *
 * @see TDD §1.2 (Three-Layer Architecture)
 */

import * as vscode from "vscode";

import { DaemonClient } from "./daemon-client.js";
import { McpClient } from "./mcp-client.js";
import { HealthMonitor } from "./health-monitor.js";
import { StatusBarManager } from "./status-bar.js";
import { ContextInspector } from "./context-inspector.js";
import { ArchitectLlm } from "./architect-llm.js";
import { ContextBuilder } from "./context-builder.js";
import { ChatPanel } from "./chat-panel.js";
import type { ResolvedInstance } from "./types.js";
import {
  connectCommand,
  reconnectCommand,
  switchInstanceCommand,
  showStatusCommand,
  openDashboardCommand,
  startDaemonCommand,
  stopDaemonCommand,
  inspectContextCommand,
  statusQuickPickCommand,
  explainFileCommand,
  checkAdrComplianceCommand,
  openChatCommand,
  setArchitectApiKeyCommand,
  type CommandServices,
} from "./commands.js";

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

let currentInstance: ResolvedInstance | null = null;

/* ------------------------------------------------------------------ */
/*  Activate                                                          */
/* ------------------------------------------------------------------ */

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("dreamgraph");

  // ---- Layer 3: DreamGraph Client ----
  // Use configured host/port as initial values. connectCommand may
  // override them when an instance is resolved via `dg status`, but
  // if the daemon is already running at the configured port the
  // extension can connect immediately.
  const daemonHost = config.get<string>("daemonHost") ?? "127.0.0.1";
  const initialPort = config.get<number>("daemonPort") ?? 0;

  const daemonClient = new DaemonClient({
    host: daemonHost,
    port: initialPort,
  });

  const mcpClient = new McpClient(`http://${daemonHost}:${initialPort}`);
  const healthMonitor = new HealthMonitor(daemonClient);

  // ---- Layer 2: Context Orchestration ----
  const architectLlm = new ArchitectLlm(context.secrets);
  const maxContextTokens = config.get<number>("architect.maxContextTokens") ?? 16000;
  const contextBuilder = new ContextBuilder(mcpClient, daemonClient, {
    maxContextTokens,
    instance: null,
  });
  const chatPanel = new ChatPanel(context.extensionUri, architectLlm, contextBuilder, mcpClient);

  // Load architect config asynchronously
  void architectLlm.loadConfig();

  // ---- Layer 1: VS Code Integration ----
  const statusBar = new StatusBarManager();
  const contextInspector = new ContextInspector();

  // ---- Wire health monitor → status bar ----
  healthMonitor.onTransition((event) => {
    statusBar.update(healthMonitor.state, currentInstance?.name);

    // Log transition to context channel
    const msg = `Health: ${event.from} → ${event.to}${event.reason ? ` (${event.reason})` : ""}`;
    vscode.window.setStatusBarMessage(msg, 3000);
  });

  // ---- Command services ----
  const services: CommandServices = {
    daemonClient,
    mcpClient,
    healthMonitor,
    statusBar,
    contextInspector,
    architectLlm,
    contextBuilder,
    chatPanel,
    getInstance: () => currentInstance,
    setInstance: (inst) => {
      currentInstance = inst;
      contextBuilder.updateOptions({ instance: inst });
    },
  };

  // ---- Register commands ----
  const commands: [string, (...args: unknown[]) => unknown][] = [
    // M1: Connection & Infrastructure
    ["dreamgraph.connect", () => connectCommand(services)],
    ["dreamgraph.reconnect", () => reconnectCommand(services)],
    ["dreamgraph.switchInstance", () => switchInstanceCommand(services)],
    ["dreamgraph.showStatus", () => showStatusCommand(services)],
    ["dreamgraph.openDashboard", () => openDashboardCommand(services)],
    ["dreamgraph.startDaemon", () => startDaemonCommand(services)],
    ["dreamgraph.stopDaemon", () => stopDaemonCommand(services)],
    ["dreamgraph.inspectContext", () => inspectContextCommand(services)],
    ["dreamgraph.statusQuickPick", () => statusQuickPickCommand(services)],
    // M2: Context Orchestration
    ["dreamgraph.explainFile", () => explainFileCommand(services)],
    ["dreamgraph.checkAdrCompliance", () => checkAdrComplianceCommand(services)],
    // M5: Chat & API Key
    ["dreamgraph.openChat", () => openChatCommand(services)],
    ["dreamgraph.setArchitectApiKey", () => setArchitectApiKeyCommand(services)],
  ];

  for (const [id, handler] of commands) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, handler),
    );
  }

  // ---- Register disposables ----
  context.subscriptions.push(
    daemonClient,
    mcpClient,
    healthMonitor,
    statusBar,
    contextInspector,
    architectLlm,
    chatPanel,
  );

  // ---- Listen for configuration changes ----
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("dreamgraph.daemonHost")) {
        // Host changes are rare but supported — port is always
        // discovered from CLI, so we don't react to daemonPort changes.
        const newConfig = vscode.workspace.getConfiguration("dreamgraph");
        const host = newConfig.get<string>("daemonHost") ?? "127.0.0.1";
        const currentPort = daemonClient.port;
        if (currentPort > 0) {
          daemonClient.updateEndpoint(host, currentPort);
          mcpClient.updateBaseUrl(`http://${host}:${currentPort}`);
        }
      }
    }),
  );

  // ---- Auto-connect on activation ----
  const autoConnect = config.get<boolean>("autoConnect") ?? true;
  if (autoConnect) {
    // Delay slightly to let VS Code finish loading
    setTimeout(() => void connectCommand(services), 1500);
  }
}

/* ------------------------------------------------------------------ */
/*  Deactivate                                                        */
/* ------------------------------------------------------------------ */

export function deactivate(): void {
  // All disposables registered via context.subscriptions are
  // cleaned up automatically by VS Code.
  currentInstance = null;
}
