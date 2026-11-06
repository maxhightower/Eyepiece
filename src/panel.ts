import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Workflow } from './workflow';
import { asksForTestChange, DiffLine, editsTestCode, LinkBlock, lineDiff, linkBlocks } from './core';
import { TranslationResult } from './providers/types';
import { LanguageOption, languageOptions, targetLanguages } from './config';

interface Review { diff: DiffLine[]; explanation: string; tests?: { diff: DiffLine[]; blocked: boolean; canOmit: boolean } }
type Inbound =
  | { type: 'ready' } | { type: 'cancel' } | { type: 'preview' } | { type: 'apply'; tests?: 'allow' | 'omit' } | { type: 'reject' } | { type: 'drafts' }
  | { type: 'edit'; text: string } | { type: 'ask'; request: string } | { type: 'language'; id: string } | { type: 'model'; id: string } | { type: 'link'; index: number | null; scroll: boolean };

/** The Eyepiece app panel. All safety checks stay in Workflow; this class only drives it and renders state. */
export class EyepiecePanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private draft: vscode.TextDocument | undefined;
  private baseline: TranslationResult | undefined;
  private sourceUri: vscode.Uri | undefined;
  private draftLanguage: string | undefined;
  private review: Review | undefined;
  private sourceText = '';
  private blocks: LinkBlock[] = [];
  private linkDecoration: vscode.TextEditorDecorationType | undefined;
  activeLink: number | null = null;
  /** Intent only comes from the user: their typing or their request, never a model rewrite of the view. */
  private testsRequested = false;
  private controller: AbortController | undefined;
  private status = ''; private error = ''; private busy = false; private cancellable = false;
  private log_ = '';
  private queue: Promise<void> = Promise.resolve();
  private markReady: () => void = () => undefined;
  /** Resolves when the webview script has loaded and its editor is mounted. */
  ready: Promise<void> = new Promise(resolve => { this.markReady = resolve; });
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri, private readonly workflow: Workflow,
    private readonly language: () => string, private readonly setLanguage: (id: string) => Thenable<void>,
    private readonly onChange: () => void = () => undefined,
    private readonly modelChoice: () => { models: LanguageOption[]; model: string } = () => ({ models: [], model: '' }), private readonly setModel: (id: string) => void = () => undefined) {
    this.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => this.followSource(event)));
  }
  dispose(): void { this.controller?.abort(); this.panel?.dispose(); this.linkDecoration?.dispose(); for (const item of this.subscriptions) item.dispose(); }
  get isOpen(): boolean { return this.panel !== undefined; }
  get hasReview(): boolean { return this.review !== undefined; }
  get text(): string | undefined { return this.draft?.getText(); }
  get lastError(): string { return this.error; }
  get statusText(): string { return this.status; }
  get needsTestDecision(): boolean { return this.review?.tests?.blocked === true; }
  get draftUri(): vscode.Uri | undefined { return this.draft?.uri; }
  get linkCount(): number { return this.blocks.length; }

  private ensure(): vscode.WebviewPanel {
    if (this.panel) return this.panel;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('eyepiece.panel', 'Eyepiece', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media] });
    panel.iconPath = { light: vscode.Uri.joinPath(media, 'eyepiece-light.svg'), dark: vscode.Uri.joinPath(media, 'eyepiece-dark.svg') };
    const nonce = randomBytes(16).toString('hex'), csp = panel.webview.cspSource;
    const asset = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, name));
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp}; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${asset('panel.css')}"><title>Eyepiece</title></head><body><div id="app"></div><script nonce="${nonce}" src="${asset('panel.js')}"></script></body></html>`;
    panel.webview.onDidReceiveMessage((message: Inbound) => {
      if (message.type === 'cancel') { this.controller?.abort(); return; }
      // Highlighting stays live while a request runs, so it skips the queue.
      if (message.type === 'link') { void this.linkTo(message.index, message.scroll); return; }
      this.queue = this.queue.then(() => this.receive(message)).catch(error => this.fail(error));
    });
    panel.onDidDispose(() => {
      this.controller?.abort(); this.panel = undefined; this.draft = undefined; this.sourceUri = undefined; this.review = undefined;
      this.ready = new Promise(resolve => { this.markReady = resolve; });
      this.onChange();
    });
    this.panel = panel; this.onChange();
    return panel;
  }
  private async receive(message: Inbound): Promise<void> {
    switch (message.type) {
      case 'ready': this.markReady(); this.publish(true); break;
      case 'edit': await this.edit(message.text); break;
      case 'ask': await this.ask(message.request); break;
      case 'preview': await this.preview(); break;
      case 'apply': await this.apply(message.tests); break;
      case 'reject': this.reject(); break;
      case 'drafts': await this.openDrafts(); break;
      case 'language': if (message.id !== this.language()) await this.setLanguage(message.id); break;
      case 'model': this.setModel(message.id); break;
    }
  }
  private publish(withText = false): void {
    this.refreshBlocks();
    void this.panel?.webview.postMessage({ type: 'state', status: this.status, error: this.error, busy: this.busy, cancellable: this.cancellable,
      language: this.draftLanguage ?? this.language(), languages: languageOptions(),
      ...this.modelChoice(), blocks: this.blocks.map(block => block.view), hasDraft: !!this.draft, review: this.review, notes: this.baseline?.caveats ?? [], log: this.log_, text: withText ? this.draft?.getText() ?? '' : undefined });
    this.onChange();
  }
  refresh(): void { this.publish(); }
  log(text: string): void {
    this.log_ = (this.log_ + text).slice(-20000);
    void this.panel?.webview.postMessage({ type: 'log', text: this.log_ });
  }
  private fail(error: unknown): void {
    if (error instanceof vscode.CancellationError || (error instanceof Error && error.name === 'AbortError')) this.error = '';
    else this.error = error instanceof Error ? error.message : String(error);
    this.publish();
  }
  private async run(status: string, cancellable: boolean, operation: (signal: AbortSignal) => Promise<string>): Promise<void> {
    if (this.busy) return;
    const controller = new AbortController();
    this.controller = controller; this.busy = true; this.cancellable = cancellable; this.status = status; this.error = '';
    this.publish();
    try { this.status = await this.workflow.exclusive(() => operation(controller.signal)); }
    catch (error) { this.status = ''; this.fail(error); }
    finally {
      if (!this.workflow.hasPendingChange) this.review = undefined;
      this.controller = undefined; this.busy = false; this.cancellable = false;
      this.publish();
    }
  }
  private async load(draft: vscode.TextDocument): Promise<void> {
    const session = await this.workflow.session(draft);
    this.draft = draft; this.baseline = session.baseline; this.sourceText = session.source.text; this.review = undefined; this.testsRequested = false;
    this.sourceUri = vscode.Uri.parse(session.source.uri); this.draftLanguage = session.targetLanguage ?? 'python';
    this.workflow.remember(draft);
    const name = this.sourceUri.path.split('/').pop();
    if (this.panel) this.panel.title = `Eyepiece: ${name}`;
    this.publish(true);
  }
  private label(id = this.language()): string { return targetLanguages[id as keyof typeof targetLanguages]?.label ?? id; }
  /** A file cannot be translated into its own language, so that choice shows the English explanation. */
  private effectiveLanguage(source: vscode.TextDocument): string { return source.languageId === this.language() ? 'english' : this.language(); }
  private async translate(source: vscode.TextDocument): Promise<void> {
    const language = this.effectiveLanguage(source);
    this.sourceUri = source.uri;
    await this.run(`Translating to ${this.label(language)}…`, true, async signal => {
      const uri = await this.workflow.translate(source, signal, { language, reveal: false });
      await this.load(await vscode.workspace.openTextDocument(uri));
      return language === this.language() ? '' : `This file is already ${this.label()}, so here is the English explanation.`;
    });
  }
  /** Eye button: reveal the panel beside the file, translating unless this view is already current. */
  async open(source: vscode.TextDocument): Promise<void> {
    const existing = this.panel;
    this.ensure();
    if (existing) existing.reveal(existing.viewColumn, false);
    if (this.draft && this.sourceUri?.toString() === source.uri.toString() && this.draftLanguage === this.effectiveLanguage(source)) return;
    await this.translate(source);
  }
  async languageChanged(): Promise<void> {
    this.publish();
    if (!this.panel || !this.sourceUri) return;
    const source = await vscode.workspace.openTextDocument(this.sourceUri);
    if (this.draftLanguage === this.effectiveLanguage(source)) {
      if (this.language() !== this.draftLanguage) { this.status = `This file is already ${this.label()}, so here is the English explanation.`; this.publish(); }
      return;
    }
    await this.translate(source);
  }
  private async writeDraft(text: string): Promise<void> {
    const draft = this.draft;
    if (!draft || draft.getText() === text) return;
    const change = new vscode.WorkspaceEdit();
    change.replace(draft.uri, new vscode.Range(draft.positionAt(0), draft.positionAt(draft.getText().length)), text);
    if (!await vscode.workspace.applyEdit(change) || !await draft.save()) throw new Error('Could not save the draft.');
  }
  /** Direct typing in the panel editor. Any edit invalidates a reviewed proposal. */
  async edit(text: string): Promise<void> {
    if (!this.draft || this.draft.getText() === text) return;
    if (editsTestCode(this.draft.getText(), text)) this.testsRequested = true;
    await this.writeDraft(text);
    this.workflow.discard(this.draft);
    this.review = undefined; this.publish();
  }
  private async propose(signal: AbortSignal): Promise<string> {
    const draft = this.draft!;
    await this.workflow.preview(draft, signal, { showDiff: false, testsRequested: this.testsRequested });
    const review = this.workflow.review(draft)!;
    const blocked = review.tests.touchesTests && !review.testsRequested;
    this.review = { diff: lineDiff(review.before, review.after), explanation: review.explanation,
      ...(review.tests.touchesTests ? { tests: { diff: lineDiff(review.before, review.tests.testsOnly, 0), blocked, canOmit: review.tests.withoutTests !== undefined } } : {}) };
    return blocked ? 'This change also edits tests you did not ask to change.' : 'Review the change below. Nothing has been applied.';
  }
  async preview(): Promise<void> {
    if (!this.draft) return;
    await this.run('Working out the source change…', true, signal => this.propose(signal));
  }
  /** Request box: the model revises the view, then the normal review flow takes over. */
  async ask(request: string): Promise<void> {
    if (!this.draft || !request.trim()) return;
    if (asksForTestChange(request)) this.testsRequested = true;
    await this.run('Working on your request…', true, async signal => {
      const text = await this.workflow.revise(this.draft!, request.trim(), signal);
      await this.writeDraft(text);
      this.workflow.discard(this.draft!);
      this.publish(true);
      this.status = 'Working out the source change…'; this.publish();
      return await this.propose(signal);
    });
  }
  async apply(tests?: 'allow' | 'omit'): Promise<void> {
    if (!this.draft || !this.review) return;
    this.log_ = '';
    const touched = this.review.tests !== undefined;
    await this.run('Applying and running checks…', false, async signal => {
      if (!await this.workflow.apply(this.draft!, signal, { reveal: false, ...(tests ? { tests } : {}) })) return '';
      await this.load((await this.workflow.selectedDraft())!);
      const checks = this.workflow.checksRan ? 'Checks passed' : 'No checks are set up for this file, so nothing verified this change';
      if (tests === 'omit') return `Applied without the test edits. ${checks}.`;
      if (tests === 'allow') return `Applied with test changes you approved. ${checks}.`;
      return touched ? `Applied with the test changes you asked for. ${checks}.` : `Applied. ${checks}.`;
    });
  }
  reject(): void {
    if (this.draft) this.workflow.discard(this.draft);
    this.review = undefined; this.status = ''; this.publish();
  }
  async openDrafts(): Promise<void> {
    this.ensure();
    await this.run('', false, async () => {
      const draft = await this.workflow.reopen({ reveal: false });
      if (draft) await this.load(draft);
      return '';
    });
  }
  private get sourceDocument(): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(doc => doc.uri.toString() === this.sourceUri?.toString());
  }
  /** Blocks only hold while the source still matches what was translated. */
  private refreshBlocks(): void {
    const source = this.sourceDocument;
    this.blocks = this.baseline && this.draft && (!source || source.getText() === this.sourceText) ? linkBlocks(this.baseline.mappings, this.baseline.text, this.draft.getText(), this.sourceText) : [];
  }
  private markSource(block: LinkBlock | undefined): vscode.Range | undefined {
    const source = this.sourceDocument;
    const range = block && source && new vscode.Range(source.positionAt(block.source.from), source.positionAt(block.source.to));
    this.linkDecoration ??= vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'), overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'), overviewRulerLane: vscode.OverviewRulerLane.Center });
    for (const editor of vscode.window.visibleTextEditors) if (editor.document === source) editor.setDecorations(this.linkDecoration, range ? [range] : []);
    return range;
  }
  /** Hovering highlights the matching block. Clicking also scrolls the source to it. */
  async linkTo(index: number | null, scroll = false): Promise<void> {
    const block = index === null ? undefined : this.blocks[index];
    this.activeLink = block ? index : null;
    if (block && scroll && this.sourceUri && !vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === this.sourceUri!.toString())) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(this.sourceUri), { viewColumn: vscode.ViewColumn.One, preserveFocus: true });
    }
    const range = this.markSource(block);
    if (range && scroll) for (const editor of vscode.window.visibleTextEditors) if (editor.document === this.sourceDocument) editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }
  private followSource(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.panel || event.textEditor.document.uri.toString() !== this.sourceUri?.toString()) return;
    this.refreshBlocks();
    const offset = event.textEditor.document.offsetAt(event.selections[0]!.active);
    const index = this.blocks.findIndex(block => block.source.from <= offset && offset <= block.source.to);
    this.activeLink = index < 0 ? null : index;
    this.markSource(this.blocks[index]);
    void this.panel.webview.postMessage({ type: 'focus', index: this.activeLink, scroll: true });
  }
}
