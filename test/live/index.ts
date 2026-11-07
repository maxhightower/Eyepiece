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
  const uiOnly = marker.startsWith('ui:'), wanted = marker.replace(/^(ui|explain|any):/, '');
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const log = (step: string, detail: unknown = '') => fs.appendFileSync(path.join(folder.fsPath, 'live-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), step, detail }) + '\n');
  const output = vscode.window.createOutputChannel('Eyepiece live acceptance');
  const original = output.appendLine.bind(output);
  output.appendLine = (value: string) => { log('output', value); original(value); };
  let workflow: Workflow | undefined;
  try {
    if (marker === 'empty') {
      // Shows the sidebar with no file open, then with one, for hands-on checks.
      const wait = (name: string) => new Promise<void>(resolve => { const timer = setInterval(() => { if (fs.existsSync(path.join(folder.fsPath, name))) { clearInterval(timer); resolve(); } }, 300); });
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.commands.executeCommand('workbench.view.extension.eyepiece');
      log('ui-empty');
      await wait('live.step');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'src', 'lib.rs')));
      log('ui-file');
      await wait('live.continue');
      log('done');
      return;
    }
    if (marker === 'gate') {
      // Shows the test edit warning with a scripted proposal, for hands-on checks without spending quota.
      const assertion = 'vec![8, 5]', needle = 'record.score >= minimum';
      const scripted: ModelProvider = { id: 'test:gate',
        async translate(request) { return { text: `# scripted view\nscore >= minimum\n`, sourceRevision: request.source.revision, mappings: [], caveats: [] }; },
        async proposeEdit(request) {
          const at = request.source.text.indexOf(needle), test = request.source.text.indexOf(assertion);
          return { sourceRevision: request.source.revision, replacements: [{ start: at, end: at + needle.length, text: `record.score != 42 && ${needle}` }, { start: test, end: test + assertion.length, text: 'vec![8]' }], explanation: 'Skip 42 and change a test.', unresolvedChoices: [] };
        },
        async reviseView(request) { return { text: request.editedText, summary: 'Unused' }; } };
      workflow = new Workflow(storage, output, async () => scripted, async () => true);
      const gate = new EyepiecePanel(vscode.Uri.file(vscode.extensions.getExtension('maxhightower.eyepiece')!.extensionPath), workflow, () => 'python', async () => undefined);
      const rust = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'src', 'lib.rs'));
      await vscode.window.showTextDocument(rust);
      await gate.open(rust);
      await gate.ready;
      await gate.edit(gate.text + 'typed\n');
      await gate.preview();
      log('ui-tests', gate.needsTestDecision);
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline && !fs.existsSync(path.join(folder.fsPath, 'live.continue'))) await new Promise(resolve => setTimeout(resolve, 500));
      log('gate:result', { status: gate.statusText, error: gate.lastError, rust: rust.getText().split(/\r?\n/).filter(line => line.includes('.filter(') || line.includes('vec![8') ) });
      gate.dispose();
      log('done');
      return;
    }
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
    if (marker.startsWith('any:')) {
      // JavaScript source with real npm tests, viewed as Python, changed by request, then viewed as Rust.
      const write = (name: string, text: string) => fs.writeFileSync(path.join(folder.fsPath, name), text);
      write('package.json', JSON.stringify({ name: 'scores', scripts: { test: 'node --test' } }));
      write('scores.js', "function qualifying(scores, minimum) {\n  return scores.filter(score => score >= minimum);\n}\nmodule.exports = { qualifying };\n");
      write('scores.test.js', "const test = require('node:test');\nconst assert = require('node:assert');\nconst { qualifying } = require('./scores');\ntest('keeps the boundary', () => assert.deepEqual(qualifying([8, 5, 4], 5), [8, 5]));\n");
      let target = 'python';
      workflow = new Workflow(storage, output, async () => provider, async () => true);
      const any = new EyepiecePanel(vscode.Uri.file(vscode.extensions.getExtension('maxhightower.eyepiece')!.extensionPath), workflow, () => target, async () => undefined);
      const js = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'scores.js'));
      await vscode.window.showTextDocument(js);
      await any.open(js);
      await any.ready;
      log('any:python', { error: any.lastError, links: any.linkCount, text: any.text });
      await any.ask('Skip scores of zero');
      log('any:review', { hasReview: any.hasReview, decision: any.needsTestDecision, error: any.lastError });
      log('ui-any');
      await new Promise(resolve => setTimeout(resolve, 6000));
      await any.apply(any.needsTestDecision ? 'omit' : undefined);
      log('any:applied', { status: any.statusText, error: any.lastError, js: js.getText() });
      target = 'rust'; await any.languageChanged();
      log('any:rust', { error: any.lastError, text: any.text });
      log('ui-any-rust');
      await new Promise(resolve => setTimeout(resolve, 5000));
      any.dispose();
      log('done');
      return;
    }
    if (marker.startsWith('explain:')) {
      workflow = new Workflow(storage, output, async () => provider, async () => true);
      const explained = new EyepiecePanel(vscode.Uri.file(vscode.extensions.getExtension('maxhightower.eyepiece')!.extensionPath), workflow, () => 'english', async () => undefined);
      const rust = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'src', 'lib.rs'));
      await vscode.window.showTextDocument(rust);
      await explained.open(rust);
      await explained.ready;
      log('english:view', { links: explained.linkCount, error: explained.lastError, text: explained.text });
      log('ui-english');
      await new Promise(resolve => setTimeout(resolve, 7000));
      const typed = explained.text!.replace(/(#+[^\n]*qualifying_scores[^\n]*\n)/, '$1\nScores of exactly zero are always left out of the result, whatever the minimum is.\n');
      log('english:edited', typed !== explained.text);
      await explained.edit(typed);
      await explained.preview();
      log('english:review', { hasReview: explained.hasReview, needsDecision: explained.needsTestDecision, status: explained.statusText, error: explained.lastError });
      log('ui-english-review');
      await new Promise(resolve => setTimeout(resolve, 7000));
      await explained.apply(explained.needsTestDecision ? 'omit' : undefined);
      log('english:applied', { status: explained.statusText, error: explained.lastError, rust: rust.getText().split(/\r?\n/).filter(line => line.includes('.filter(')) });
      explained.dispose();
      log('done');
      return;
    }
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
    const original = panel.text!;
    await panel.edit(original.replace(/(\w+)\.score >= minimum/, '$1.active and $1.score >= minimum'));
    await panel.preview();
    log('panel:gate', { needsDecision: panel.needsTestDecision, status: panel.statusText, error: panel.lastError });
    log('ui-tests');
    await pause(8000);
    panel.reject();
    await panel.edit(original);
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
