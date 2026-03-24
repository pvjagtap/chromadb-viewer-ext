import * as vscode from 'vscode';
import { ChromaDBViewerPanel } from './webviewPanel';
import { ChromaDBEditorProvider } from './editorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        ChromaDBEditorProvider.register(context),
        vscode.commands.registerCommand('chromadbViewer.open', () => {
            ChromaDBViewerPanel.createOrShow(context);
        }),
        vscode.commands.registerCommand('chromadbViewer.openFile', async () => {
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
            if (uris && uris.length > 0) {
                const panel = ChromaDBViewerPanel.createOrShow(context);
                panel.connectToDatabase(uris[0].fsPath);
            }
        }),
        vscode.commands.registerCommand('chromadbViewer.openFromExplorer', (uri: vscode.Uri) => {
            if (uri) {
                const panel = ChromaDBViewerPanel.createOrShow(context);
                panel.connectToDatabase(uri.fsPath);
            }
        })
    );
}

export function deactivate() {}
