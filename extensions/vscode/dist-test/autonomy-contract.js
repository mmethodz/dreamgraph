"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStructuredResponseContractBlock = getStructuredResponseContractBlock;
exports.extractJsonEnvelopeBlocks = extractJsonEnvelopeBlocks;
exports.extractPrimaryJsonEnvelope = extractPrimaryJsonEnvelope;
exports.hasStructuredEnvelope = hasStructuredEnvelope;
function getStructuredResponseContractBlock() {
    return [
        '## Structured Continuation Contract',
        '- After each pass, include exactly one fenced ```json block containing a single object that matches this shape exactly:',
        '```json',
        '{',
        '  "summary": "short summary of what changed or was learned",',
        '  "goal_status": "complete|partial|blocked",',
        '  "progress_status": "advancing|slowing|stalled",',
        '  "uncertainty": "low|medium|high",',
        '  "recommended_next_steps": [',
        '    {',
        '      "id": "short-stable-id",',
        '      "label": "human-readable next step",',
        '      "rationale": "why this is next",',
        '      "priority": 1,',
        '      "eligible": true,',
        '      "within_scope": true,',
        '      "mutually_exclusive_with": [],',
        '      "batch_group": "optional-group"',
        '    }',
        '  ]',
        '}',
        '```',
        '- Also include normal human-readable explanation in chat.',
        '- Keep recommended_next_steps empty when there is no safe next step.',
        '- Set goal_status to complete when the original goal has sufficiently been reached.',
        '- Set progress_status to stalled when further pursuit is not making meaningful progress.',
        '- Keep ids stable and concise when possible.',
        '- Prefer the structured json values over prose when they differ.',
    ].join('\n');
}
function extractJsonEnvelopeBlocks(content) {
    const blocks = [];
    const regex = /```json\s*([\s\S]*?)```/gi;
    for (const match of content.matchAll(regex)) {
        const raw = match[1]?.trim();
        if (!raw)
            continue;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                blocks.push(parsed);
            }
        }
        catch {
            // Ignore malformed JSON blocks and allow fallback heuristics.
        }
    }
    return blocks;
}
function extractPrimaryJsonEnvelope(content) {
    const blocks = extractJsonEnvelopeBlocks(content);
    return blocks[0];
}
function hasStructuredEnvelope(content) {
    return !!extractPrimaryJsonEnvelope(content);
}
//# sourceMappingURL=autonomy-contract.js.map