"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectIntent = detectIntent;
/* ------------------------------------------------------------------ */
/*  Keyword banks                                                     */
/* ------------------------------------------------------------------ */
const GRAPH_KEYWORDS = [
    "architecture",
    "how does",
    "how do",
    "connect to",
    "relate to",
    "relationship",
    "workflow",
    "feature",
    "tension",
    "dream",
    "insight",
    "adr",
    "decision",
    "graph",
    "knowledge",
    "system",
    "project",
    "overview",
    "explain the system",
    "what is the",
    "why does",
    "why is",
    "impact",
    "dependency",
    "dependencies",
];
const FILE_SCOPED_KEYWORDS = [
    "this file",
    "this module",
    "this class",
    "this function",
    "here",
    "current file",
    "active file",
    "explain file",
    "validate",
    "check",
    "lint",
    "fix",
    "refactor",
];
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
function detectIntent(input) {
    const { prompt, hasSelection, selectionLineCount, commandSource } = input;
    const lower = prompt.toLowerCase().trim();
    // Command source overrides
    if (commandSource === "explainFile" || commandSource === "checkAdrCompliance") {
        return { mode: "active_file", confidence: 1.0 };
    }
    if (commandSource === "inspectContext") {
        return { mode: "manual", confidence: 1.0 };
    }
    // Selection active + short question => selection_only
    if (hasSelection && selectionLineCount > 0) {
        // If it's a very short prompt with a selection, it's about the selection
        if (lower.length < 120) {
            return { mode: "selection_only", confidence: 0.85 };
        }
        // Even with selection, graph keywords push to ask_dreamgraph
        if (matchesKeywords(lower, GRAPH_KEYWORDS)) {
            return { mode: "ask_dreamgraph", confidence: 0.7 };
        }
        return { mode: "selection_only", confidence: 0.75 };
    }
    // Graph keywords
    const graphScore = keywordScore(lower, GRAPH_KEYWORDS);
    const fileScore = keywordScore(lower, FILE_SCOPED_KEYWORDS);
    if (graphScore > fileScore && graphScore > 0) {
        return {
            mode: "ask_dreamgraph",
            confidence: Math.min(0.6 + graphScore * 0.15, 0.95),
        };
    }
    if (fileScore > 0) {
        return {
            mode: "active_file",
            confidence: Math.min(0.6 + fileScore * 0.15, 0.9),
        };
    }
    // Default fallback
    return { mode: "active_file", confidence: 0.5 };
}
/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function matchesKeywords(text, keywords) {
    return keywords.some((kw) => text.includes(kw));
}
function keywordScore(text, keywords) {
    let score = 0;
    for (const kw of keywords) {
        if (text.includes(kw))
            score++;
    }
    return score;
}
//# sourceMappingURL=intent-detector.js.map