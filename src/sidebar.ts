import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { languageOptions } from './config';

interface SidebarState { enabled: boolean; language: string; panelOpen: boolean; previewReady: boolean }
type Inbound = { type: 'ready' } | { type: 'command'; id: string } | { type: 'language'; id: string };
const allowed = new Set(['eyepiece.enableCopilot', 'eyepiece.translate', 'eyepiece.reopenDraft', 'eyepiece.preview', 'eyepiece.apply', 'eyepiece.openSettings']);

/** Sidebar view. It holds the language dropdown, which VS Code's built-in view buttons cannot show. */
export class EyepieceSidebar implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  constructor(private readonly extensionUri: vscode.Uri, private readonly state: () => SidebarState, private readonly setLanguage: (id: string) => Thenable<void>) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = randomBytes(16).toString('hex'), csp = view.webview.cspSource;
    const asset = (name: string) => view.webview.asWebviewUri(vscode.Uri.joinPath(media, name));
    view.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('panel.css')}"><title>Eyepiece</title></head><body class="sidebar"><div id="app"></div><script nonce="${nonce}" src="${asset('sidebar.js')}"></script></body></html>`;
    view.webview.onDidReceiveMessage(async (message: Inbound) => {
      if (message.type === 'ready') this.update();
      if (message.type === 'language') await this.setLanguage(message.id);
      if (message.type === 'command' && allowed.has(message.id)) await vscode.commands.executeCommand(message.id);
    });
    view.onDidDispose(() => { this.view = undefined; });
    this.view = view;
  }
  update(): void { void this.view?.webview.postMessage({ ...this.state(), languages: languageOptions() }); }
}
