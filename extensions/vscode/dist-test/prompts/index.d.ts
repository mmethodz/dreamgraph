/**
 * Prompt Assembler — composes the Architect system prompt from
 * core identity + task overlay + context block.
 *
 * @see TDD §7.5 (Prompt Architecture), §7.4 (Chat Flow)
 */
import type { EditorContextEnvelope } from "../types.js";
export type ArchitectTask = "explain" | "validate" | "patch" | "suggest" | "chat";
export interface AssembledPrompt {
    /** Complete system prompt (core + overlay + context) */
    system: string;
    /** Task that was used */
    task: ArchitectTask;
}
/**
 * Assemble the Architect system prompt from core + task overlay + context block.
 *
 * @param task - The task type (explain, validate, patch, suggest, chat)
 * @param envelope - Editor context envelope (may be null for config-only calls)
 * @param contextText - Optional assembled context text (from ContextBuilder.assembleContextBlock)
 * @param additionalInstructions - Optional additional instructions appended after the context
 */
export declare function assemblePrompt(task: ArchitectTask, envelope: EditorContextEnvelope | null, contextText?: string, additionalInstructions?: string): AssembledPrompt;
/**
 * Infer the best task overlay from an intent mode and optional command source.
 */
export declare function inferTask(intentMode: string, commandSource?: string): ArchitectTask;
//# sourceMappingURL=index.d.ts.map