import * as vscode from 'vscode';
import { Workflow } from './workflow';
import { EyepiecePanel } from './panel';
import { EyepieceSidebar } from './sidebar';
import { CopilotProvider } from './providers/copilot';
import { describeStatus, normalizeSettings } from './config';
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Eyepiece');
  const badge = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10);
  const settings = () => {
    const config = vscode.workspace.getConfiguration('eyepiece');
    return normalizeSettings(config.get('provider'), config.get('targetLanguage'));
  };
  const refresh = () => {
    badge.text = '$(eye) Eyepiece';
    badge.tooltip = describeStatus(settings());
    badge.command = 'eyepiece.showStatus';
  };
  const setLanguage = async (id: string) => { await vscode.workspace.getConfiguration('eyepiece').update('targetLanguage', id, vscode.ConfigurationTarget.Global); };
  // Workflow and Cargo output also streams into the panel, which replaces the output tab as the place to look.
  const channel = new Proxy(output, { get(target, key: keyof vscode.OutputChannel) {
    if (key === 'append' || key === 'appendLine') return (value: string) => { target[key](value); panel.log(key === 'append' ? value : value + '\n'); };
    if (key === 'show') return () => undefined;
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const workflow = new Workflow(vscode.Uri.joinPath(context.globalStorageUri, 'drafts'), channel, async () => {
    if (settings().provider !== 'copilot') throw new Error('Click Enable Copilot in the Eyepiece sidebar first. ChatGPT and Claude Code adapters are not implemented.');
    return CopilotProvider.select();
  });
  const updateButtons = () => {
    sidebar.update();
  };
  const panel: EyepiecePanel = new EyepiecePanel(context.extensionUri, workflow, () => settings().targetLanguage, setLanguage, updateButtons);
  const sidebar: EyepieceSidebar = new EyepieceSidebar(context.extensionUri, () => ({ enabled: settings().provider === 'copilot', language: settings().targetLanguage, panelOpen: panel.isOpen, previewReady: panel.hasReview && !panel.needsTestDecision }), setLanguage);
  const isRust = (doc: vscode.TextDocument) => doc.languageId === 'rust' && doc.uri.scheme === 'file';
  context.subscriptions.push(output, badge, workflow, panel,
    vscode.window.registerWebviewViewProvider('eyepiece.actions', sidebar),
    vscode.commands.registerCommand('eyepiece.openWelcome', async () => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(context.extensionUri, 'docs', 'welcome.md'));
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('eyepiece.openSample', async () => {
      // Copy into an untitled buffer, so editing cannot modify packaged resources.
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'fixtures', 'rust', 'src', 'lib.rs'));
      const doc = await vscode.workspace.openTextDocument({ language: 'rust', content: Buffer.from(bytes).toString('utf8') });
      await vscode.window.showTextDocument(doc, { preview: false });
      return doc.uri.toString();
    }),
    vscode.commands.registerCommand('eyepiece.showStatus', () => {
      const status = describeStatus(settings());
      output.clear(); output.appendLine(status); output.show(true);
      return status;
    }),
    vscode.commands.registerCommand('eyepiece.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:maxhightower.eyepiece')),
    vscode.commands.registerCommand('eyepiece.enableCopilot', () => vscode.workspace.getConfiguration('eyepiece').update('provider', 'copilot', vscode.ConfigurationTarget.Global)),
    vscode.commands.registerCommand('eyepiece.translate', async () => {
      const active = vscode.window.activeTextEditor?.document;
      const doc = active && isRust(active) ? active : vscode.window.visibleTextEditors.map(editor => editor.document).find(isRust);
      if (!doc) { await vscode.window.showErrorMessage('Open a Rust file first.'); return; }
      await panel.open(doc);
    }),
    vscode.commands.registerCommand('eyepiece.preview', () => panel.preview()),
    vscode.commands.registerCommand('eyepiece.apply', () => panel.apply()),
    vscode.commands.registerCommand('eyepiece.reopenDraft', () => panel.openDrafts()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('eyepiece')) return;
      refresh(); sidebar.update();
      if (event.affectsConfiguration('eyepiece.targetLanguage')) void panel.languageChanged();
    }),
  );
  refresh(); updateButtons(); badge.show();
}
export function deactivate(): void { /* All resources are owned by context.subscriptions. */ }
