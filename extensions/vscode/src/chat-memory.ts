/**
 * DreamGraph Chat Memory — Per-instance persistent conversation history.
 *
 * Stores chat messages keyed by DreamGraph instance UUID using VS Code globalState.
 * Each instance keeps its own history so switching instances does not leak chat
 * state across workspaces or daemon targets.
 */

import * as vscode from 'vscode';

export interface PersistedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  verdict?: { level: string; summary: string };
  toolTrace?: { tool: string; argsSummary: string; filesAffected: string[]; durationMs: number; status: string }[];
}

interface PersistedChatState {
  version: 1;
  messages: PersistedMessage[];
}

export class ChatMemory {
  private static readonly storageKeyPrefix = 'dreamgraph.chat.';

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async load(instanceId: string): Promise<PersistedMessage[]> {
    const key = this.getStorageKey(instanceId);
    const state = this.context.globalState.get<PersistedChatState | PersistedMessage[]>(key);

    if (!state) {
      return [];
    }

    if (Array.isArray(state)) {
      return state;
    }

    return Array.isArray(state.messages) ? state.messages : [];
  }

  public async save(instanceId: string, messages: PersistedMessage[]): Promise<void> {
    const key = this.getStorageKey(instanceId);
    const state: PersistedChatState = {
      version: 1,
      messages,
    };

    await this.context.globalState.update(key, state);
  }

  public async clear(instanceId: string): Promise<void> {
    const key = this.getStorageKey(instanceId);
    await this.context.globalState.update(key, undefined);
  }

  private getStorageKey(instanceId: string): string {
    const normalized = instanceId && instanceId.trim().length > 0 ? instanceId.trim() : 'default';
    return `${ChatMemory.storageKeyPrefix}${normalized}`;
  }
}
