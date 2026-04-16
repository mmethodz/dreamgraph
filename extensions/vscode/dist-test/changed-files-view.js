"use strict";
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
exports.ChangedFilesView = void 0;
exports.registerChangedFilesView = registerChangedFilesView;
const vscode = __importStar(require("vscode"));
class ChangedFileItem extends vscode.TreeItem {
    entry;
    constructor(entry) {
        super(vscode.workspace.asRelativePath(entry.filePath), vscode.TreeItemCollapsibleState.None);
        this.entry = entry;
        const when = new Date(entry.timestamp).toLocaleTimeString();
        this.description = `${entry.type} · ${when}`;
        this.resourceUri = vscode.Uri.file(entry.filePath);
        this.contextValue = 'changedFileItem';
        switch (entry.type) {
            case 'create':
                this.iconPath = new vscode.ThemeIcon('new-file');
                break;
            case 'edit':
                this.iconPath = new vscode.ThemeIcon('edit');
                break;
            case 'delete':
                this.iconPath = new vscode.ThemeIcon('trash');
                break;
            case 'rename':
                this.iconPath = new vscode.ThemeIcon('versions');
                break;
        }
        this.command = {
            title: 'Open Changed File',
            command: 'vscode.open',
            arguments: [this.resourceUri]
        };
    }
}
class ChangedFilesView {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    entries = [];
    disposables = [];
    constructor(context) {
        this.context = context;
        // File system watcher — lightweight and reliable regardless of how the file was changed
        const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
        this.disposables.push(watcher, watcher.onDidCreate(uri => this.record('create', uri.fsPath)), watcher.onDidChange(uri => this.record('edit', uri.fsPath)), watcher.onDidDelete(uri => this.record('delete', uri.fsPath)));
        // Commands
        this.disposables.push(vscode.commands.registerCommand('dreamgraph.changedFiles.clear', () => this.clear()), vscode.commands.registerCommand('dreamgraph.changedFiles.copyPath', (item) => {
            if (item?.entry?.filePath) {
                vscode.env.clipboard.writeText(item.entry.filePath);
            }
        }), vscode.commands.registerCommand('dreamgraph.changedFiles.revealInExplorer', (item) => {
            if (item?.entry?.filePath) {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.entry.filePath));
            }
        }));
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element)
            return [];
        return this.entries
            .slice()
            .reverse() // newest first
            .map(e => new ChangedFileItem(e));
    }
    /** Programmatic recording API — call from tool handlers if you want precise types like 'rename'. */
    record(type, filePath, previousPath) {
        // Filter noise: ignore node_modules, .git, build outputs
        const rel = vscode.workspace.asRelativePath(filePath);
        if (/^(node_modules|\.git|dist|out)\//.test(rel))
            return;
        // Coalesce: if the last entry for this file was very recent and same type, drop it
        const now = Date.now();
        const lastIdx = this.entries.findIndex(e => e.filePath === filePath);
        if (lastIdx >= 0) {
            const last = this.entries[lastIdx];
            if (last.type === type && now - last.timestamp < 500) {
                return;
            }
            // Move to top with updated timestamp/type
            this.entries.splice(lastIdx, 1);
        }
        this.entries.push({ type, filePath, previousPath, timestamp: now });
        this._onDidChangeTreeData.fire();
        this.persist();
    }
    clear() {
        this.entries = [];
        this._onDidChangeTreeData.fire();
        this.persist();
    }
    dispose() {
        this.disposables.forEach(d => d.dispose());
    }
    persist() {
        this.context.workspaceState.update('changedFiles.entries', this.entries);
    }
    restore() {
        const saved = this.context.workspaceState.get('changedFiles.entries');
        if (Array.isArray(saved)) {
            this.entries = saved;
            this._onDidChangeTreeData.fire();
        }
    }
}
exports.ChangedFilesView = ChangedFilesView;
// Self-registration helper: if the extension calls this, the TreeView is bound under the expected ID
function registerChangedFilesView(context) {
    const provider = new ChangedFilesView(context);
    provider.restore();
    const tree = vscode.window.createTreeView('dreamgraph.changedFiles', { treeDataProvider: provider });
    context.subscriptions.push(provider, tree);
    return provider;
}
//# sourceMappingURL=changed-files-view.js.map