import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChromaDBService } from './chromadbService';

const MAX_RECENT = 20;
const RECENT_KEY = 'chromadbViewer.recentDatabases';

export class ChromaDBViewerPanel {
    public static currentPanel: ChromaDBViewerPanel | undefined;
    private static readonly viewType = 'chromadbViewer';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _context: vscode.ExtensionContext;
    private readonly _service: ChromaDBService;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(context: vscode.ExtensionContext): ChromaDBViewerPanel {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (ChromaDBViewerPanel.currentPanel) {
            ChromaDBViewerPanel.currentPanel._panel.reveal(column);
            return ChromaDBViewerPanel.currentPanel;
        }

        const panel = vscode.window.createWebviewPanel(
            ChromaDBViewerPanel.viewType,
            'ChromaDB Viewer',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.file(path.join(context.extensionPath, 'media')),
                ],
            }
        );

        ChromaDBViewerPanel.currentPanel = new ChromaDBViewerPanel(panel, context);
        return ChromaDBViewerPanel.currentPanel;
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._context = context;
        this._service = new ChromaDBService();

        this._panel.webview.html = this._getWebviewContent();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => this._handleMessage(msg),
            null,
            this._disposables
        );
    }

    public connectToDatabase(dbPath: string) {
        // Send connect message to webview after it initializes
        setTimeout(() => {
            this._panel.webview.postMessage({ type: 'connectToDb', path: dbPath });
        }, 500);
    }

    public dispose() {
        ChromaDBViewerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }

    // ---- Recent databases (stored in globalState) ----

    private _getRecent(): any[] {
        return this._context.globalState.get<any[]>(RECENT_KEY, []);
    }

    private _saveRecent(entries: any[]) {
        this._context.globalState.update(RECENT_KEY, entries);
    }

    private _addToRecent(dbPath: string) {
        let entries = this._getRecent();
        const absPath = path.resolve(dbPath);
        entries = entries.filter(e => e.path !== absPath);
        const stat = fs.statSync(absPath);
        entries.unshift({
            path: absPath,
            filename: path.basename(absPath),
            size_mb: Math.round(stat.size / (1024 * 1024) * 100) / 100,
            last_opened: new Date().toISOString().replace('T', ' ').substring(0, 19),
        });
        entries = entries.slice(0, MAX_RECENT);
        this._saveRecent(entries);
    }

    // ---- Message handler ----

    private async _handleMessage(message: any) {
        const { id, command, params } = message;
        try {
            let result: any;
            switch (command) {
                case 'getStatus':
                    result = this._service.getStatus();
                    break;
                case 'connect':
                    result = await this._service.connect(params.path);
                    this._addToRecent(result.path);
                    this._panel.title = `${result.filename} — ChromaDB Viewer`;
                    break;
                case 'disconnect':
                    result = this._service.disconnect();
                    this._panel.title = 'ChromaDB Viewer';
                    break;
                case 'getInfo':
                    result = this._service.getInfo();
                    break;
                case 'getStats':
                    result = await this._service.getStats();
                    break;
                case 'getTables':
                    result = await this._service.getTables();
                    break;
                case 'getTableSchema':
                    result = await this._service.getTableSchema(params.tableName);
                    break;
                case 'getTableRows':
                    result = await this._service.getTableRows({
                        tableName: params.tableName,
                        page: params.page,
                        pageSize: params.pageSize ?? params.page_size,
                        sortCol: params.sortCol ?? params.sort_col,
                        sortDir: params.sortDir ?? params.sort_dir,
                        filters: params.filters,
                    });
                    break;
                case 'executeQuery':
                    result = await this._service.executeQuery(params.sql);
                    break;
                case 'getCollections':
                    result = await this._service.getCollections();
                    break;
                case 'getCollectionDocs':
                    result = await this._service.getCollectionDocs({
                        collectionId: params.collectionId,
                        page: params.page,
                        pageSize: params.pageSize ?? params.page_size,
                        search: params.search,
                    });
                    break;
                case 'getRecent': {
                    const entries = this._getRecent();
                    for (const e of entries) {
                        e.exists = fs.existsSync(e.path);
                    }
                    result = { recent: entries };
                    break;
                }
                case 'clearRecent':
                    this._saveRecent([]);
                    result = { recent: [] };
                    break;
                case 'fileDialog': {
                    const uris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: {
                            'SQLite Databases': ['sqlite3', 'db'],
                            'All Files': ['*'],
                        },
                        title: 'Select ChromaDB Database',
                    });
                    result = { path: uris && uris.length > 0 ? uris[0].fsPath : null };
                    break;
                }
                case 'browse':
                    result = this._service.browse(params.path);
                    break;
                case 'exportTable': {
                    const exported = await this._service.exportTable({
                        tableName: params.tableName,
                        format: params.format,
                        filters: params.filters,
                    });
                    const saveUri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file(exported.filename),
                        filters: params.format === 'json'
                            ? { 'JSON': ['json'] }
                            : { 'CSV': ['csv'] },
                    });
                    if (saveUri) {
                        fs.writeFileSync(saveUri.fsPath, exported.content, 'utf-8');
                        vscode.window.showInformationMessage(`Exported to ${saveUri.fsPath}`);
                    }
                    result = { success: true };
                    break;
                }
                default:
                    throw new Error(`Unknown command: ${command}`);
            }
            this._panel.webview.postMessage({ id, data: result });
        } catch (e: any) {
            this._panel.webview.postMessage({ id, error: e.message });
        }
    }

    // ---- Webview HTML ----

    private _getWebviewContent(): string {
        const htmlPath = path.join(this._context.extensionPath, 'media', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');
        return html;
    }
}
