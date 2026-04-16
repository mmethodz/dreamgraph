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

export type ExtensionToWebviewMessage =
  | { type: 'addMessage'; message: ChatMessage }
  | { type: 'stream-start' }
  | { type: 'stream-chunk'; chunk: string }
  | { type: 'stream-thinking'; active: boolean }
  | { type: 'stream-end'; done: boolean }
  | { type: 'state'; state: { messages: ChatMessage[] } }
  | {
      type: 'updateModels';
      providers: string[];
      models: string[];
      current: { provider: string; model: string };
      capabilities: { textAttachments: boolean; imageAttachments: boolean };
    }
  | { type: 'setAttachments'; attachments: AttachmentPreview[] }
  | { type: 'error'; error: string }
  | { type: 'restoreDraft'; text: string };

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'pickAttachments' }
  | { type: 'removeAttachment'; id: string }
  | { type: 'pasteImage'; dataBase64: string; mimeType: string }
  | { type: 'clear' }
  | { type: 'stop' }
  | { type: 'changeProvider'; provider: string }
  | { type: 'changeModel'; model: string }
  | { type: 'setApiKey' }
  | { type: 'saveDraft'; text: string }
  | { type: 'openExternalLink'; url: string }
  | { type: 'copyToClipboard'; text: string };
