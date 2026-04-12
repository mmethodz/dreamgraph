import * as vscode from 'vscode';

/**
 * Files Changed View
 *
 * Shows a live list of files that changed during the current VS Code session.
 * Sources of truth:
 *  - VS Code FileSystemWatcher (create/change/delete)
 *  - Optional manual recording via record(type, filePath)
 *
 * This does not try to be a full Git diff — it’s a lightweight, session-scoped
 * indicator so users can quickly jump to touched files after tool-driven edits
 * (e.g., edit_entity/edit_file/create_file/rename_file coming from the Architect).
 */

export type ChangeType = 'create' | 'edit' | 'delete' | 'rename';

export interface ChangedFileEntry {
  type: ChangeType;
  filePath: string;
  previousPath?: string; // for rename
  timestamp: number;
}

class ChangedFileItem extends vscode.TreeItem {
  constructor(public readonly entry: ChangedFileEntry) {
    super(vscode.workspace.asRelativePath(entry.filePath), vscode.TreeItemCollapsibleState.None);

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

export class ChangedFilesView implements vscode.TreeDataProvider<ChangedFileItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ChangedFileItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private entries: ChangedFileEntry[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    // File system watcher — lightweight and reliable regardless of how the file was changed
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(uri => this.record('create', uri.fsPath)),
      watcher.onDidChange(uri => this.record('edit', uri.fsPath)),
      watcher.onDidDelete(uri => this.record('delete', uri.fsPath)),
    );

    // Commands
    this.disposables.push(
      vscode.commands.registerCommand('dreamgraph.changedFiles.clear', () => this.clear()),
      vscode.commands.registerCommand('dreamgraph.changedFiles.copyPath', (item: ChangedFileItem) => {
        if (item?.entry?.filePath) {
          vscode.env.clipboard.writeText(item.entry.filePath);
        }
      }),
      vscode.commands.registerCommand('dreamgraph.changedFiles.revealInExplorer', (item: ChangedFileItem) => {
        if (item?.entry?.filePath) {
          vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.entry.filePath));
        }
      }),
    );
  }

  getTreeItem(element: ChangedFileItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    return element;
  }

  async getChildren(element?: ChangedFileItem | undefined): Promise<ChangedFileItem[]> {
    if (element) return [];
    return this.entries
      .slice()
      .reverse() // newest first
      .map(e => new ChangedFileItem(e));
  }

  /** Programmatic recording API — call from tool handlers if you want precise types like 'rename'. */
  record(type: ChangeType, filePath: string, previousPath?: string) {
    // Filter noise: ignore node_modules, .git, build outputs
    const rel = vscode.workspace.asRelativePath(filePath);
    if (/^(node_modules|\.git|dist|out)\//.test(rel)) return;

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

  private persist() {
    this.context.workspaceState.update('changedFiles.entries', this.entries);
  }

  restore() {
    const saved = this.context.workspaceState.get<ChangedFileEntry[]>('changedFiles.entries');
    if (Array.isArray(saved)) {
      this.entries = saved;
      this._onDidChangeTreeData.fire();
    }
  }
}

// Self-registration helper: if the extension calls this, the TreeView is bound under the expected ID
export function registerChangedFilesView(context: vscode.ExtensionContext) {
  const provider = new ChangedFilesView(context);
  provider.restore();
  const tree = vscode.window.createTreeView('dreamgraph.changedFiles', { treeDataProvider: provider });
  context.subscriptions.push(provider, tree);
  return provider;
}
