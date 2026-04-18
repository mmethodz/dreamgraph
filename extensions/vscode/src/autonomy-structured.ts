import type { RecommendedAction, RecommendedActionSet } from './autonomy.js';
import { rankRecommendedActions } from './autonomy.js';
import { extractPrimaryJsonEnvelope } from './autonomy-contract.js';

export interface StructuredPassEnvelope {
  summary?: string;
  goalStatus?: 'complete' | 'partial' | 'blocked';
  progressStatus?: 'advancing' | 'slowing' | 'stalled';
  uncertainty?: 'low' | 'medium' | 'high';
  nextSteps: RecommendedAction[];
}

export function extractStructuredPassEnvelope(content: string): StructuredPassEnvelope {
  const block = extractPrimaryJsonEnvelope(content);
  if (block) {
    const nextSteps = (block.recommended_next_steps ?? []).map((step, index) => toActionFromStructured(step, index + 1));
    return {
      summary: block.summary ?? extractSummary(content),
      goalStatus: block.goal_status ?? 'partial',
      progressStatus: block.progress_status ?? 'advancing',
      uncertainty: block.uncertainty ?? 'low',
      nextSteps,
    };
  }

  const nextSteps = extractRecommendedActions(content);
  const lower = content.toLowerCase();
  const goalStatus = /goal sufficiently reached|done and verified|completed successfully|ready for commit/.test(lower)
    ? 'complete'
    : /blocked|cannot proceed|blocking failure/.test(lower)
      ? 'blocked'
      : 'partial';
  const progressStatus = /stalled progress|no further progress|stuck/.test(lower)
    ? 'stalled'
    : /partial progress|slowing/.test(lower)
      ? 'slowing'
      : 'advancing';
  const uncertainty = /uncertain|not sure|insufficient data|confidence: low/.test(lower)
    ? 'high'
    : /partial|likely|appears|confidence: medium/.test(lower)
      ? 'medium'
      : 'low';

  return {
    summary: extractSummary(content),
    goalStatus,
    progressStatus,
    uncertainty,
    nextSteps,
  };
}

export function buildRecommendedActionSetFromContent(content: string): RecommendedActionSet {
  return rankRecommendedActions(extractStructuredPassEnvelope(content).nextSteps);
}

function extractSummary(content: string): string | undefined {
  const match = content.match(/## Short description\s+([^\n]+)/i) ?? content.match(/short description:\s*([^\n]+)/i);
  return match?.[1]?.trim();
}

function extractRecommendedActions(content: string): RecommendedAction[] {
  const lines = content.split(/\r?\n/);
  const collected: RecommendedAction[] = [];
  let inSection = false;
  let priority = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+next recommended slice/i.test(trimmed) || /^##\s+recommended next steps?/i.test(trimmed) || /^recommended next steps?:/i.test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(trimmed)) {
      break;
    }
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/) ?? trimmed.match(/^\d+[.)]\s+(.+)/);
    if (inSection && bulletMatch) {
      const label = bulletMatch[1].trim();
      if (!label) continue;
      collected.push(toAction(label, priority++));
      continue;
    }
  }

  if (collected.length > 0) {
    return collected;
  }

  const single = content.match(/next recommended slice:\s*([^\n]+)/i) ?? content.match(/next recommended step:\s*([^\n]+)/i);
  if (single?.[1]) {
    return [toAction(single[1].trim(), 1)];
  }

  return [];
}

function toAction(label: string, priority: number): RecommendedAction {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || `action-${priority}`;
  const batchGroup = /clickable|webview|ui|header|status/.test(label.toLowerCase()) ? 'ui' : undefined;
  return {
    id,
    label,
    priority,
    eligible: true,
    withinScope: true,
    batchGroup,
  };
}

function toActionFromStructured(step: {
  id?: string;
  label: string;
  rationale?: string;
  priority?: number;
  eligible?: boolean;
  within_scope?: boolean;
  mutually_exclusive_with?: string[];
  batch_group?: string;
}, fallbackPriority: number): RecommendedAction {
  const normalized = toAction(step.label, step.priority ?? fallbackPriority);
  return {
    ...normalized,
    id: step.id?.trim() || normalized.id,
    rationale: step.rationale,
    priority: step.priority ?? fallbackPriority,
    eligible: step.eligible ?? true,
    withinScope: step.within_scope ?? true,
    mutuallyExclusiveWith: step.mutually_exclusive_with,
    batchGroup: step.batch_group ?? normalized.batchGroup,
  };
}
