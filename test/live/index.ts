import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CopilotProvider } from '../../src/providers/copilot';
import { ModelProvider } from '../../src/providers/types';
import { Workflow } from '../../src/workflow';
import { EyepiecePanel } from '../../src/panel';

/** Live acceptance: real Copilot, real VS Code, real Cargo, on a temporary fixture copy. Spends Copilot quota. */
const preferred = ['gpt-5-mini', 'gpt-4.1', 'gpt-4o'];
export async function run(storage: vscode.Uri, marker: string): Promise<void> {
  const uiOnly = marker.startsWith('ui:'), wanted = marker.replace(/^ui:/, '');
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const log = (step: string, detail: unknown = '') => fs.appendFileSync(path.join(folder.fsPath, 'live-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), step, detail }) + '\n');
  const output = vscode.window.createOutputChannel('Eyepiece live acceptance');
  const original = output.appendLine.bind(output);
  output.appendLine = (value: string) => { log('output', value); original(value); };
  let workflow: Workflow | undefined;
  try {
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    log('models', models.map(m => ({ id: m.id, family: m.family, max: m.maxInputTokens })));
    if (!models.length) throw new Error('No Copilot models visible to this extension');
    const model = models.find(m => m.id === wanted || m.family === wanted) ?? preferred.map(f => models.find(m => m.family === f)).find(Boolean) ?? models[0]!;
    log('model', model.id);
    if (uiOnly) {
      // Opens the real panel and sidebar, then holds them open for hands-on UI checks until live.continue appears.
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'src', 'lib.rs')));
      await vscode.commands.executeCommand('workbench.view.extension.eyepiece');
      const opening = vscode.commands.executeCommand('eyepiece.translate');
      await new Promise(resolve => setTimeout(resolve, 3000));
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      await opening;
      log('ui-ready');
      const deadline = Date.now() + 240000;
      while (Date.now() < deadline && !fs.existsSync(path.join(folder.fsPath, 'live.continue'))) await new Promise(resolve => setTimeout(resolve, 500));
      log('done');
      return;
    }
    const copilot = new CopilotProvider(model);
    const provider: ModelProvider = { id: copilot.id, translate: (request, signal) => copilot.translate(request, signal), async proposeEdit(request, signal) {
      const proposal = await copilot.proposeEdit(request, signal);
      log('proposal', { ...proposal, replaced: proposal.replacements.map(r => request.source.text.slice(r.start, r.end)) });
      return proposal;
    }, reviseView: (request, signal) => copilot.reviseView(request, signal) };
    workflow = new Workflow(storage, output, async () => provider, async () => true);
    const signal = new AbortController().signal;
    const source = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'src', 'lib.rs'));
    const baseline = source.getText();
    await vscode.window.showTextDocument(source);
    await vscode.commands.executeCommand('workbench.view.extension.eyepiece');
    log('ui-ready');
    await new Promise(resolve => setTimeout(resolve, 8000));
    const edit = async (draft: vscode.TextDocument, pattern: RegExp, replacement: string) => {
      const next = draft.getText().replace(pattern, replacement);
      if (next === draft.getText()) throw new Error(`Python draft did not match ${pattern}:\n${draft.getText()}`);
      const change = new vscode.WorkspaceEdit();
      change.replace(draft.uri, new vscode.Range(draft.positionAt(0), draft.positionAt(draft.getText().length)), next);
      if (!await vscode.workspace.applyEdit(change) || !await draft.save()) throw new Error('Could not save draft');
    };
    const scenario = async (name: string, pattern: RegExp, replacement: string) => {
      log(`${name}:translate`);
      const draft = await vscode.workspace.openTextDocument(await workflow!.translate(source, signal));
      log(`${name}:draft`, draft.getText());
      await edit(draft, pattern, replacement);
      log(`${name}:preview`);
      const candidate = await workflow!.preview(draft, signal);
      log(`${name}:candidate`, candidate);
      try { log(`${name}:applied`, await workflow!.apply(draft, signal)); }
      catch (error) { log(`${name}:apply-error`, String(error)); }
      log(`${name}:source`, source.getText());
    };
    await scenario('zero', /(\w+)(\.score|\["score"\]|\['score'\]) >= minimum/, '$1$2 != 0 and $1$2 >= minimum');
    const reset = async () => {
      const change = new vscode.WorkspaceEdit();
      change.replace(source.uri, new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), baseline);
      if (!await vscode.workspace.applyEdit(change) || !await source.save()) throw new Error('Could not restore source');
    };
    await reset();
    await scenario('active', /if (\w+)(\.score|\["score"\]|\['score'\]) >= minimum/, 'if $1.active and $1$2 >= minimum');
    await reset();
    // Real panel, through the installed commands. Apply stops at its modal there, so Apply runs on a second panel below.
    const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.window.showTextDocument(source);
    const opening = vscode.commands.executeCommand('eyepiece.translate');
    await pause(3000);
    await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
    await opening;
    log('ui-ready');
    await pause(6000);
    await vscode.workspace.getConfiguration('eyepiece').update('targetLanguage', 'go', vscode.ConfigurationTarget.Workspace);
    await pause(30000);
    log('ui-go');
    await pause(6000);
    await vscode.workspace.getConfiguration('eyepiece').update('targetLanguage', 'python', vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.window.showTextDocument(source);
    workflow.dispose();
    workflow = new Workflow(storage, output, async () => provider, async () => true);
    const extensionPath = vscode.extensions.getExtension('maxhightower.eyepiece')!.extensionPath;
    const panel = new EyepiecePanel(vscode.Uri.file(extensionPath), workflow, () => 'python', async () => undefined);
    await panel.open(source);
    await panel.ready;
    log('panel:links', panel.linkCount);
    await panel.ask('Skip scores of zero');
    log('panel:review', { hasReview: panel.hasReview, error: panel.lastError, draft: panel.text });
    log('ui-review');
    await pause(6000);
    await panel.apply();
    log('panel:applied', { error: panel.lastError, rust: source.getText().split(/\r?\n/).filter(line => line.includes('.filter(')) });
    log('ui-applied');
    await pause(6000);
    panel.dispose();
    await reset();
    log('done');
  } catch (error) {
    log('failed', error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error));
  } finally { workflow?.dispose(); output.dispose(); log('exit'); }
}
