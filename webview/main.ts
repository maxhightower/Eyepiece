import { basicSetup } from 'codemirror';
import { Compartment, Extension, StateEffect, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { cpp } from '@codemirror/lang-cpp';
import { markdown } from '@codemirror/lang-markdown';
import { rust } from '@codemirror/lang-rust';
import { languagePicker } from './picker';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
interface DiffLine { kind: ' ' | '+' | '-' | '…'; text: string }
interface Block { from: number; to: number }
interface State { blocks: Block[]; models: Array<{ id: string; label: string }>; model: string; status: string; error: string; busy: boolean; cancellable: boolean; language: string; languages: Array<{ id: string; label: string }>; hasDraft: boolean; review?: { diff: DiffLine[]; explanation: string; tests?: { diff: DiffLine[]; blocked: boolean; canOmit: boolean } }; notes: string[]; log: string; text?: string }

const grammar = (id: string): Extension => ({ english: markdown(), rust: rust(), c: cpp(), python: python(), typescript: javascript({ typescript: true }), javascript: javascript(), go: go(), java: java(), csharp: cpp(), cpp: cpp() } as Record<string, Extension>)[id] ?? [];
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const button = (label: string, className: string, onClick: () => void) => { const node = element('button', className, label); node.addEventListener('click', onClick); return node; };

const app = document.getElementById('app')!;
const toolbar = element('header', 'toolbar');
const picker = languagePicker(id => { flush(); vscode.postMessage({ type: 'language', id }); });
const languageLabel = element('span', 'language-label', 'Language');
const previewButton = button('Preview Source Change', 'quiet', () => { flush(); vscode.postMessage({ type: 'preview' }); });
const draftsButton = button('Drafts', 'secondary', () => { flush(); vscode.postMessage({ type: 'drafts' }); });
toolbar.append(languageLabel, picker.root, element('span', 'grow'), draftsButton, previewButton);
const banner = element('div', 'banner');
const bannerText = element('span');
const cancelButton = button('Cancel', 'secondary', () => vscode.postMessage({ type: 'cancel' }));
banner.append(bannerText, cancelButton);
const editorHost = element('main', 'editor');
const review = element('section', 'review');
const reviewTitle = element('h2', '', 'Proposed source change');
const explanation = element('p', 'explanation');
const diff = element('pre', 'diff');
const reviewActions = element('div', 'actions');
const applyButton = button('Apply and Run Checks', 'primary', () => vscode.postMessage({ type: 'apply' }));
const omitButton = button('Apply Without Test Changes', 'primary', () => vscode.postMessage({ type: 'apply', tests: 'omit' }));
const allowButton = button('Allow Test Changes', 'secondary', () => vscode.postMessage({ type: 'apply', tests: 'allow' }));
reviewActions.append(applyButton, omitButton, allowButton, button('Reject', 'secondary', () => vscode.postMessage({ type: 'reject' })));
const testWarning = element('div', 'test-warning');
const testWarningText = element('p');
const testDiff = element('pre', 'diff test-diff');
testWarning.append(testWarningText, testDiff);
review.append(reviewTitle, testWarning, explanation, diff, reviewActions);
const details = element('details', 'details');
const detailsSummary = element('summary', '', 'Notes and check output');
const notes = element('ul');
const log = element('pre', 'log');
details.append(detailsSummary, notes, log);
const composer = element('form', 'composer');
const input = element('textarea');
input.rows = 2; input.placeholder = 'Describe a change, for example: skip zero scores';
const send = element('button', 'primary', 'Send');
composer.append(input, send);
const modelPicker = languagePicker(id => vscode.postMessage({ type: 'model', id }), { title: 'Model', search: 'Search models', empty: 'No matching models', unset: 'Default model', up: true });
const footer = element('div', 'footer-row');
footer.append(details, modelPicker.root);
app.append(toolbar, banner, editorHost, review, footer, composer);

const syntax = new Compartment();
// The block matching the other side, shown as a full-width highlight on each of its lines.
const setLinked = StateEffect.define<Block | null>();
const linkedLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setLinked)) {
      const { doc } = transaction.state;
      if (!effect.value) { value = Decoration.none; continue; }
      const first = doc.lineAt(Math.min(effect.value.from, doc.length)).number, last = doc.lineAt(Math.min(effect.value.to, doc.length)).number;
      value = Decoration.set(Array.from({ length: last - first + 1 }, (_, index) => Decoration.line({ class: 'cm-linked' }).range(doc.line(first + index).from)));
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
// A click or the source cursor pins a block. Hovering shows another one until the mouse leaves.
let blocks: Block[] = [], linked: number | null = null, pinned: number | null = null;
const blockAt = (offset: number | null) => { const index = offset === null ? -1 : blocks.findIndex(block => block.from <= offset && offset <= block.to); return index < 0 ? null : index; };
const showLinked = (index: number | null, scroll: boolean) => {
  linked = index;
  const block = index === null ? null : blocks[index] ?? null;
  view.dispatch({ effects: scroll && block ? [setLinked.of(block), EditorView.scrollIntoView(block.from, { y: 'center' })] : [setLinked.of(block)] });
};
const pointTo = (index: number | null, scroll: boolean) => {
  if (index === linked && !scroll) return;
  showLinked(index, false);
  vscode.postMessage({ type: 'link', index, scroll });
};
const remote = Transaction.remote;
let timer: ReturnType<typeof setTimeout> | undefined;
const flush = () => { if (timer) { clearTimeout(timer); timer = undefined; vscode.postMessage({ type: 'edit', text: view.state.doc.toString() }); } };
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syntax-comment)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--syntax-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName))], color: 'var(--syntax-function)' },
  { tag: tags.heading, color: 'var(--syntax-type)', fontWeight: 'bold' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.monospace, color: 'var(--syntax-function)' },
]);
const view = new EditorView({
  parent: editorHost,
  extensions: [basicSetup, syntax.of([]), syntaxHighlighting(highlight), linkedLines, EditorView.lineWrapping,
    EditorView.theme({
      '&': { height: '100%', color: 'var(--vscode-editor-foreground)', backgroundColor: 'var(--vscode-editor-background)' },
      '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', fontSize: 'var(--vscode-editor-font-size)' },
      '.cm-gutters': { backgroundColor: 'var(--vscode-editor-background)', color: 'var(--vscode-editorLineNumber-foreground)', border: 'none' },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--vscode-editor-selectionBackground)' },
      '.cm-cursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
    }, { dark: document.body.classList.contains('vscode-dark') }),
    EditorView.updateListener.of(update => {
      if (!update.docChanged || update.transactions.every(item => item.annotation(remote))) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 300);
    }),
    EditorView.domEventHandlers({
      click: (_event, editor) => { pinned = blockAt(editor.state.selection.main.head); pointTo(pinned, true); return false; },
      mousemove: (event, editor) => { pointTo(blockAt(editor.posAtCoords({ x: event.clientX, y: event.clientY })) ?? pinned, false); return false; },
      mouseleave: () => { pointTo(pinned, false); return false; },
    }),
  ],
});
const setText = (text: string) => { if (timer) { clearTimeout(timer); timer = undefined; } view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: remote.of(true) }); };

let current = '';
let blocked = true;
const updateSend = () => { send.disabled = blocked || !input.value.trim(); };
const render = (state: State) => {
  if (state.text !== undefined) { setText(state.text); pinned = null; showLinked(null, false); }
  blocks = state.blocks;
  if (state.language !== current) { current = state.language; view.dispatch({ effects: syntax.reconfigure(grammar(current)) }); }
  picker.update(state.languages, state.language, state.busy);
  blocked = state.busy || !state.hasDraft;
  previewButton.disabled = blocked; draftsButton.disabled = state.busy; input.disabled = blocked;
  updateSend();
  view.dom.classList.toggle('busy', state.busy);
  modelPicker.update(state.models, state.model, state.busy);
  modelPicker.root.hidden = !state.models.length;
  banner.className = 'banner' + (state.error ? ' error' : state.busy ? ' working' : '');
  bannerText.textContent = state.error || state.status;
  banner.hidden = !state.error && !state.status;
  cancelButton.hidden = !state.cancellable;
  review.hidden = !state.review;
  for (const node of reviewActions.querySelectorAll('button')) node.disabled = state.busy;
  if (state.review) {
    explanation.textContent = state.review.explanation;
    const lines = (items: DiffLine[]) => items.map(line => element('div', { '+': 'add', '-': 'del', ' ': 'same', '…': 'gap' }[line.kind], `${line.kind} ${line.text}`));
    diff.replaceChildren(...lines(state.review.diff));
    const tests = state.review.tests;
    testWarning.hidden = !tests;
    applyButton.hidden = !!tests?.blocked;
    allowButton.hidden = !tests?.blocked;
    omitButton.hidden = !tests?.blocked || !tests.canOmit;
    if (tests) {
      testWarning.classList.toggle('blocked', tests.blocked);
      testWarningText.textContent = tests.blocked
        ? `The model also changed these tests, and you did not ask it to. Passing checks would prove less. ${tests.canOmit ? 'Apply without them to see whether the tests still pass.' : 'These edits cannot be separated from the rest of the change.'}`
        : 'This change includes the test edits you asked for.';
      testDiff.replaceChildren(...lines(tests.diff));
    }
  }
  notes.replaceChildren(...state.notes.map(note => element('li', '', note)));
  log.textContent = state.log;
};
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'state') render(message);
  if (message.type === 'log') { log.textContent = message.text; log.scrollTop = log.scrollHeight; }
  if (message.type === 'focus') { pinned = message.index; showLinked(message.index, message.scroll); }
});
input.addEventListener('input', updateSend);
const submit = () => { const request = input.value.trim(); if (!request || send.disabled) return; flush(); vscode.postMessage({ type: 'ask', request }); input.value = ''; updateSend(); };
composer.addEventListener('submit', event => { event.preventDefault(); submit(); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } });
review.hidden = true; banner.hidden = true; updateSend();
vscode.postMessage({ type: 'ready' });
