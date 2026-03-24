import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChromaDBService } from './chromadbService';

const MAX_RECENT = 20;
const RECENT_KEY = 'chromadbViewer.recentDatabases';

export class ChromaDBEditorProvider implements vscode.CustomReadonlyEditorProvider {
    private static readonly viewType = 'chromadbViewer.editor';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            ChromaDBEditorProvider.viewType,
            new ChromaDBEditorProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const service = new ChromaDBService();

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
            ],
        };

        webviewPanel.webview.html = this.getWebviewContent();

        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            const { id, command, params } = message;
            try {
                let result: any;
                switch (command) {
                    case 'getStatus':
                        result = service.getStatus();
                        break;
                    case 'connect':
                        result = await service.connect(params.path);
                        this.addToRecent(result.path);
                        webviewPanel.title = `${result.filename} — ChromaDB Viewer`;
                        break;
                    case 'disconnect':
                        result = service.disconnect();
                        webviewPanel.title = 'ChromaDB Viewer';
                        break;
                    case 'getInfo':
                        result = service.getInfo();
                        break;
                    case 'getStats':
                        result = await service.getStats();
                        break;
                    case 'getTables':
                        result = await service.getTables();
                        break;
                    case 'getTableSchema':
                        result = await service.getTableSchema(params.tableName);
                        break;
                    case 'getTableRows':
                        result = await service.getTableRows(params);
                        break;
                    case 'executeQuery':
                        result = await service.executeQuery(params.sql);
                        break;
                    case 'getCollections':
                        result = await service.getCollections();
                        break;
                    case 'getCollectionDocs':
                        result = await service.getCollectionDocs(params);
                        break;
                    case 'getRecent':
                        result = { databases: this.getRecent() };
                        break;
                    case 'browseDialog': {
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
                        result = service.browse(params.path);
                        break;
                    case 'exportTable': {
                        const exported = await service.exportTable({
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
                webviewPanel.webview.postMessage({ id, data: result });
            } catch (e: any) {
                webviewPanel.webview.postMessage({ id, error: e.message });
            }
        });

        // Auto-connect to the opened file
        const dbPath = document.uri.fsPath;
        setTimeout(() => {
            webviewPanel.webview.postMessage({ type: 'connectToDb', path: dbPath });
        }, 500);
    }

    private getWebviewContent(): string {
        const htmlPath = path.join(this.context.extensionPath, 'media', 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = html.replace(/\bfetch\s*\(/g, 'fetch(');
        return html;
    }

    private getRecent(): any[] {
        return this.context.globalState.get<any[]>(RECENT_KEY, []);
    }

    private addToRecent(dbPath: string) {
        let entries = this.getRecent();
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
        this.context.globalState.update(RECENT_KEY, entries);
    }
}
