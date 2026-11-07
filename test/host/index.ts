import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as path from 'node:path';
import { ModelProvider } from '../../src/providers/types';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('maxhightower.eyepiece');
  assert.ok(extension, 'Packaged/development extension must be discoverable');
  await extension.activate();
  assert.equal(extension.isActive, true);
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['openWelcome', 'openSample', 'showStatus', 'openSettings', 'setApiKey', 'translate', 'preview', 'apply', 'reopenDraft']) {
    assert.ok(commands.includes(`eyepiece.${id}`), `Missing command: ${id}`);
  }
  const status = await vscode.commands.executeCommand<string>('eyepiece.showStatus');
  assert.match(status!, /Connection: disabled or not implemented/);
  await vscode.commands.executeCommand('eyepiece.openWelcome');
  assert.ok(vscode.window.activeTextEditor?.document.getText().includes('EYE-0'));
  const uri = await vscode.commands.executeCommand<string>('eyepiece.openSample');
  assert.ok(uri?.startsWith('untitled:'));
  const doc = vscode.window.activeTextEditor!.document;
  assert.equal(doc.languageId, 'rust');
  assert.ok(doc.getText().includes('qualifying_scores'));
  assert.equal(doc.isUntitled, true);
  const editor = vscode.window.activeTextEditor!;
  assert.ok(await editor.edit(builder => builder.insert(new vscode.Position(0, 0), '// local edit\n')));
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  await vscode.commands.executeCommand('eyepiece.openSample');
  assert.ok(!vscode.window.activeTextEditor!.document.getText().startsWith('// local edit'));
  await providerTransport();
  await firstLoop();
  if (typeof vscode.window.createWebviewPanel === 'function') await panelLoop();
  console.log('EYE-0 host checks passed: activation, commands, welcome, status, editable sample isolation');
}

async function panelLoop(): Promise<void> {
  const installed = vscode.extensions.getExtension('maxhightower.eyepiece')!;
  const { Workflow } = require(path.join(installed.extensionPath,'out/src/workflow.js')) as typeof import('../../src/workflow');
  const { EyepiecePanel } = require(path.join(installed.extensionPath,'out/src/panel.js')) as typeof import('../../src/panel');
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const source = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder,'src','lib.rs'));
  const original = source.getText(), needle = 'record.score >= minimum', edited = 'record.score != 42 && record.score >= minimum';
  await vscode.window.showTextDocument(source);
  let language = 'python', editTests = false;
  const languages: string[] = [];
  const provider: ModelProvider = {
    id:'test:panel',
    async translate(request) { languages.push(request.targetLanguage); return {text:`// ${request.targetLanguage}\nscore >= minimum\n`,sourceRevision:request.source.revision,mappings:[{sourceStart:0,sourceEnd:5,viewStart:0,viewEnd:5}],caveats:['Scripted']}; },
    async proposeEdit(request) {
      if (request.source.language==='python') { const at=request.source.text.indexOf('return x'); return {sourceRevision:request.source.revision,replacements:[{start:at,end:at+8,text:'return x + 1'}],explanation:'Add one',unresolvedChoices:[]}; }
      const start=request.source.text.indexOf(needle), assertion='vec![8, 5]', test=request.source.text.indexOf(assertion);
      return {sourceRevision:request.source.revision,replacements:[{start,end:start+needle.length,text:edited},...(editTests?[{start:test,end:test+assertion.length,text:'vec![8, 5,]'}]:[])],explanation:'Skip 42',unresolvedChoices:[]};
    },
    async reviseView(request) { return {text:request.editedText+`// ${request.changeRequest}\n`,summary:'Updated'}; },
  };
  const output = vscode.window.createOutputChannel('Eyepiece panel tests');
  const workflow = new Workflow(vscode.Uri.joinPath(folder,'.test-panel-drafts'),output,async()=>provider,async()=>true);
  const panel = new EyepiecePanel(vscode.Uri.file(installed.extensionPath),workflow,()=>language,async id=>{language=id;});
  const draftTabs = () => vscode.window.tabGroups.all.flatMap(group=>group.tabs).filter(tab=>/\.(py|go)$/.test(tab.label)).length;
  const tabsBefore = draftTabs();
  try {
    await panel.open(source);
    await Promise.race([panel.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Webview script did not load')),15000))]);
    assert.equal(panel.lastError,'');
    assert.match(panel.text!,/python/);
    assert.equal(draftTabs(),tabsBefore,'panel must not open a draft tab');
    await panel.open(source);
    assert.deepEqual(languages,['python'],'reopening the same view must not translate again');
    await panel.edit(panel.text!+'typed\n');
    await panel.preview();
    assert.equal(panel.hasReview,true);
    assert.equal(source.getText(),original,'review must not change Rust');
    await panel.edit(panel.text!+'more\n');
    assert.equal(panel.hasReview,false,'editing invalidates a reviewed change');
    await panel.ask('skip 42');
    assert.match(panel.text!,/skip 42/);
    assert.equal(panel.hasReview,true,'a request goes straight to review');
    panel.reject();
    assert.equal(panel.hasReview,false);
    await panel.preview();
    await panel.apply();
    assert.equal(panel.lastError,'');
    assert.ok(source.getText().includes(edited));
    language='go';await panel.languageChanged();
    assert.match(panel.text!,/go/);
    assert.ok(panel.draftUri!.path.endsWith('.go.draft'));
    assert.equal((await vscode.workspace.openTextDocument(panel.draftUri!)).languageId,'plaintext','hidden drafts must not start language extensions');
    assert.equal(languages.at(-1),'go');
    await panel.preview();
    assert.match(panel.lastError,/Edit the view/);
    const fresh = async (id: string) => {
      const restore=new vscode.WorkspaceEdit();restore.replace(source.uri,new vscode.Range(source.positionAt(0),source.positionAt(source.getText().length)),original);
      await vscode.workspace.applyEdit(restore);await source.save();
      language=id;await panel.languageChanged();
    };
    await fresh('english');
    assert.ok(panel.draftUri!.path.endsWith('.md.draft'));
    assert.equal(languages.at(-1),'english');
    editTests=true;
    await fresh('java');
    await panel.edit(panel.text+'typed\n');
    await panel.preview();
    assert.equal(panel.needsTestDecision,true,'unrequested test edits need a decision');
    await panel.apply();
    assert.match(panel.lastError,/did not ask/);
    assert.equal(source.getText(),original,'blocked apply must not change Rust');
    await panel.preview();
    await panel.apply('omit');
    assert.equal(panel.lastError,'');
    assert.ok(source.getText().includes(edited)&&source.getText().includes('vec![8, 5]')&&!source.getText().includes('vec![8, 5,]'),'omit keeps production edits only');
    assert.match(panel.statusText,/without the test edits/);
    await fresh('cpp');
    await panel.edit(panel.text+'typed\n');
    await panel.preview();
    await panel.apply('allow');
    assert.ok(source.getText().includes('vec![8, 5,]'));
    assert.match(panel.statusText,/you approved/);
    await fresh('javascript');
    await panel.edit(panel.text+'assert changed\n');
    await panel.preview();
    assert.equal(panel.needsTestDecision,false,'typed test edits count as intent');
    await panel.apply();
    assert.match(panel.statusText,/you asked for/);
    await fresh('typescript');
    await panel.ask('Skip 42');
    assert.equal(panel.needsTestDecision,true,'a model rewrite of the view is not user intent');
    panel.reject();
    await panel.ask('Skip 42 and update the tests');
    assert.equal(panel.needsTestDecision,false,'asking for test changes counts as intent');
    panel.reject();
    const scriptUri=vscode.Uri.joinPath(folder,'sample.py');
    await vscode.workspace.fs.writeFile(scriptUri,Buffer.from('def f(x):\n    return x\n'));
    const script=await vscode.workspace.openTextDocument(scriptUri);
    assert.equal(script.languageId,'python');
    language='rust';await panel.open(script);
    assert.ok(panel.draftUri!.path.endsWith('.rs.draft'),'any file can be viewed in any language');
    language='python';await panel.languageChanged();
    assert.ok(panel.draftUri!.path.endsWith('.md.draft'),'a file in the chosen language shows English');
    assert.match(panel.statusText,/already Python/);
    language='go';await panel.languageChanged();
    await panel.edit(panel.text+'typed\n');
    await panel.preview();
    await panel.apply();
    assert.equal(panel.lastError,'');
    assert.match(panel.statusText,/nothing verified/,'unchecked changes must say so');
    assert.ok(script.getText().includes('return x + 1'));
    await vscode.workspace.fs.delete(scriptUri);
    console.log('Panel host checks passed: webview load, no draft tab, typed edit, request box, review, reject, apply + real Cargo, language switch, test edit gate, any source language');
  } finally {
    panel.dispose();workflow.dispose();output.dispose();
    const restore=new vscode.WorkspaceEdit();restore.replace(source.uri,new vscode.Range(source.positionAt(0),source.positionAt(source.getText().length)),original);
    await vscode.workspace.applyEdit(restore);await source.save();
  }
}

async function firstLoop(): Promise<void> {
  const installed = vscode.extensions.getExtension('maxhightower.eyepiece')!.extensionPath;
  const { Workflow } = require(path.join(installed,'out/src/workflow.js')) as typeof import('../../src/workflow');
  const { runRustChecks } = require(path.join(installed,'out/src/checks.js')) as typeof import('../../src/checks');
  const folder = vscode.workspace.workspaceFolders![0]!.uri;
  const sourceUri = vscode.Uri.joinPath(folder,'src','lib.rs');
  const source = await vscode.workspace.openTextDocument(sourceUri);
  const original = source.getText();
  const storage = vscode.Uri.joinPath(folder,'.test-drafts');
  const output = vscode.window.createOutputChannel('Eyepiece integration tests');
  let translations = 0, mode = 'valid', confirmed = true, checks = 0;
  const provider: ModelProvider = {
    id:'test:scripted',
    async translate(request, signal) {
      signal.throwIfAborted(); translations++;
      return {text:'def qualifying_scores(records, minimum):\n    return [r.score for r in records if r.score >= minimum]\n',sourceRevision:request.source.revision,mappings:[],caveats:['Scripted test response; no live AI used.']};
    },
    async proposeEdit(request, signal) {
      signal.throwIfAborted();
      const needle = 'record.score >= minimum', start = request.source.text.indexOf(needle);
      return {sourceRevision:request.source.revision,replacements:[{start,end:start+needle.length,text:mode==='invalid'?'BROKEN RUST CODE':'record.score != 0 && record.score >= minimum'}],explanation:'Skip zero scores',unresolvedChoices:[]};
    },
    async reviseView(request) { return {text:request.editedText,summary:'Unused'}; }
  };
  const workflow = new Workflow(storage,output,async()=>provider,async()=>confirmed,async(m,o,s)=>{ checks++; return runRustChecks(m,o,s); });
  const signal = new AbortController().signal;
  try {
    const draftUri = await workflow.translate(source,signal);
    const draft = await vscode.workspace.openTextDocument(draftUri);
    await workflow.translate(source,signal);
    assert.equal(translations,1,'unchanged source uses cached translation');
    const editDraft = async (text:string) => {
      const e=new vscode.WorkspaceEdit();e.replace(draft.uri,new vscode.Range(draft.positionAt(0),draft.positionAt(draft.getText().length)),text);
      assert.ok(await vscode.workspace.applyEdit(e));
    };
    await editDraft(draft.getText().replace('if r.score >=','if r.score != 0 and r.score >='));
    assert.ok(await draft.save());
    assert.equal(source.getText(),original,'saving Python must not mutate Rust');
    await workflow.preview(draft,signal);
    assert.equal(source.getText(),original,'preview must not mutate Rust');
    confirmed=false;assert.equal(await workflow.apply(draft,signal),false);assert.equal(checks,0);
    confirmed=true;
    await editDraft(draft.getText()+'# changed after preview\n');
    await assert.rejects(workflow.apply(draft,signal),/Draft changed/);
    await workflow.preview(draft,signal);
    const sourceEdit=new vscode.WorkspaceEdit();sourceEdit.insert(source.uri,new vscode.Position(0,0),'// concurrent edit\n');
    assert.ok(await vscode.workspace.applyEdit(sourceEdit));
    await assert.rejects(workflow.apply(draft,signal),/Source changed/);
    const reset=new vscode.WorkspaceEdit();reset.replace(source.uri,new vscode.Range(source.positionAt(0),source.positionAt(source.getText().length)),original);
    assert.ok(await vscode.workspace.applyEdit(reset));await source.save();
    const controller=new AbortController();controller.abort(new Error('cancelled'));
    await assert.rejects(workflow.preview(draft,controller.signal),/cancelled/);
    mode='invalid';await workflow.preview(draft,signal);
    await assert.rejects(workflow.apply(draft,signal),/Checks failed/);
    assert.ok(source.getText().includes('BROKEN RUST CODE'));
    assert.ok(draft.getText().includes('r.score != 0'));
    const restore=new vscode.WorkspaceEdit();restore.replace(source.uri,new vscode.Range(source.positionAt(0),source.positionAt(source.getText().length)),original);
    assert.ok(await vscode.workspace.applyEdit(restore));await source.save();
    mode='valid';await workflow.preview(draft,signal);
    assert.equal(await workflow.apply(draft,signal),true);
    assert.ok(source.getText().includes('record.score != 0 &&'));
    assert.equal(checks,2);assert.equal(translations,2,'successful apply refreshes changed source');
    assert.ok(draft.getText().includes('r.score != 0'),'old draft preserved after refresh');
    const persisted=JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(draft.uri.toString()+'.json'))).toString());
    assert.equal(persisted.source.text,original,'saved metadata can recover the original baseline');
    console.log('EYE-1 host checks passed: cache, draft save isolation, immutable diff, declined apply, draft/source conflict, cancellation, failing Cargo, successful apply + real Cargo check/test + refresh');
  } finally { workflow.dispose();output.dispose(); }
}

async function providerTransport(): Promise<void> {
  const installed = vscode.extensions.getExtension('maxhightower.eyepiece')!.extensionPath;
  const { CopilotProvider } = require(path.join(installed,'out/src/providers/copilot.js')) as typeof import('../../src/providers/copilot');
  let mode = 'valid', tokens = 10;
  const source = {uri:'file:///source.rs',language:'rust',text:'fn main() {}',revision:'test-revision'};
  const model = {
    id:'controlled-transport',maxInputTokens:10000,
    countTokens: async()=>tokens,
    sendRequest: async()=>({ text: (async function*() {
      if (mode==='stream-error') throw new Error('stream disconnected');
      if (mode==='invalid') {yield 'not JSON';return;}
      const json=JSON.stringify({text:'def main(): pass',sourceRevision:source.revision,mappings:[],caveats:['test']});
      yield json.slice(0,20);yield json.slice(20);
    })() })
  } as unknown as vscode.LanguageModelChat;
  const provider=new CopilotProvider(model), request={source,targetLanguage:'python'};
  assert.equal((await provider.translate(request,new AbortController().signal)).text,'def main(): pass');
  mode='invalid';await assert.rejects(provider.translate(request,new AbortController().signal));
  mode='stream-error';await assert.rejects(provider.translate(request,new AbortController().signal),/stream disconnected/);
  tokens=20000;await assert.rejects(provider.translate(request,new AbortController().signal),/context limit/);
  const controller=new AbortController();controller.abort(new Error('cancelled'));
  await assert.rejects(provider.translate(request,controller.signal),/cancelled/);
  console.log('Copilot adapter transport checks passed (controlled model, no account request)');
}
