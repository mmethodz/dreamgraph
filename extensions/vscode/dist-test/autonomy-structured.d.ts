import type { RecommendedAction, RecommendedActionSet } from './autonomy.js';
export interface StructuredPassEnvelope {
    summary?: string;
    goalStatus?: 'complete' | 'partial' | 'blocked';
    progressStatus?: 'advancing' | 'slowing' | 'stalled';
    uncertainty?: 'low' | 'medium' | 'high';
    nextSteps: RecommendedAction[];
}
export declare function extractStructuredPassEnvelope(content: string): StructuredPassEnvelope;
export declare function buildRecommendedActionSetFromContent(content: string): RecommendedActionSet;
//# sourceMappingURL=autonomy-structured.d.ts.map