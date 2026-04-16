"use strict";
/**
 * DreamGraph Chat Panel — M5 WebviewPanel controller.
 *
 * Owns all chat state (messages, streaming, model selection).
 * The webview is a dumb renderer — the extension host is the single source of truth.
 *
 * Chat history is persisted in ChatMemory and re-hydrated whenever the webview
 * is recreated or becomes visible again, so switching to another tool tab does
 * not erase the conversation.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const styles_js_1 = require("./webview/styles.js");
const render_markdown_js_1 = require("./webview/render-markdown.js");
const architect_llm_1 = require("./architect-llm");
const local_tools_js_1 = require("./local-tools.js");
const index_js_1 = require("./prompts/index.js");
class ChatPanel {
    context;
    static viewType = 'dreamgraph.chatView';
    view;
    disposables = [];
    messages = [];
    memory;
    graphSignal;
    architectLlm;
    contextBuilder;
    mcpClient;
    changedFilesView;
    currentInstanceId = 'default';
    streaming = false;
    abortController = null;
    streamingContent = '';
    steeringQueue = [];
    draftText = '';
    attachments = [];
    /** Messages buffered while the webview was hidden. Flushed on rehydrate. */
    _pendingMessages = [];
    /** Cached browser build of markdown-it. Loaded once at first getHtml() call. */
    _markdownItSource = null;
    /** Cached browser build of DOMPurify. Loaded once at first getHtml() call. */
    _domPurifySource = null;
    static MAX_TEXT_ATTACHMENT_BYTES = 100_000;
    static MAX_IMAGE_ATTACHMENT_BYTES = 5 * 1024 * 1024;
    /** Hard timeout per LLM provider request (ms). Prevents infinite hangs. */
    static REQUEST_TIMEOUT_MS = 90_000;
    /** Per-tool timeout overrides (ms). Tools not listed use _default. */
    static TOOL_TIMEOUT_MS = {
        dream_cycle: 120_000,
        nightmare_cycle: 120_000,
        metacognitive_analysis: 120_000,
        run_command: 60_000,
        write_file: 30_000,
        edit_file: 30_000,
        read_source_code: 30_000,
        read_local_file: 30_000,
        _default: 60_000,
    };
    static TEXT_EXTENSIONS = new Set([
        '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.py', '.cs', '.java', '.go', '.rs', '.yml', '.yaml', '.xml', '.html', '.css', '.scss', '.sql', '.sh'
    ]);
    static IMAGE_MIME_BY_EXT = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
    };
    static TOOL_RESULT_LIMITS = {
        read_source_code: 12_000,
        read_local_file: 12_000,
        query_api_surface: 10_000,
        run_command: 8_000,
        edit_entity: 6_000,
        edit_file: 6_000,
        modify_entity: 6_000,
        write_file: 4_000,
        _default: 4_000,
    };
    static _toolResultLimit(toolName) {
        return ChatPanel.TOOL_RESULT_LIMITS[toolName] ?? ChatPanel.TOOL_RESULT_LIMITS._default;
    }
    constructor(context) {
        this.context = context;
    }
    setGraphSignal(provider) { this.graphSignal = provider; }
    setMemory(memory) { this.memory = memory; }
    setArchitectLlm(llm) { this.architectLlm = llm; }
    setContextBuilder(cb) { this.contextBuilder = cb; }
    setMcpClient(mcp) { this.mcpClient = mcp; }
    setChangedFilesProvider(provider) { this.changedFilesView = provider; }
    setInstance(instanceId) {
        if (this.currentInstanceId === instanceId)
            return;
        this.currentInstanceId = instanceId;
        void this.restoreMessages();
    }
    get isVisible() { return this.view?.visible ?? false; }
    addExternalMessage(role, content) {
        const msg = { role, content, timestamp: new Date().toISOString() };
        this.messages.push(msg);
        void this.persistMessages();
        void this.postMessage({ type: 'addMessage', message: msg });
    }
    open() { void vscode.commands.executeCommand('dreamgraph.chatView.focus'); }
    async resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = this.getHtml(webviewView.webview);
        webviewView.onDidDispose(() => {
            if (this.view === webviewView)
                this.view = undefined;
        }, null, this.disposables);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible)
                void this.rehydrateWebview();
        }, null, this.disposables);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'ready':
                    await this.rehydrateWebview();
                    this._sendModelUpdate();
                    this._checkApiKeyWarning();
                    await this._syncAttachments();
                    break;
                case 'send':
                    if (typeof message.text === 'string' && message.text.trim().length > 0) {
                        if (this.streaming) {
                            this.steeringQueue.push(message.text.trim());
                            const steerMsg = `\n\n💬 *Steering: "${message.text.trim()}"*\n`;
                            this.streamingContent += steerMsg;
                            void this.postMessage({ type: 'stream-chunk', chunk: steerMsg });
                        }
                        else {
                            await this.handleUserMessage(message.text.trim());
                        }
                    }
                    break;
                case 'pickAttachments':
                    await this._pickAttachments();
                    break;
                case 'removeAttachment':
                    this.attachments = this.attachments.filter((a) => a.id !== message.id);
                    await this._syncAttachments();
                    break;
                case 'pasteImage':
                    await this._handlePastedImage(message.dataBase64, message.mimeType);
                    break;
                case 'clear':
                    await this.clearMessages();
                    break;
                case 'stop':
                    this.abortGeneration();
                    break;
                case 'changeProvider':
                    await this._changeProvider(message.provider);
                    break;
                case 'changeModel':
                    if (message.model === '__custom__') {
                        const custom = await vscode.window.showInputBox({ prompt: 'Enter a custom model name', placeHolder: 'e.g. claude-sonnet-4' });
                        if (custom)
                            await this._changeModel(custom);
                        else
                            this._sendModelUpdate();
                    }
                    else {
                        await this._changeModel(message.model);
                    }
                    break;
                case 'setApiKey':
                    await vscode.commands.executeCommand('dreamgraph.setArchitectApiKey');
                    break;
                case 'saveDraft':
                    this.draftText = message.text ?? '';
                    break;
                case 'openExternalLink': {
                    const url = message.url;
                    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
                        void vscode.env.openExternal(vscode.Uri.parse(url));
                    }
                    break;
                }
                case 'copyToClipboard': {
                    const text = message.text;
                    if (typeof text === 'string') {
                        void vscode.env.clipboard.writeText(text);
                    }
                    break;
                }
            }
        }, null, this.disposables);
        await this.rehydrateWebview();
    }
    async clearMessages() {
        this.messages.splice(0, this.messages.length);
        await this.persistMessages();
        await this.postState();
    }
    dispose() {
        while (this.disposables.length > 0)
            this.disposables.pop()?.dispose();
    }
    async handleUserMessage(text) {
        const attachmentSummary = this._attachmentSummaryForUserMessage();
        const userMessage = {
            role: 'user',
            content: attachmentSummary ? `${text}\n\n${attachmentSummary}` : text,
            timestamp: new Date().toISOString(),
        };
        this.messages.push(userMessage);
        await this.persistMessages();
        await this.postMessage({ type: 'addMessage', message: userMessage });
        if (!this.architectLlm || !this.architectLlm.isConfigured) {
            const errMsg = {
                role: 'system',
                content: 'Architect LLM is not configured. Select provider and model in the header dropdowns, then set your API key.',
                timestamp: new Date().toISOString(),
            };
            this.messages.push(errMsg);
            await this.persistMessages();
            await this.postMessage({ type: 'addMessage', message: errMsg });
            return;
        }
        try {
            this.streaming = true;
            this.streamingContent = '';
            this.steeringQueue = [];
            this.abortController = new AbortController();
            const envelope = this.contextBuilder ? await this.contextBuilder.buildEnvelope(text) : null;
            const task = (0, index_js_1.inferTask)(envelope?.intentMode ?? 'ask_dreamgraph');
            const { system } = (0, index_js_1.assemblePrompt)(task, envelope);
            const llmMessages = [{ role: 'system', content: system }];
            const recentMessages = this.messages.slice(-20);
            for (const msg of recentMessages) {
                if (msg.role === 'user' || msg.role === 'assistant')
                    llmMessages.push({ role: msg.role, content: msg.content });
            }
            const userContentBlocks = this._buildUserContentBlocks(text);
            if (llmMessages.length > 1 && llmMessages[llmMessages.length - 1].role === 'user') {
                llmMessages[llmMessages.length - 1] = { role: 'user', content: userContentBlocks };
            }
            else {
                llmMessages.push({ role: 'user', content: userContentBlocks });
            }
            await this.postMessage({ type: 'stream-start' });
            let tools = [];
            if (this.mcpClient?.isConnected) {
                try {
                    const raw = await this.mcpClient.listTools();
                    tools = raw.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: (t.inputSchema ?? {}) }));
                }
                catch {
                    // proceed without MCP tools
                }
            }
            for (const lt of local_tools_js_1.LOCAL_TOOL_DEFINITIONS) {
                tools.push({ name: lt.name, description: lt.description, inputSchema: lt.inputSchema });
            }
            let fullContent = '';
            if (tools.length > 0) {
                fullContent = await this.runAgenticLoop(llmMessages, tools);
            }
            else {
                const req = this._createRequestSignal();
                try {
                    await this.architectLlm.stream(llmMessages, (chunk) => {
                        fullContent += chunk;
                        this.streamingContent += chunk;
                        void this.postMessage({ type: 'stream-chunk', chunk });
                    }, req.signal);
                }
                finally {
                    req.dispose();
                }
            }
            const assistantMessage = { role: 'assistant', content: fullContent, timestamp: new Date().toISOString() };
            this.messages.push(assistantMessage);
            await this.persistMessages();
            this.attachments = [];
            await this._syncAttachments();
        }
        catch (err) {
            const errorText = err instanceof Error ? err.message : String(err);
            const isAbort = err instanceof DOMException && err.name === 'AbortError';
            const displayText = isAbort ? 'Generation stopped.' : `Error: ${errorText}`;
            const errMsg = { role: 'system', content: displayText, timestamp: new Date().toISOString() };
            this.messages.push(errMsg);
            await this.persistMessages();
            await this.postMessage({ type: 'addMessage', message: errMsg });
        }
        finally {
            this.resetStreamState();
        }
    }
    _buildUserContentBlocks(text) {
        const capabilities = this.architectLlm?.getModelCapabilities() ?? { textAttachments: false, imageAttachments: false };
        const blocks = [{ type: 'text', text }];
        for (const attachment of this.attachments) {
            if (attachment.kind === 'text' && capabilities.textAttachments && attachment.textContent) {
                blocks.push({
                    type: 'text',
                    text: `Attached file: ${attachment.name}\nPath: ${attachment.path}\n\n${attachment.textContent}`,
                });
            }
            else if (attachment.kind === 'image' && capabilities.imageAttachments && attachment.dataBase64) {
                blocks.push({
                    type: 'image',
                    mimeType: attachment.mimeType,
                    dataBase64: attachment.dataBase64,
                    fileName: attachment.name,
                });
            }
            else if (attachment.kind === 'image') {
                blocks.push({ type: 'text', text: `[Image attachment omitted: current model does not support image input] ${attachment.name}` });
            }
        }
        return blocks;
    }
    _attachmentSummaryForUserMessage() {
        if (this.attachments.length === 0)
            return '';
        const lines = this.attachments.map((a) => `- ${a.name} (${a.kind}${a.note ? `, ${a.note}` : ''})`);
        return `Attachments:\n${lines.join('\n')}`;
    }
    async _pickAttachments() {
        const picks = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: 'Attach to Architect prompt',
            filters: {
                'Supported files': ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'txt', 'py', 'cs', 'java', 'go', 'rs', 'yml', 'yaml', 'xml', 'html', 'css', 'scss', 'sql', 'sh', 'png', 'jpg', 'jpeg', 'webp', 'gif'],
            },
        });
        if (!picks || picks.length === 0)
            return;
        const capabilities = this.architectLlm?.getModelCapabilities() ?? { textAttachments: false, imageAttachments: false };
        const next = [];
        const errors = [];
        for (const uri of picks) {
            try {
                const ext = path.extname(uri.fsPath).toLowerCase();
                const stat = await vscode.workspace.fs.stat(uri);
                const name = path.basename(uri.fsPath);
                const imageMime = ChatPanel.IMAGE_MIME_BY_EXT[ext];
                if (imageMime) {
                    if (!capabilities.imageAttachments) {
                        errors.push(`${name}: current model does not support image attachments.`);
                        continue;
                    }
                    if (stat.size > ChatPanel.MAX_IMAGE_ATTACHMENT_BYTES) {
                        errors.push(`${name}: image exceeds 5 MB limit.`);
                        continue;
                    }
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    next.push({
                        id: `${Date.now()}-${Math.random()}`,
                        name,
                        path: uri.fsPath,
                        mimeType: imageMime,
                        kind: 'image',
                        size: stat.size,
                        dataBase64: Buffer.from(bytes).toString('base64'),
                    });
                    continue;
                }
                if (ChatPanel.TEXT_EXTENSIONS.has(ext)) {
                    if (!capabilities.textAttachments) {
                        errors.push(`${name}: current model does not support text attachments.`);
                        continue;
                    }
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    let textContent = Buffer.from(bytes).toString('utf8');
                    let note;
                    if (Buffer.byteLength(textContent, 'utf8') > ChatPanel.MAX_TEXT_ATTACHMENT_BYTES) {
                        textContent = textContent.slice(0, ChatPanel.MAX_TEXT_ATTACHMENT_BYTES);
                        note = 'truncated to 100 KB';
                    }
                    next.push({
                        id: `${Date.now()}-${Math.random()}`,
                        name,
                        path: uri.fsPath,
                        mimeType: 'text/plain',
                        kind: 'text',
                        size: stat.size,
                        textContent,
                        note,
                    });
                    continue;
                }
                errors.push(`${name}: unsupported file type.`);
            }
            catch (error) {
                errors.push(`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        if (next.length > 0) {
            this.attachments = [...this.attachments, ...next];
            await this._syncAttachments();
        }
        if (errors.length > 0) {
            void this.postMessage({ type: 'error', error: errors.join(' ') });
        }
    }
    async _syncAttachments() {
        await this.postMessage({
            type: 'setAttachments',
            attachments: this.attachments.map((a) => ({ id: a.id, name: a.name, kind: a.kind, mimeType: a.mimeType, size: a.size, note: a.note })),
        });
    }
    async _handlePastedImage(dataBase64, mimeType) {
        const capabilities = this.architectLlm?.getModelCapabilities() ?? { textAttachments: false, imageAttachments: false };
        if (!capabilities.imageAttachments) {
            void this.postMessage({ type: 'error', error: 'Current model does not support image attachments.' });
            return;
        }
        const rawSize = Math.ceil((dataBase64.length * 3) / 4);
        if (rawSize > ChatPanel.MAX_IMAGE_ATTACHMENT_BYTES) {
            void this.postMessage({ type: 'error', error: 'Pasted image exceeds 5 MB limit.' });
            return;
        }
        const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png';
        const name = `clipboard-${Date.now()}${ext}`;
        this.attachments.push({
            id: `${Date.now()}-${Math.random()}`,
            name,
            path: '',
            mimeType,
            kind: 'image',
            size: rawSize,
            dataBase64,
        });
        await this._syncAttachments();
    }
    abortGeneration() { this.abortController?.abort(); }
    /**
     * Create a child AbortSignal that fires on EITHER user abort OR timeout.
     * Returns a dispose function that MUST be called when the request completes
     * to prevent timer leaks.
     */
    _createRequestSignal(timeoutMs = ChatPanel.REQUEST_TIMEOUT_MS) {
        const child = new AbortController();
        const timer = setTimeout(() => child.abort(new Error(`LLM request timed out after ${timeoutMs / 1000}s`)), timeoutMs);
        const onParentAbort = () => {
            clearTimeout(timer);
            child.abort(this.abortController?.signal.reason ?? 'User stopped generation');
        };
        if (this.abortController?.signal.aborted) {
            clearTimeout(timer);
            child.abort(this.abortController.signal.reason);
        }
        else {
            this.abortController?.signal.addEventListener('abort', onParentAbort, { once: true });
        }
        return {
            signal: child.signal,
            dispose: () => {
                clearTimeout(timer);
                this.abortController?.signal.removeEventListener('abort', onParentAbort);
            },
        };
    }
    /**
     * Reset ALL streaming-related state in one place.
     * Sends cleanup messages to the webview so the UI never stays stuck.
     */
    resetStreamState() {
        this.streaming = false;
        this.streamingContent = '';
        this.steeringQueue = [];
        this.abortController = null;
        void this.postMessage({ type: 'stream-thinking', active: false });
        void this.postMessage({ type: 'stream-end', done: true });
    }
    async rehydrateWebview() {
        await this.postState();
        if (this.draftText)
            await this.postMessage({ type: 'restoreDraft', text: this.draftText });
        await this._syncAttachments();
    }
    async postState() {
        await this.postMessage({ type: 'state', state: { messages: this.messages } });
    }
    /**
     * Post a message to the webview. If the webview is currently hidden or
     * disposed, critical messages are buffered and replayed on the next
     * rehydrateWebview() call to prevent silent loss of stream-end/error events.
     */
    async postMessage(message) {
        if (this.view?.webview) {
            // Flush any buffered messages first so order is preserved
            if (this._pendingMessages.length > 0) {
                const pending = this._pendingMessages.splice(0);
                for (const m of pending) {
                    try {
                        await this.view.webview.postMessage(m);
                    }
                    catch { /* view may have gone */ }
                }
            }
            await this.view.webview.postMessage(message);
        }
        else {
            // Buffer stream-end and error messages so they are not silently lost
            // when the webview is hidden (e.g. user switched panel). Streaming
            // chunks are intentionally dropped — they would be stale on reconnect.
            const type = message.type;
            if (type === 'stream-end' || type === 'stream-thinking' || type === 'error' || type === 'addMessage') {
                this._pendingMessages.push(message);
            }
        }
    }
    async persistMessages() {
        if (!this.memory)
            return;
        await this.memory.save(this.currentInstanceId, this.messages);
    }
    async restoreMessages() {
        if (!this.memory)
            return;
        const saved = await this.memory.load(this.currentInstanceId);
        this.messages.splice(0, this.messages.length, ...saved);
        await this.postState();
    }
    _sendModelUpdate() {
        const provider = this.architectLlm?.currentConfig?.provider ?? '';
        const model = this.architectLlm?.currentConfig?.model ?? '';
        const models = provider === 'anthropic' ? architect_llm_1.ANTHROPIC_MODELS : provider === 'openai' ? architect_llm_1.OPENAI_MODELS : [];
        const capabilities = this.architectLlm?.getModelCapabilities(provider, model) ?? { textAttachments: false, imageAttachments: false };
        void this.postMessage({
            type: 'updateModels',
            providers: ['anthropic', 'openai', 'ollama'],
            models,
            current: { provider, model },
            capabilities,
        });
    }
    _checkApiKeyWarning() {
        // noop preserved behavior if implemented elsewhere
    }
    async _changeProvider(provider) {
        // Update in-memory config immediately so _sendModelUpdate reads the new value.
        if (this.architectLlm) {
            const models = provider === 'anthropic' ? architect_llm_1.ANTHROPIC_MODELS : provider === 'openai' ? architect_llm_1.OPENAI_MODELS : [];
            const defaultModel = models[0] ?? '';
            const apiKey = (provider !== 'ollama')
                ? (await this.architectLlm.getApiKey(provider) ?? '')
                : '';
            this.architectLlm.applyConfig({
                provider,
                model: defaultModel,
                baseUrl: '',
                apiKey,
            });
        }
        this._sendModelUpdate();
        await this._syncAttachments();
        // Persist to settings in background (do NOT call loadConfig — it would race)
        const cfg = vscode.workspace.getConfiguration('dreamgraph.architect');
        const defaultModel = this.architectLlm?.currentConfig?.model ?? '';
        void cfg.update('provider', provider, vscode.ConfigurationTarget.Global);
        if (defaultModel)
            void cfg.update('model', defaultModel, vscode.ConfigurationTarget.Global);
    }
    async _changeModel(model) {
        // Update in-memory config immediately so _sendModelUpdate reads the new value.
        if (this.architectLlm) {
            const prev = this.architectLlm.currentConfig;
            this.architectLlm.applyConfig({
                provider: prev?.provider ?? '',
                model,
                baseUrl: prev?.baseUrl ?? '',
                apiKey: prev?.apiKey ?? '',
            });
        }
        this._sendModelUpdate();
        await this._syncAttachments();
        // Persist to settings in background (do NOT call loadConfig — it would race)
        void vscode.workspace.getConfiguration('dreamgraph.architect').update('model', model, vscode.ConfigurationTarget.Global);
    }
    static MAX_TOOL_ITERATIONS = 32;
    static MAX_RETRIES = 3;
    /** Cap on accumulated streaming content to prevent context window overflow
     *  when the agent runs many iterations. Content beyond this is still executed
     *  but not accumulated into streamingContent (the webview already received it). */
    static MAX_STREAMING_CONTENT_CHARS = 200_000;
    /** Call callWithTools with automatic retry on 429 rate-limit errors. */
    async _callWithToolsRetry(llmMessages, tools, rawMessages, signal) {
        for (let attempt = 0; attempt <= ChatPanel.MAX_RETRIES; attempt++) {
            try {
                return await this.architectLlm.callWithTools(llmMessages, tools, rawMessages, signal);
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                const is429 = msg.includes('429') || msg.toLowerCase().includes('rate_limit');
                if (!is429 || attempt === ChatPanel.MAX_RETRIES)
                    throw err;
                // Parse "try again in X.XXXs" from the error, fallback to exponential backoff
                const retryMatch = msg.match(/try again in ([\d.]+)s/i);
                const waitSec = retryMatch ? parseFloat(retryMatch[1]) + 1 : (attempt + 1) * 8;
                const waitMs = Math.min(waitSec * 1000, 60_000);
                const note = `\n⏳ Rate limited — retrying in ${Math.ceil(waitSec)}s (attempt ${attempt + 1}/${ChatPanel.MAX_RETRIES})…\n`;
                this.streamingContent += note;
                void this.postMessage({ type: 'stream-chunk', chunk: note });
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        }
        throw new Error('Rate limit retries exhausted'); // unreachable but satisfies TS
    }
    static _toolTimeoutMs(toolName) {
        return ChatPanel.TOOL_TIMEOUT_MS[toolName] ?? ChatPanel.TOOL_TIMEOUT_MS._default;
    }
    async runAgenticLoop(llmMessages, tools) {
        if (!this.architectLlm)
            return '';
        let fullContent = '';
        // rawMessages tracks the full conversation in Anthropic-native format
        // (assistant messages with tool_use blocks, user messages with tool_result blocks).
        // Both Anthropic and OpenAI providers accept this via callWithTools(…, rawMessages).
        let rawMessages;
        for (let iteration = 0; iteration < ChatPanel.MAX_TOOL_ITERATIONS; iteration++) {
            // Throttle between iterations to avoid TPM rate limits on fast tool loops
            if (iteration > 0)
                await new Promise((r) => setTimeout(r, 2000));
            // Show thinking indicator while waiting for the non-streaming API call
            void this.postMessage({ type: 'stream-thinking', active: true });
            // Create a per-iteration signal with hard timeout (P2) linked to user abort (P1)
            const req = this._createRequestSignal();
            let response;
            try {
                response = await this._callWithToolsRetry(llmMessages, tools, rawMessages, req.signal);
            }
            catch (err) {
                // Ensure thinking indicator is hidden before the error propagates
                void this.postMessage({ type: 'stream-thinking', active: false });
                throw err;
            }
            finally {
                req.dispose();
            }
            // Hide thinking indicator now that we have a response
            void this.postMessage({ type: 'stream-thinking', active: false });
            // Stream any text content to the webview
            if (response.content) {
                fullContent += response.content;
                // Guard: cap streamingContent to prevent unbounded memory growth across
                // many tool iterations. The webview receives each chunk regardless — only
                // the in-memory accumulator is capped.
                if (this.streamingContent.length < ChatPanel.MAX_STREAMING_CONTENT_CHARS) {
                    this.streamingContent += response.content;
                }
                void this.postMessage({ type: 'stream-chunk', chunk: response.content });
            }
            // If no tool calls, we're done
            if (response.stopReason !== 'tool_use' || response.toolCalls.length === 0) {
                break;
            }
            // Build the assistant message with tool_use blocks (Anthropic format)
            const assistantBlocks = [];
            if (response.content) {
                assistantBlocks.push({ type: 'text', text: response.content });
            }
            for (const tc of response.toolCalls) {
                assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
            }
            // Execute each tool call and collect results
            const toolResultBlocks = [];
            for (const tc of response.toolCalls) {
                // Show tool execution status (P4)
                const statusChunk = `\n\n⚡ Running \`${tc.name}\`…\n`;
                fullContent += statusChunk;
                if (this.streamingContent.length < ChatPanel.MAX_STREAMING_CONTENT_CHARS) {
                    this.streamingContent += statusChunk;
                }
                void this.postMessage({ type: 'stream-chunk', chunk: statusChunk });
                void this.postMessage({ type: 'tool-progress', tool: tc.name, message: 'started' });
                const toolTimeout = ChatPanel._toolTimeoutMs(tc.name);
                let result;
                try {
                    if ((0, local_tools_js_1.isLocalTool)(tc.name)) {
                        // Wrap local tool with per-tool timeout (P5)
                        const raw = await Promise.race([
                            (0, local_tools_js_1.executeLocalTool)(tc.name, tc.input),
                            new Promise((_, reject) => setTimeout(() => reject(new Error(`Local tool "${tc.name}" timed out after ${toolTimeout / 1000}s`)), toolTimeout)),
                        ]);
                        result = typeof raw === 'string' ? raw : JSON.stringify(raw);
                    }
                    else if (this.mcpClient?.isConnected) {
                        // Pass per-tool timeout + progress callback (P4 + P5)
                        const raw = await this.mcpClient.callTool(tc.name, tc.input, toolTimeout, (message, progress, total) => {
                            void this.postMessage({ type: 'tool-progress', tool: tc.name, message, progress, total });
                        });
                        result = typeof raw === 'string' ? raw : JSON.stringify(raw);
                    }
                    else {
                        result = JSON.stringify({ error: `Tool "${tc.name}" is not available — MCP client is not connected.` });
                    }
                }
                catch (err) {
                    result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
                }
                // Show tool completion (P4)
                const doneChunk = `✓ \`${tc.name}\` done\n`;
                fullContent += doneChunk;
                if (this.streamingContent.length < ChatPanel.MAX_STREAMING_CONTENT_CHARS) {
                    this.streamingContent += doneChunk;
                }
                void this.postMessage({ type: 'stream-chunk', chunk: doneChunk });
                void this.postMessage({ type: 'tool-progress', tool: tc.name, message: 'completed' });
                toolResultBlocks.push({
                    type: 'tool_result',
                    tool_use_id: tc.id,
                    content: result,
                });
            }
            // Build rawMessages for the next iteration.
            // First call: seed from the original llmMessages (non-system only).
            if (!rawMessages) {
                rawMessages = llmMessages
                    .filter((m) => m.role !== 'system')
                    .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content }));
            }
            // Append assistant turn (with tool_use blocks) and user turn (with tool_result blocks)
            rawMessages.push({ role: 'assistant', content: assistantBlocks });
            rawMessages.push({ role: 'user', content: toolResultBlocks });
        }
        return fullContent;
    }
    /**
     * Load markdown-it and DOMPurify browser builds from node_modules.
     * Results are cached on the instance. Falls back gracefully if files
     * are missing (e.g. corrupt .vsix or dev environment without npm install).
     */
    _loadLibrarySources() {
        if (this._markdownItSource !== null && this._domPurifySource !== null)
            return;
        const extPath = this.context.extensionPath;
        const libs = [
            { key: 'md', relPath: path.join('node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'), name: 'markdown-it' },
            { key: 'dp', relPath: path.join('node_modules', 'dompurify', 'dist', 'purify.min.js'), name: 'DOMPurify' },
        ];
        for (const lib of libs) {
            try {
                const fullPath = path.join(extPath, lib.relPath);
                const src = fs.readFileSync(fullPath, 'utf-8');
                if (lib.key === 'md')
                    this._markdownItSource = src;
                else
                    this._domPurifySource = src;
            }
            catch (err) {
                // Log to output channel if available, else console
                console.error(`[DreamGraph] Failed to load ${lib.name} browser build — falling back to plaintext rendering. ${err instanceof Error ? err.message : String(err)}`);
                if (lib.key === 'md')
                    this._markdownItSource = '';
                else
                    this._domPurifySource = '';
            }
        }
    }
    getHtml(_webview) {
        this._loadLibrarySources();
        const nonce = String(Date.now());
        const markdownReady = this._markdownItSource && this._domPurifySource;
        // Inline library scripts only when both loaded successfully.
        // If either is missing, webview falls back to plaintext (textContent) rendering.
        const libraryScripts = markdownReady
            ? `<script nonce="${nonce}">${this._markdownItSource}</script>\n  <script nonce="${nonce}">${this._domPurifySource}</script>\n  <script nonce="${nonce}">${(0, render_markdown_js_1.getRenderScript)()}</script>`
            : '';
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${(0, styles_js_1.getStyles)()}</style>
</head>
<body>
  <div class="header">
    <select id="providerSelect" title="Provider">
      <option value="">Provider…</option>
      <option value="anthropic">Anthropic</option>
      <option value="openai">OpenAI</option>
      <option value="ollama">Ollama</option>
    </select>
    <select id="modelSelect" title="Model">
      <option value="">Model…</option>
    </select>
  </div>
  <div id="messages"></div>
  <div id="attachments"></div>
  <form id="composer">
    <button id="attachBtn" class="icon-btn" type="button" title="Attach files or images">
      <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6h-1.5v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6H16.5z"/></svg>
    </button>
    <textarea id="prompt" rows="1" placeholder="Ask DreamGraph…" autocomplete="off"></textarea>
    <button id="sendBtn" class="icon-btn primary" type="submit" title="Send message">
      <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
    </button>
    <button id="stopBtn" class="icon-btn danger" type="button" title="Stop generation" style="display:none">
      <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
    </button>
    <button id="clear" class="icon-btn" type="button" title="Clear conversation">
      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
    </button>
  </form>
  ${libraryScripts}
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const messagesEl = document.getElementById('messages');
      const attachmentsEl = document.getElementById('attachments');
      const form = document.getElementById('composer');
      const promptEl = document.getElementById('prompt');
      const attachBtn = document.getElementById('attachBtn');
      const sendBtn = document.getElementById('sendBtn');
      const stopBtn = document.getElementById('stopBtn');
      const clearEl = document.getElementById('clear');
      const providerSelect = document.getElementById('providerSelect');
      const modelSelect = document.getElementById('modelSelect');

      // Markdown rendering availability flag
      const markdownEnabled = typeof window.renderMarkdown === 'function';

      let streamingEl = null;
      let streamingContent = '';
      let renderTimer = null;
      let promptHistory = [];
      let historyIndex = -1;
      let historyDraft = '';
      let attachmentState = [];
      let currentCapabilities = { textAttachments: false, imageAttachments: false };

      function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

      function autoResize() { promptEl.style.height = 'auto'; promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px'; }

      /** Create a message bubble. Renders markdown for assistant messages. */
      function createBubble(role, content) {
        const div = document.createElement('div');
        div.className = 'message ' + role;
        if (role === 'assistant' && markdownEnabled) {
          div.classList.add('markdown-body');
          window.renderCompletedMessage(div, content);
        } else {
          div.textContent = content;
        }
        return div;
      }

      /** Re-render all messages from state (after clear, hydrate, etc.) */
      function render(messages) {
        messagesEl.innerHTML = '';
        streamingEl = null;
        for (const message of messages) {
          messagesEl.appendChild(createBubble(message.role, message.content));
        }
        scrollToBottom();
      }

      function showThinking() {
        if (document.getElementById('thinking-indicator')) return;
        const el = document.createElement('div');
        el.id = 'thinking-indicator';
        el.textContent = '💭 Thinking';
        messagesEl.appendChild(el);
        scrollToBottom();
      }
      function hideThinking() {
        const el = document.getElementById('thinking-indicator');
        if (el) el.remove();
      }

      /** Mirror of server-side resetStreamState — ensures UI never stays stuck. */
      function resetStreamUI() {
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        // Final render of any remaining streamed content
        if (streamingEl && streamingContent && markdownEnabled) {
          streamingEl.innerHTML = window.renderMarkdown(streamingContent);
          window.addCopyButtons(streamingEl);
        }
        streamingEl = null;
        streamingContent = '';
        hideThinking();
        promptEl.disabled = false;
        promptEl.placeholder = 'Ask DreamGraph…';
        stopBtn.style.display = 'none';
      }

      function renderAttachments(items) {
        attachmentState = items || [];
        attachmentsEl.innerHTML = '';
        for (const item of attachmentState) {
          const chip = document.createElement('div');
          chip.className = 'attachment-chip';
          const icon = document.createElement('span');
          icon.className = 'chip-icon';
          icon.textContent = item.kind === 'image' ? '🖼' : '📄';
          chip.appendChild(icon);
          const label = document.createElement('span');
          label.textContent = item.name + (item.note ? ' (' + item.note + ')' : '');
          chip.appendChild(label);
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'attachment-remove';
          remove.textContent = '×';
          remove.title = 'Remove attachment';
          remove.addEventListener('click', () => vscode.postMessage({ type: 'removeAttachment', id: item.id }));
          chip.appendChild(remove);
          attachmentsEl.appendChild(chip);
        }
      }

      function updateModels(_providers, models, current, capabilities) {
        currentCapabilities = capabilities || { textAttachments: false, imageAttachments: false };
        if (current.provider) { providerSelect.value = current.provider; }
        modelSelect.innerHTML = '';
        if (models.length === 0) {
          const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'Model…'; modelSelect.appendChild(opt);
        }
        models.forEach(function(m) {
          const opt = document.createElement('option'); opt.value = m; opt.textContent = m; modelSelect.appendChild(opt);
        });
        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '+ Custom model…';
        modelSelect.appendChild(customOpt);
        if (current.model) {
          let found = false;
          for (let i = 0; i < modelSelect.options.length; i++) {
            if (modelSelect.options[i].value === current.model) { found = true; break; }
          }
          if (!found && current.model) {
            const extraOpt = document.createElement('option');
            extraOpt.value = current.model;
            extraOpt.textContent = current.model;
            modelSelect.insertBefore(extraOpt, modelSelect.querySelector('[value="__custom__"]'));
          }
          modelSelect.value = current.model;
        }
        attachBtn.disabled = !(capabilities && (capabilities.textAttachments || capabilities.imageAttachments));
        attachBtn.title = attachBtn.disabled ? 'Selected model does not support attachments' : 'Attach files or images (or paste from clipboard)';
      }

      function showError(message) {
        const el = document.createElement('div');
        el.className = 'message error-msg';
        el.textContent = message;
        messagesEl.appendChild(el);
        scrollToBottom();
      }

      /* ── Clipboard paste handler for images ── */
      promptEl.addEventListener('paste', function(e) {
        const items = (e.clipboardData || {}).items;
        if (!items) return;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault();
            const file = items[i].getAsFile();
            if (!file) return;
            if (!currentCapabilities.imageAttachments) {
              showError('Current model does not support image attachments.');
              return;
            }
            const reader = new FileReader();
            reader.onload = function() {
              const dataUrl = reader.result;
              const base64 = dataUrl.split(',')[1];
              const mimeType = file.type || 'image/png';
              vscode.postMessage({ type: 'pasteImage', dataBase64: base64, mimeType: mimeType });
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      });

      providerSelect.addEventListener('change', function() {
        vscode.postMessage({ type: 'changeProvider', provider: this.value });
      });
      modelSelect.addEventListener('change', function() {
        vscode.postMessage({ type: 'changeModel', model: this.value });
      });
      attachBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'pickAttachments' });
      });

      window.addEventListener('message', function(event) {
        const message = event.data;
        switch (message.type) {
          case 'state':
            if (message.state) render(message.state.messages || []);
            break;

          case 'addMessage':
            if (message.message) {
              messagesEl.appendChild(createBubble(message.message.role, message.message.content));
              scrollToBottom();
            }
            break;

          case 'stream-start':
            streamingEl = document.createElement('div');
            streamingEl.className = 'message assistant' + (markdownEnabled ? ' markdown-body' : '');
            streamingContent = '';
            messagesEl.appendChild(streamingEl);
            scrollToBottom();
            promptEl.placeholder = 'Steer the conversation…';
            stopBtn.style.display = '';
            break;

          case 'stream-chunk':
            if (streamingEl && message.chunk) {
              hideThinking();
              streamingContent += message.chunk;
              // Debounced rerender — ~80ms interval, no copy buttons during streaming
              if (renderTimer) clearTimeout(renderTimer);
              if (markdownEnabled) {
                renderTimer = setTimeout(function() {
                  if (!streamingEl) return;
                  const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 40;
                  streamingEl.innerHTML = window.renderMarkdown(streamingContent);
                  if (atBottom) scrollToBottom();
                }, 80);
              } else {
                // Plaintext fallback
                streamingEl.textContent = streamingContent;
                scrollToBottom();
              }
            }
            break;

          case 'stream-thinking':
            message.active ? showThinking() : hideThinking();
            break;

          case 'stream-end':
            resetStreamUI();
            promptEl.focus();
            break;

          case 'tool-progress':
            // Visual progress already handled via stream-chunk; structured events available for future use
            break;

          case 'updateModels':
            updateModels(message.providers, message.models, message.current, message.capabilities);
            break;

          case 'setAttachments':
            renderAttachments(message.attachments || []);
            break;

          case 'error':
            if (message.error) showError(message.error);
            break;

          case 'restoreDraft':
            if (message.text) {
              promptEl.value = message.text;
              vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: message.text }));
              autoResize();
            }
            break;
        }
      });

      function sendPrompt() {
        const text = promptEl.value.trim();
        if (!text) return;
        if (promptHistory.length === 0 || promptHistory[promptHistory.length - 1] !== text) promptHistory.push(text);
        historyIndex = -1; historyDraft = '';
        vscode.postMessage({ type: 'send', text });
        promptEl.value = ''; promptEl.style.height = 'auto';
        vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: '' }));
        vscode.postMessage({ type: 'saveDraft', text: '' });
      }

      promptEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(); return; }
        if (e.key === 'ArrowUp') {
          var cursorAtStart = promptEl.selectionStart === 0 && promptEl.selectionEnd === 0;
          var textBeforeCursor = promptEl.value.substring(0, promptEl.selectionStart);
          if (cursorAtStart || !textBeforeCursor.includes('\\n')) {
            if (promptHistory.length > 0) {
              if (historyIndex === -1) { historyDraft = promptEl.value; historyIndex = promptHistory.length - 1; }
              else if (historyIndex > 0) historyIndex--; else return;
              e.preventDefault(); promptEl.value = promptHistory[historyIndex]; autoResize(); promptEl.setSelectionRange(0,0);
            }
          }
          return;
        }
        if (e.key === 'ArrowDown') {
          if (historyIndex === -1) return;
          var textAfterCursor = promptEl.value.substring(promptEl.selectionEnd);
          var cursorAtEnd = promptEl.selectionEnd === promptEl.value.length;
          if (cursorAtEnd || !textAfterCursor.includes('\\n')) {
            if (historyIndex < promptHistory.length - 1) { historyIndex++; e.preventDefault(); promptEl.value = promptHistory[historyIndex]; }
            else { historyIndex = -1; e.preventDefault(); promptEl.value = historyDraft; }
            autoResize(); var len = promptEl.value.length; promptEl.setSelectionRange(len, len);
          }
        }
      });

      form.addEventListener('submit', function(event) { event.preventDefault(); sendPrompt(); });
      stopBtn.addEventListener('click', function() { vscode.postMessage({ type: 'stop' }); });
      clearEl.addEventListener('click', function() { vscode.postMessage({ type: 'clear' }); });

      var savedState = vscode.getState();
      if (savedState && savedState.draft) { promptEl.value = savedState.draft; autoResize(); }
      promptEl.addEventListener('input', function() {
        autoResize();
        var draft = promptEl.value;
        vscode.setState(Object.assign({}, vscode.getState() || {}, { draft: draft }));
        vscode.postMessage({ type: 'saveDraft', text: draft });
      });

      // Init link interceptor (Slice 1 — routes http(s) links via extension host)
      if (markdownEnabled && typeof window.initLinkInterceptor === 'function') {
        window.initLinkInterceptor();
      }

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
    }
}
exports.ChatPanel = ChatPanel;
//# sourceMappingURL=chat-panel.js.map