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
import type { DaemonClient } from "./daemon-client.js";
import type { McpClient } from "./mcp-client.js";
import type { HealthMonitor } from "./health-monitor.js";
import type { StatusBarManager } from "./status-bar.js";
import type { ContextInspector } from "./context-inspector.js";
import type { ArchitectLlm } from "./architect-llm.js";
import type { ContextBuilder } from "./context-builder.js";
import type { ChatPanel } from "./chat-panel.js";
import type { GraphSignalProvider } from "./graph-signal.js";
import type { DashboardViewProvider } from "./dashboard-view.js";
import type { ResolvedInstance } from "./types.js";
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
export declare function connectCommand(svc: CommandServices): Promise<void>;
export declare function reconnectCommand(svc: CommandServices): Promise<void>;
export declare function switchInstanceCommand(svc: CommandServices): Promise<void>;
export declare function showStatusCommand(svc: CommandServices): void;
export declare function openDashboardCommand(_svc: CommandServices): Promise<void>;
export declare function startDaemonCommand(svc: CommandServices): Promise<void>;
export declare function stopDaemonCommand(svc: CommandServices): Promise<void>;
export declare function inspectContextCommand(svc: CommandServices): Promise<void>;
export declare function statusQuickPickCommand(svc: CommandServices): Promise<void>;
export declare function explainFileCommand(svc: CommandServices): Promise<void>;
export declare function checkAdrComplianceCommand(svc: CommandServices): Promise<void>;
export declare function openChatCommand(svc: CommandServices): void;
export declare function setArchitectApiKeyCommand(svc: CommandServices): Promise<void>;
export declare function showGraphSignalCommand(svc: CommandServices): Promise<void>;
export declare function setAutonomyModeCommand(svc: CommandServices): Promise<void>;
export declare function resetAutonomyCommand(svc: CommandServices): void;
//# sourceMappingURL=commands.d.ts.map