/**
 * DreamGraph Intent Detector — Layer 2 (Context Orchestration).
 *
 * Heuristic-based intent classification (§3.3).
 * No LLM call — keyword matching + editor state analysis only.
 *
 * v1 modes: selection_only, active_file, ask_dreamgraph, manual
 *
 * @see TDD §3.3 (Intent Detection)
 */
import type { IntentMode } from "./types.js";
export interface IntentDetectionInput {
    /** User prompt / question text */
    prompt: string;
    /** Is there an active text selection in the editor? */
    hasSelection: boolean;
    /** Number of selected lines (0 if no selection) */
    selectionLineCount: number;
    /** Was this triggered by a specific command (not chat)? */
    commandSource?: string;
}
export interface IntentDetectionResult {
    mode: IntentMode;
    confidence: number;
}
/**
 * Classify user intent from prompt text + editor state.
 *
 * Priority:
 * 1. Command source override (explainFile → active_file, checkAdr → active_file, etc.)
 * 2. Selection active + short question → selection_only
 * 3. Graph keywords → ask_dreamgraph
 * 4. File-scoped keywords → active_file
 * 5. Default → active_file (safe fallback)
 */
export declare function detectIntent(input: IntentDetectionInput): IntentDetectionResult;
//# sourceMappingURL=intent-detector.d.ts.map