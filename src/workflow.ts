import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { ModelProvider, SourceSnapshot, TranslationResult } from './providers/types';
import { revision, parseTranslation, applyProposal } from './core';
import { findManifest, runRustChecks } from './checks';
interface Session { source: SourceSnapshot; baseline: TranslationResult; providerId: string; draft: string }
interface Pending { session: Session; draftText: string; candidate: string; manifest: vscode.Uri }
export class Workflow implements vscode.Disposable {
  private readonly previews = new Map<string, string>();
  private readonly pending = new Map<string, Pending>();
  private readonly cache = new Map<string, TranslationResult>();
  private readonly registration: vscode.Disposable;
  private busy = false;
  constructor(private readonly storage: vscode.Uri, private readonly output: vscode.OutputChannel,
    private readonly provider: () => Promise<ModelProvider>,
    private readonly confirm: () => Promise<boolean> = async () => await vscode.window.showWarningMessage('Apply the reviewed Rust change, save the source, then run cargo check and cargo test? Cargo can execute project build scripts and tests. Failed checks leave the change in place for review or Undo.', { modal: true }, 'Apply and check') === 'Apply and check',
    private readonly checks = runRustChecks) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider('eyepiece-preview', { provideTextDocumentContent: uri => this.previews.get(uri.toString()) ?? '' });
  }
  dispose(): void { this.registration.dispose(); }
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Another Eyepiece operation is running.');
    this.busy = true; try { return await operation(); } finally { this.busy = false; }
  }
  private assertTrusted(): void { if (!vscode.workspace.isTrusted) throw new Error('Eyepiece requires a trusted workspace for model requests and source edits.'); }
  private snapshot(doc: vscode.TextDocument): SourceSnapshot { return { uri: doc.uri.toString(), language: doc.languageId, text: doc.getText(), revision: revision(doc.getText()) }; }
  private async persist(session: Session): Promise<void> {
    await vscode.workspace.fs.writeFile(vscode.Uri.parse(session.draft + '.json'), Buffer.from(JSON.stringify(session)));
  }
  private async load(draft: vscode.TextDocument): Promise<Session> {
    if (draft.uri.scheme !== this.storage.scheme || !draft.uri.path.startsWith(this.storage.path + '/')) throw new Error('Select an Eyepiece Python draft first.');
    const session = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.parse(draft.uri.toString()+'.json'))).toString()) as Session;
    if (session.draft !== draft.uri.toString() || revision(session.source.text) !== session.source.revision) throw new Error('Draft metadata is invalid.');
    session.baseline = parseTranslation(session.baseline, session.source);
    return session;
  }
  private async current(session: Session): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(session.source.uri));
    if (doc.isDirty || revision(doc.getText()) !== session.source.revision) throw new Error('Source changed or has unsaved edits. Open a fresh translation; this draft has been preserved.');
    const disk = Buffer.from(await vscode.workspace.fs.readFile(doc.uri)).toString('utf8');
    if (revision(disk) !== session.source.revision) throw new Error('Source changed on disk. Reopen a fresh translation.');
    return doc;
  }
  async translate(doc: vscode.TextDocument, signal: AbortSignal): Promise<vscode.Uri> {
    this.assertTrusted();
    if (doc.languageId !== 'rust' || doc.uri.scheme !== 'file' || doc.isDirty) throw new Error('Open a saved Rust file with no unsaved edits. EYE-1 supports Rust → Python.');
    if (doc.getText().length > 100000) throw new Error('EYE-1 supports files up to 100,000 characters.');
    const source = this.snapshot(doc), provider = await this.provider();
    const key = `${provider.id}:${source.uri}:${source.revision}:python`;
    const baseline = this.cache.get(key) ?? parseTranslation(await provider.translate({ source, targetLanguage: 'python' }, signal), source);
    signal.throwIfAborted();
    if (doc.isDirty || revision(doc.getText()) !== source.revision) throw new Error('Source changed during translation. Try again.');
    this.cache.set(key, baseline);
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    await vscode.workspace.fs.createDirectory(this.storage);
    const draft = vscode.Uri.joinPath(this.storage, `${randomUUID()}.py`);
    await vscode.workspace.fs.writeFile(draft, Buffer.from(baseline.text));
    await this.persist({ source, baseline, providerId: provider.id, draft: draft.toString() });
    this.showCaveats(baseline);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(draft), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    return draft;
  }
  private showCaveats(baseline: TranslationResult): void {
    this.output.appendLine('Python view caveats (AI-generated; Rust remains authoritative):');
    for (const caveat of baseline.caveats) this.output.appendLine(`• ${caveat}`);
    this.output.appendLine(`${baseline.mappings.length} source mappings supplied; navigation is not yet implemented.`);
    this.output.show(true);
  }
  async preview(draft: vscode.TextDocument, signal: AbortSignal): Promise<string> {
    this.assertTrusted();
    this.pending.delete(draft.uri.toString());
    const session = await this.load(draft);
    await this.current(session);
    if (draft.getText() === session.baseline.text) throw new Error('Edit the Python draft before requesting a source change.');
    const manifest = await findManifest(vscode.Uri.parse(session.source.uri));
    const draftText = draft.getText(), provider = await this.provider();
    const proposal = await provider.proposeEdit({ source: session.source, targetLanguage: 'python', baseline: session.baseline, editedText: draftText }, signal);
    signal.throwIfAborted();
    const candidate = applyProposal(session.source, proposal);
    await this.current(session);
    if (draft.getText() !== draftText) throw new Error('Draft changed while generating the proposal. Preview again.');
    const id = randomUUID();
    const before = vscode.Uri.parse(`eyepiece-preview:/${id}/before.rs`), after = vscode.Uri.parse(`eyepiece-preview:/${id}/after.rs`);
    this.previews.set(before.toString(), session.source.text); this.previews.set(after.toString(), candidate);
    if (this.previews.size > 40) { const keys = [...this.previews.keys()].slice(0,2); for (const key of keys) this.previews.delete(key); }
    this.pending.set(draft.uri.toString(), { session, draftText, candidate, manifest });
    this.output.appendLine(`Proposed change: ${proposal.explanation}`); this.output.show(true);
    await vscode.commands.executeCommand('vscode.diff', before, after, 'Eyepiece: review Rust change (not applied)', { preview: true });
    return candidate;
  }
  async apply(draft: vscode.TextDocument, signal: AbortSignal): Promise<boolean> {
    this.assertTrusted();
    const pending = this.pending.get(draft.uri.toString());
    if (!pending) throw new Error('Run Preview source change on this draft first.');
    if (draft.getText() !== pending.draftText) throw new Error('Draft changed after preview. Preview again.');
    await this.current(pending.session);
    if (!await this.confirm()) return false;
    signal.throwIfAborted(); this.assertTrusted();
    const source = await this.current(pending.session);
    if (draft.getText() !== pending.draftText) throw new Error('Draft changed during confirmation. Preview again.');
    // Save the draft before mutating the source. Its original contents remain recoverable.
    if (!await draft.save()) throw new Error('Could not save Python draft; source was not changed.');
    await this.current(pending.session);
    if (draft.getText() !== pending.draftText) throw new Error('Draft changed while saving. Preview again.');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(source.uri, new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), pending.candidate);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rejected the source edit.');
    this.pending.delete(draft.uri.toString());
    if (!await source.save()) throw new Error('Source edit is unsaved. Save or Undo it before continuing.');
    this.output.show(true);
    if (!await this.checks(pending.manifest, this.output, signal)) {
      this.output.appendLine('Cargo checks FAILED. Source change retained for review/Undo; original Python draft preserved.');
      throw new Error('Cargo checks failed. Review Eyepiece output; Undo the Rust edit if needed. Draft preserved.');
    }
    if (source.isDirty || source.getText() !== pending.candidate || Buffer.from(await vscode.workspace.fs.readFile(source.uri)).toString('utf8') !== pending.candidate) throw new Error('Source changed while Cargo was running. Results do not validate the current file; draft preserved.');
    this.output.appendLine('cargo check and cargo test passed. Refreshing as a new Python draft; previous draft preserved.');
    try { await this.translate(source, signal); }
    catch (error) { throw new Error(`Rust applied and checks passed, but refresh failed. Original draft preserved. ${String(error)}`); }
    return true;
  }
  async reopen(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.storage);
    const entries = await vscode.workspace.fs.readDirectory(this.storage);
    const choices = [];
    for (const [name] of entries.filter(([name]) => name.endsWith('.py.json'))) {
      try {
        const session = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.storage,name))).toString()) as Session;
        choices.push({ label: vscode.Uri.parse(session.source.uri).fsPath, description: name.slice(0,-5), uri: vscode.Uri.parse(session.draft) });
      } catch { /* damaged metadata is ignored */ }
    }
    const selected = await vscode.window.showQuickPick(choices, { title: 'Eyepiece: reopen a saved Python draft' });
    if (selected) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(selected.uri), { preview: false });
  }
}
