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
export declare function activate(context: vscode.ExtensionContext): void;
export declare function deactivate(): void;
//# sourceMappingURL=extension.d.ts.map