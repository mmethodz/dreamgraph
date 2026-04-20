export type ChatRole = 'user' | 'assistant' | 'system';
export interface ChatMessage {
    role: ChatRole;
    content: string;
    timestamp: string;
}
export interface AttachmentPreview {
    id: string;
    name: string;
    kind: 'text' | 'image';
    mimeType: string;
    size: number;
    note?: string;
}
export interface EntityVerification {
    status: 'verified' | 'latent' | 'unverified' | 'tension';
    confidence: number;
    lastValidated?: string;
}
export interface ToolTraceEntry {
    tool: string;
    argsSummary: string;
    filesAffected: string[];
    durationMs: number;
}
export type ExtensionToWebviewMessage = {
    type: 'addMessage';
    message: ChatMessage;
} | {
    type: 'stream-start';
} | {
    type: 'stream-chunk';
    chunk: string;
} | {
    type: 'stream-thinking';
    active: boolean;
} | {
    type: 'stream-end';
    done: boolean;
} | {
    type: 'tool-progress';
    tool: string;
    message: string;
    progress?: number;
    total?: number;
} | {
    type: 'state';
    state: {
        messages: ChatMessage[];
    };
} | {
    type: 'updateModels';
    providers: string[];
    models: string[];
    current: {
        provider: string;
        model: string;
    };
    capabilities: {
        textAttachments: boolean;
        imageAttachments: boolean;
    };
} | {
    type: 'setAttachments';
    attachments: AttachmentPreview[];
} | {
    type: 'error';
    error: string;
} | {
    type: 'restoreDraft';
    text: string;
} | {
    type: 'entityStatus';
    requestId: string;
    results: Record<string, EntityVerification>;
} | {
    type: 'toolTrace';
    calls: ToolTraceEntry[];
} | {
    type: 'actionResult';
    requestId: string;
    success: boolean;
    error?: string;
} | {
    type: 'autonomyStatus';
    status: {
        mode: string;
        countingActive: boolean;
        completed: number;
        remaining: number;
        totalAuthorized?: number;
        summary: string;
    };
} | {
    type: 'recommendedActions';
    messageId: string;
    actions: {
        id: string;
        label: string;
        rationale?: string;
    }[];
    doAllEligible: boolean;
};
export type WebviewToExtensionMessage = {
    type: 'ready';
} | {
    type: 'send';
    text: string;
} | {
    type: 'pickAttachments';
} | {
    type: 'removeAttachment';
    id: string;
} | {
    type: 'pasteImage';
    dataBase64: string;
    mimeType: string;
} | {
    type: 'clear';
} | {
    type: 'stop';
} | {
    type: 'changeProvider';
    provider: string;
} | {
    type: 'changeModel';
    model: string;
} | {
    type: 'setApiKey';
} | {
    type: 'saveDraft';
    text: string;
} | {
    type: 'openExternalLink';
    url: string;
} | {
    type: 'copyToClipboard';
    text: string;
} | {
    type: 'navigateEntity';
    uri: string;
} | {
    type: 'verifyEntities';
    requestId: string;
    names: string[];
} | {
    type: 'executeAction';
    requestId: string;
    action: string;
    context: Record<string, unknown>;
} | {
    type: 'selectRecommendedAction';
    actionId: string;
} | {
    type: 'doAllRecommendedActions';
} | {
    type: 'setAutonomyMode';
    mode: string;
} | {
    type: 'resetAutonomy';
};
//# sourceMappingURL=protocol.d.ts.map