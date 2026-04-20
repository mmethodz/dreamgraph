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
export declare function getStructuredResponseContractBlock(): string;
export declare function extractJsonEnvelopeBlocks(content: string): StructuredActionEnvelope[];
export declare function extractPrimaryJsonEnvelope(content: string): StructuredActionEnvelope | undefined;
export declare function hasStructuredEnvelope(content: string): boolean;
//# sourceMappingURL=autonomy-contract.d.ts.map