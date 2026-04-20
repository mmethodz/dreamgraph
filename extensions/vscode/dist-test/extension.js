"use strict";
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const daemon_client_js_1 = require("./daemon-client.js");
const mcp_client_js_1 = require("./mcp-client.js");
const health_monitor_js_1 = require("./health-monitor.js");
const status_bar_js_1 = require("./status-bar.js");
const context_inspector_js_1 = require("./context-inspector.js");
const architect_llm_js_1 = require("./architect-llm.js");
const context_builder_js_1 = require("./context-builder.js");
const chat_panel_js_1 = require("./chat-panel.js");
const dashboard_view_js_1 = require("./dashboard-view.js");
const changed_files_view_js_1 = require("./changed-files-view.js");
const graph_signal_js_1 = require("./graph-signal.js");
const chat_memory_js_1 = require("./chat-memory.js");
const local_tools_js_1 = require("./local-tools.js");
const commands_js_1 = require("./commands.js");
/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */
let currentInstance = null;
/* ------------------------------------------------------------------ */
/*  Activate                                                          */
/* ------------------------------------------------------------------ */
function activate(context) {
    // ---- Ensure sidebar icon persists across reinstalls ----
    // VS Code may move views out of their declared container on reinstall,
    // hiding the activity bar icon. Reset once per version to fix this.
    const versionKey = "dreamgraph.lastActivatedVersion";
    const currentVersion = "7.0.1";
    const lastVersion = context.globalState.get(versionKey);
    if (lastVersion !== currentVersion) {
        void vscode.commands.executeCommand("workbench.action.resetViewLocations");
        void context.globalState.update(versionKey, currentVersion);
    }
    // Register local runner palette commands (dreamgraph.runCommand, dreamgraph.runBuild)
    (0, local_tools_js_1.registerRunnerCommands)(context);
    const config = vscode.workspace.getConfiguration("dreamgraph");
    // ---- Layer 3: DreamGraph Client ----
    // Use configured host/port as initial values. connectCommand may
    // override them when an instance is resolved via `dg status`, but
    // if the daemon is already running at the configured port the
    // extension can connect immediately.
    const daemonHost = config.get("daemonHost") ?? "127.0.0.1";
    const initialPort = config.get("daemonPort") ?? 0;
    const daemonClient = new daemon_client_js_1.DaemonClient({
        host: daemonHost,
        port: initialPort,
    });
    const mcpClient = new mcp_client_js_1.McpClient(`http://${daemonHost}:${initialPort}`);
    const healthMonitor = new health_monitor_js_1.HealthMonitor(daemonClient);
    // ---- Layer 2: Context Orchestration ----
    const architectLlm = new architect_llm_js_1.ArchitectLlm(context.secrets);
    const maxContextTokens = config.get("architect.maxContextTokens") ?? 16000;
    const contextBuilder = new context_builder_js_1.ContextBuilder(mcpClient, daemonClient, {
        maxContextTokens,
        instance: null,
    });
    const chatPanel = new chat_panel_js_1.ChatPanel(context);
    const dashboardView = new dashboard_view_js_1.DashboardViewProvider(context.extensionUri);
    const changedFiles = new changed_files_view_js_1.ChangedFilesView(context);
    changedFiles.restore();
    // ---- Graph Signal Provider (proactive context pre-fetching) ----
    const graphSignal = new graph_signal_js_1.GraphSignalProvider(mcpClient, daemonClient);
    chatPanel.setGraphSignal(graphSignal);
    // ---- Per-instance chat memory (persists across VS Code restarts) ----
    const chatMemory = new chat_memory_js_1.ChatMemory(context);
    chatPanel.setMemory(chatMemory);
    // ---- Wire Architect LLM + Context into Chat ----
    chatPanel.setArchitectLlm(architectLlm);
    chatPanel.setContextBuilder(contextBuilder);
    chatPanel.setMcpClient(mcpClient);
    chatPanel.setChangedFilesProvider(changedFiles);
    // Load architect config asynchronously
    void architectLlm.loadConfig();
    // ---- Layer 1: VS Code Integration ----
    const statusBar = new status_bar_js_1.StatusBarManager();
    const contextInspector = new context_inspector_js_1.ContextInspector();
    // ---- Wire health monitor → status bar ----
    healthMonitor.onTransition((event) => {
        statusBar.update(healthMonitor.state, currentInstance?.name);
        // Log transition to context channel
        const msg = `Health: ${event.from} → ${event.to}${event.reason ? ` (${event.reason})` : ""}`;
        vscode.window.setStatusBarMessage(msg, 3000);
    });
    // ---- Command services ----
    const services = {
        daemonClient,
        mcpClient,
        healthMonitor,
        statusBar,
        contextInspector,
        architectLlm,
        contextBuilder,
        chatPanel,
        graphSignal,
        dashboardView,
        getInstance: () => currentInstance,
        setInstance: (inst) => {
            currentInstance = inst;
            contextBuilder.updateOptions({ instance: inst });
            // Swap chat history to the new instance
            if (inst) {
                chatPanel.setInstance(inst.uuid);
            }
        },
    };
    // ---- Register commands ----
    const commands = [
        // M1: Connection & Infrastructure
        ["dreamgraph.connect", () => (0, commands_js_1.connectCommand)(services)],
        ["dreamgraph.reconnect", () => (0, commands_js_1.reconnectCommand)(services)],
        ["dreamgraph.switchInstance", () => (0, commands_js_1.switchInstanceCommand)(services)],
        ["dreamgraph.showStatus", () => (0, commands_js_1.showStatusCommand)(services)],
        ["dreamgraph.openDashboard", () => (0, commands_js_1.openDashboardCommand)(services)],
        ["dreamgraph.startDaemon", () => (0, commands_js_1.startDaemonCommand)(services)],
        ["dreamgraph.stopDaemon", () => (0, commands_js_1.stopDaemonCommand)(services)],
        ["dreamgraph.inspectContext", () => (0, commands_js_1.inspectContextCommand)(services)],
        ["dreamgraph.statusQuickPick", () => (0, commands_js_1.statusQuickPickCommand)(services)],
        // M2: Context Orchestration
        ["dreamgraph.explainFile", () => (0, commands_js_1.explainFileCommand)(services)],
        ["dreamgraph.checkAdrCompliance", () => (0, commands_js_1.checkAdrComplianceCommand)(services)],
        // M5: Chat & API Key
        ["dreamgraph.openChat", () => (0, commands_js_1.openChatCommand)(services)],
        ["dreamgraph.setArchitectApiKey", () => (0, commands_js_1.setArchitectApiKeyCommand)(services)],
        // Graph Signal
        ["dreamgraph.showGraphSignal", () => (0, commands_js_1.showGraphSignalCommand)(services)],
        // Files Changed
        ["dreamgraph.clearChangedFiles", () => changedFiles.clear()],
        // Autonomy
        ["dreamgraph.setAutonomyMode", () => (0, commands_js_1.setAutonomyModeCommand)(services)],
        ["dreamgraph.resetAutonomy", () => (0, commands_js_1.resetAutonomyCommand)(services)],
    ];
    for (const [id, handler] of commands) {
        context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    }
    // ---- Register webview view providers (dockable sidebar panels) ----
    const changedFilesTreeView = vscode.window.createTreeView('dreamgraph.changedFiles', { treeDataProvider: changedFiles, showCollapseAll: true });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(chat_panel_js_1.ChatPanel.viewType, chatPanel, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.window.registerWebviewViewProvider(dashboard_view_js_1.DashboardViewProvider.viewType, dashboardView), changedFilesTreeView);
    // ---- Register disposables ----
    context.subscriptions.push(daemonClient, mcpClient, healthMonitor, statusBar, contextInspector, architectLlm, chatPanel, dashboardView, changedFiles, graphSignal);
    // ---- Listen for configuration changes ----
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("dreamgraph.daemonHost")) {
            // Host changes are rare but supported — port is always
            // discovered from CLI, so we don't react to daemonPort changes.
            const newConfig = vscode.workspace.getConfiguration("dreamgraph");
            const host = newConfig.get("daemonHost") ?? "127.0.0.1";
            const currentPort = daemonClient.port;
            if (currentPort > 0) {
                daemonClient.updateEndpoint(host, currentPort);
                mcpClient.updateBaseUrl(`http://${host}:${currentPort}`);
                dashboardView.updateDaemonUrl(host, currentPort);
            }
        }
        if (e.affectsConfiguration("dreamgraph.architect.autonomyMode") ||
            e.affectsConfiguration("dreamgraph.architect.autoPassBudget")) {
            chatPanel.applyAutonomySettings();
        }
    }));
    // ---- Auto-connect on activation ----
    const autoConnect = config.get("autoConnect") ?? true;
    if (autoConnect) {
        // Delay slightly to let VS Code finish loading
        setTimeout(() => void (0, commands_js_1.connectCommand)(services), 1500);
    }
}
/* ------------------------------------------------------------------ */
/*  Deactivate                                                        */
/* ------------------------------------------------------------------ */
function deactivate() {
    // All disposables registered via context.subscriptions are
    // cleaned up automatically by VS Code.
    currentInstance = null;
}
//# sourceMappingURL=extension.js.map