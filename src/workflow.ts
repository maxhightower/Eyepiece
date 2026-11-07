import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { sep } from 'node:path';
import { ModelProvider, SourceSnapshot, TranslationResult } from './providers/types';
import { TargetLanguage, targetLanguages } from './config';
import { revision, parseTranslation, applyProposal, splitTestEdits, TestEdits } from './core';
import { findManifest, runRustChecks } from './checks';
export interface Session { source: SourceSnapshot; baseline: TranslationResult; providerId: string; draft: string; targetLanguage?: string }
interface Pending { session: Session; draftText: string; candidate: string; manifest: vscode.Uri; explanation: string; tests: TestEdits; testsRequested: boolean }
export class Workflow implements vscode.Disposable {
  private readonly previews = new Map<string, string>();
  private readonly pending = new Map<string, Pending>();
  private readonly cache = new Map<string, TranslationResult>();
  private readonly registration: vscode.Disposable;
  private busy = false;
  private lastDraft: string | undefined;
  constructor(private readonly storage: vscode.Uri, private readonly output: vscode.OutputChannel,
    private readonly provider: () => Promise<ModelProvider>,
    private readonly confirm: () => Promise<boolean> = async () => await vscode.window.showWarningMessage('Apply the reviewed Rust change, save the source, then run cargo check and cargo test? Cargo can execute project build scripts and tests. Failed checks leave the change in place for review or Undo.', { modal: true }, 'Apply and check') === 'Apply and check',
    private readonly checks = runRustChecks) {
    this.registration = vscode.workspace.registerTextDocumentContentProvider('eyepiece-preview', { provideTextDocumentContent: uri => this.previews.get(uri.toString()) ?? '' });
  }
  dispose(): void { this.registration.dispose(); }
  isDraft(doc: vscode.TextDocument): boolean {
    // Compare fsPath: Uri.path keeps Windows drive-letter casing, which differs between storage and opened documents.
    return doc.uri.scheme === this.storage.scheme && doc.uri.fsPath.startsWith(this.storage.fsPath + sep) && (doc.uri.path.endsWith('.draft') || Object.values(targetLanguages).some(language => doc.uri.path.endsWith(`.${language.extension}`)));
  }
  /** Buttons can run from the sidebar or a diff, so remember the draft being worked on. */
  remember(doc: vscode.TextDocument): void { this.lastDraft = doc.uri.toString(); }
  get hasDraft(): boolean { return this.lastDraft !== undefined; }
  get hasPendingChange(): boolean { return this.lastDraft !== undefined && this.pending.has(this.lastDraft); }
  async selectedDraft(): Promise<vscode.TextDocument | undefined> {
    return this.lastDraft ? await vscode.workspace.openTextDocument(vscode.Uri.parse(this.lastDraft)) : undefined;
  }
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
    if (!this.isDraft(draft)) throw new Error('Select an Eyepiece draft first.');
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
  async translate(doc: vscode.TextDocument, signal: AbortSignal, options: { language?: string; reveal?: boolean } = {}): Promise<vscode.Uri> {
    const language = options.language ?? 'python';
    this.assertTrusted();
    if (doc.languageId !== 'rust' || doc.uri.scheme !== 'file' || doc.isDirty) throw new Error('Save the Rust file first. Eyepiece translates saved Rust files.');
    if (doc.getText().length > 100000) throw new Error('EYE-1 supports files up to 100,000 characters.');
    const source = this.snapshot(doc), provider = await this.provider();
    const key = `${provider.id}:${source.uri}:${source.revision}:${language}`;
    const baseline = this.cache.get(key) ?? parseTranslation(await provider.translate({ source, targetLanguage: language }, signal), source);
    signal.throwIfAborted();
    if (doc.isDirty || revision(doc.getText()) !== source.revision) throw new Error('Source changed during translation. Try again.');
    this.cache.set(key, baseline);
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    await vscode.workspace.fs.createDirectory(this.storage);
    // Panel drafts stay plain text: a real .go or .py document would start that language's extensions for a file nobody sees.
    const draft = vscode.Uri.joinPath(this.storage, `${randomUUID()}.${targetLanguages[language as TargetLanguage].extension}${options.reveal === false ? '.draft' : ''}`);
    await vscode.workspace.fs.writeFile(draft, Buffer.from(baseline.text));
    await this.persist({ source, baseline, providerId: provider.id, draft: draft.toString(), targetLanguage: language });
    this.lastDraft = draft.toString();
    this.showCaveats(baseline);
    if (options.reveal !== false) await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(draft), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    return draft;
  }
  private showCaveats(baseline: TranslationResult): void {
    this.output.appendLine('View caveats (AI-generated; Rust remains authoritative):');
    for (const caveat of baseline.caveats) this.output.appendLine(`• ${caveat}`);
    this.output.appendLine(`${baseline.mappings.length} source links supplied.`);
    this.output.show(true);
  }
  async preview(draft: vscode.TextDocument, signal: AbortSignal, options: { showDiff?: boolean; testsRequested?: boolean } = {}): Promise<string> {
    this.assertTrusted();
    this.pending.delete(draft.uri.toString());
    const session = await this.load(draft);
    await this.current(session);
    if (draft.getText() === session.baseline.text) throw new Error('Edit the view before requesting a source change.');
    const manifest = await findManifest(vscode.Uri.parse(session.source.uri));
    const draftText = draft.getText(), provider = await this.provider();
    const proposal = await provider.proposeEdit({ source: session.source, targetLanguage: session.targetLanguage ?? 'python', baseline: session.baseline, editedText: draftText }, signal);
    signal.throwIfAborted();
    if (proposal.unresolvedChoices.length) {
      this.output.appendLine(`Proposal blocked: ${proposal.explanation}`);
      for (const choice of proposal.unresolvedChoices) this.output.appendLine(`• ${choice}`);
      this.output.show(true);
      throw new Error(`This edit could mean different things, so nothing was changed. Clarify the view and preview again:\n${proposal.unresolvedChoices.map(choice => `• ${choice}`).join('\n')}`);
    }
    const candidate = applyProposal(session.source, proposal);
    await this.current(session);
    if (draft.getText() !== draftText) throw new Error('Draft changed while generating the proposal. Preview again.');
    const id = randomUUID();
    const before = vscode.Uri.parse(`eyepiece-preview:/${id}/before.rs`), after = vscode.Uri.parse(`eyepiece-preview:/${id}/after.rs`);
    this.previews.set(before.toString(), session.source.text); this.previews.set(after.toString(), candidate);
    if (this.previews.size > 40) { const keys = [...this.previews.keys()].slice(0,2); for (const key of keys) this.previews.delete(key); }
    this.pending.set(draft.uri.toString(), { session, draftText, candidate, manifest, explanation: proposal.explanation, tests: splitTestEdits(session.source, proposal), testsRequested: options.testsRequested === true });
    this.output.appendLine(`Proposed change: ${proposal.explanation}`); this.output.show(true);
    if (options.showDiff !== false) await vscode.commands.executeCommand('vscode.diff', before, after, 'Eyepiece: review Rust change (not applied)', { preview: true });
    return candidate;
  }
  /** The reviewed change for a draft, for showing inside the panel. */
  review(draft: vscode.TextDocument): { before: string; after: string; explanation: string; tests: TestEdits; testsRequested: boolean } | undefined {
    const pending = this.pending.get(draft.uri.toString());
    return pending && { before: pending.session.source.text, after: pending.candidate, explanation: pending.explanation, tests: pending.tests, testsRequested: pending.testsRequested };
  }
  discard(draft: vscode.TextDocument): void { this.pending.delete(draft.uri.toString()); }
  async session(draft: vscode.TextDocument): Promise<Session> { return await this.load(draft); }
  /** Rewrites the view text from a plain-language request. Rust is untouched until the normal preview and apply. */
  async revise(draft: vscode.TextDocument, changeRequest: string, signal: AbortSignal): Promise<string> {
    this.assertTrusted();
    const session = await this.load(draft);
    await this.current(session);
    const provider = await this.provider();
    const result = await provider.reviseView({ source: session.source, targetLanguage: session.targetLanguage ?? 'python', baseline: session.baseline, editedText: draft.getText(), changeRequest }, signal);
    signal.throwIfAborted();
    this.output.appendLine(`Updated view: ${result.summary}`);
    return result.text;
  }
  async apply(draft: vscode.TextDocument, signal: AbortSignal, options: { reveal?: boolean; tests?: 'allow' | 'omit' } = {}): Promise<boolean> {
    this.assertTrusted();
    const pending = this.pending.get(draft.uri.toString());
    if (!pending) throw new Error('Run Preview source change on this draft first.');
    if (draft.getText() !== pending.draftText) throw new Error('Draft changed after preview. Preview again.');
    // Passing checks mean little if the model also rewrote the tests, so that needs an explicit decision.
    if (pending.tests.touchesTests && !pending.testsRequested && !options.tests) throw new Error('This change edits tests you did not ask to change. Choose whether to allow those edits.');
    if (options.tests === 'omit' && pending.tests.withoutTests === undefined) throw new Error('This change cannot be applied without its test edits.');
    const candidate = options.tests === 'omit' ? pending.tests.withoutTests! : pending.candidate;
    await this.current(pending.session);
    if (!await this.confirm()) return false;
    signal.throwIfAborted(); this.assertTrusted();
    const source = await this.current(pending.session);
    if (draft.getText() !== pending.draftText) throw new Error('Draft changed during confirmation. Preview again.');
    // Save the draft before mutating the source. Its original contents remain recoverable.
    if (!await draft.save()) throw new Error('Could not save the draft; source was not changed.');
    await this.current(pending.session);
    if (draft.getText() !== pending.draftText) throw new Error('Draft changed while saving. Preview again.');
    const edit = new vscode.WorkspaceEdit();
    edit.replace(source.uri, new vscode.Range(source.positionAt(0), source.positionAt(source.getText().length)), candidate);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code rejected the source edit.');
    this.pending.delete(draft.uri.toString());
    if (!await source.save()) throw new Error('Source edit is unsaved. Save or Undo it before continuing.');
    this.output.show(true);
    if (!await this.checks(pending.manifest, this.output, signal)) {
      this.output.appendLine('Cargo checks FAILED. Source change retained for review/Undo; original draft preserved.');
      throw new Error('Cargo checks failed. Review Eyepiece output; Undo the Rust edit if needed. Draft preserved.');
    }
    if (source.isDirty || source.getText() !== candidate || Buffer.from(await vscode.workspace.fs.readFile(source.uri)).toString('utf8') !== candidate) throw new Error('Source changed while Cargo was running. Results do not validate the current file; draft preserved.');
    this.output.appendLine('cargo check and cargo test passed. Refreshing as a new draft; previous draft preserved.');
    try { await this.translate(source, signal, { language: pending.session.targetLanguage ?? 'python', reveal: options.reveal }); }
    catch (error) { throw new Error(`Rust applied and checks passed, but refresh failed. Original draft preserved. ${String(error)}`); }
    return true;
  }
  async reopen(options: { reveal?: boolean } = {}): Promise<vscode.TextDocument | undefined> {
    await vscode.workspace.fs.createDirectory(this.storage);
    const entries = await vscode.workspace.fs.readDirectory(this.storage);
    const choices = [];
    for (const [name] of entries.filter(([name]) => name.endsWith('.json'))) {
      try {
        const session = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.storage,name))).toString()) as Session;
        choices.push({ label: vscode.Uri.parse(session.source.uri).fsPath, description: name.slice(0,-5), uri: vscode.Uri.parse(session.draft) });
      } catch { /* damaged metadata is ignored */ }
    }
    const selected = await vscode.window.showQuickPick(choices, { title: 'Eyepiece: reopen a saved draft' });
    if (selected) {
      const doc = await vscode.workspace.openTextDocument(selected.uri);
      this.remember(doc);
      if (options.reveal !== false) await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
      return doc;
    }
    return undefined;
  }
}
