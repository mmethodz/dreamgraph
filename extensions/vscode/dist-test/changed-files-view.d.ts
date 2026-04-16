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
    previousPath?: string;
    timestamp: number;
}
declare class ChangedFileItem extends vscode.TreeItem {
    readonly entry: ChangedFileEntry;
    constructor(entry: ChangedFileEntry);
}
export declare class ChangedFilesView implements vscode.TreeDataProvider<ChangedFileItem>, vscode.Disposable {
    private readonly context;
    private readonly _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<void | ChangedFileItem | undefined>;
    private entries;
    private readonly disposables;
    constructor(context: vscode.ExtensionContext);
    getTreeItem(element: ChangedFileItem): vscode.TreeItem | Thenable<vscode.TreeItem>;
    getChildren(element?: ChangedFileItem | undefined): Promise<ChangedFileItem[]>;
    /** Programmatic recording API — call from tool handlers if you want precise types like 'rename'. */
    record(type: ChangeType, filePath: string, previousPath?: string): void;
    clear(): void;
    dispose(): void;
    private persist;
    restore(): void;
}
export declare function registerChangedFilesView(context: vscode.ExtensionContext): ChangedFilesView;
export {};
//# sourceMappingURL=changed-files-view.d.ts.map