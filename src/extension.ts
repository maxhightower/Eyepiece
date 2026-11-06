import * as vscode from 'vscode';
import { Workflow } from './workflow';
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
  context.subscriptions.push(output, badge,
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
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('eyepiece')) refresh(); }),
  );
  const workflow = new Workflow(vscode.Uri.joinPath(context.globalStorageUri, 'drafts'), output, async () => {
    if (settings().provider !== 'copilot') throw new Error('Choose Copilot in Eyepiece settings to enable translations. ChatGPT and Claude Code adapters are not implemented.');
    if (settings().targetLanguage !== 'python') throw new Error('EYE-1 supports Python views only. Set targetLanguage to python.');
    return CopilotProvider.select();
  });
  context.subscriptions.push(workflow);
  for (const command of ['translate', 'preview', 'apply'] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(`eyepiece.${command}`, async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) { await vscode.window.showErrorMessage('Select a Rust source or Eyepiece Python draft first.'); return; }
      try {
        return await workflow.exclusive(async () => await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Eyepiece: ${command}`, cancellable: command !== 'apply' }, async (_, token) => {
          const controller = new AbortController();
          const subscription = token.onCancellationRequested(() => controller.abort());
          try { return await workflow[command](doc, controller.signal); }
          finally { subscription.dispose(); }
        }));
      } catch (error) {
        if (!(error instanceof vscode.CancellationError) && !(error instanceof Error && error.name === 'AbortError')) {
          const message = error instanceof Error ? error.message : String(error);
          output.appendLine(message); await vscode.window.showErrorMessage(`Eyepiece: ${message}`);
        }
        return undefined;
      }
    }));
  }
  context.subscriptions.push(vscode.commands.registerCommand('eyepiece.reopenDraft', () => workflow.reopen()));
  refresh(); badge.show();
}
export function deactivate(): void { /* All resources are owned by context.subscriptions. */ }
