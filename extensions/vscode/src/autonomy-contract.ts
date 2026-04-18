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

export function extractJsonEnvelopeBlocks(content: string): StructuredActionEnvelope[] {
  const blocks: StructuredActionEnvelope[] = [];
  const regex = /```json\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(regex)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as StructuredActionEnvelope;
      if (parsed && typeof parsed === 'object') {
        blocks.push(parsed);
      }
    } catch {
      // Ignore malformed JSON blocks and allow fallback heuristics.
    }
  }
  return blocks;
}

export function extractPrimaryJsonEnvelope(content: string): StructuredActionEnvelope | undefined {
  const blocks = extractJsonEnvelopeBlocks(content);
  return blocks[0];
}

export function hasStructuredEnvelope(content: string): boolean {
  return !!extractPrimaryJsonEnvelope(content);
}
