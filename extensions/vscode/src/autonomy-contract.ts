export interface StructuredActionEnvelope {
  summary?: string;
  goal_status?: 'complete' | 'partial' | 'blocked';
  progress_status?: 'advancing' | 'slowing' | 'stalled';
  uncertainty?: 'low' | 'medium' | 'high';
  recommended_next_steps?: Array<{
    id?: string;
    label: string;
    rationale?: string;
    priority?: number;
    eligible?: boolean;
    within_scope?: boolean;
    mutually_exclusive_with?: string[];
    batch_group?: string;
  }>;
}

export function getStructuredResponseContractBlock(): string {
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

// Lenient extraction is delegated to the shared envelope-utils module so the
// host parser stays in lockstep with the webview's renderer. Both ends accept
// fenced ```json blocks, fenced blocks without a language hint, and bare
// top-level JSON objects, and both apply the same string-aware repair pass
// for smart quotes, NBSP, trailing commas, and // line comments. Without that
// alignment the chat bubble could pretty-render an envelope while autonomy
// silently failed to parse it (or vice-versa) — the symptom users report as
// "summaries render as JSON and autonomy stops working".
import { extractEnvelopes, extractPrimaryEnvelope } from './envelope-utils.js';

export function extractJsonEnvelopeBlocks(content: string): StructuredActionEnvelope[] {
  return extractEnvelopes(content);
}

export function extractPrimaryJsonEnvelope(content: string): StructuredActionEnvelope | undefined {
  return extractPrimaryEnvelope(content);
}

export function hasStructuredEnvelope(content: string): boolean {
  return !!extractPrimaryJsonEnvelope(content);
}
