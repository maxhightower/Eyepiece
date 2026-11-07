import { basicSetup } from 'codemirror';
import { Compartment, EditorSelection, Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { go } from '@codemirror/lang-go';
import { cpp } from '@codemirror/lang-cpp';
import { languagePicker } from './picker';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
interface DiffLine { kind: ' ' | '+' | '-' | '…'; text: string }
interface State { status: string; error: string; busy: boolean; cancellable: boolean; language: string; languages: Array<{ id: string; label: string }>; hasDraft: boolean; review?: { diff: DiffLine[]; explanation: string }; notes: string[]; log: string; text?: string }

const grammar = (id: string): Extension => ({ python: python(), typescript: javascript({ typescript: true }), javascript: javascript(), go: go(), java: java(), csharp: cpp(), cpp: cpp() } as Record<string, Extension>)[id] ?? [];
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const button = (label: string, className: string, onClick: () => void) => { const node = element('button', className, label); node.addEventListener('click', onClick); return node; };

const app = document.getElementById('app')!;
const toolbar = element('header', 'toolbar');
const picker = languagePicker(id => { flush(); vscode.postMessage({ type: 'language', id }); });
const languageLabel = element('span', 'language-label', 'Language');
const previewButton = button('Preview Rust Change', 'primary', () => { flush(); vscode.postMessage({ type: 'preview' }); });
const draftsButton = button('Drafts', 'secondary', () => { flush(); vscode.postMessage({ type: 'drafts' }); });
toolbar.append(languageLabel, picker.root, element('span', 'grow'), draftsButton, previewButton);
const banner = element('div', 'banner');
const bannerText = element('span');
const cancelButton = button('Cancel', 'secondary', () => vscode.postMessage({ type: 'cancel' }));
banner.append(bannerText, cancelButton);
const editorHost = element('main', 'editor');
const review = element('section', 'review');
const reviewTitle = element('h2', '', 'Proposed Rust change');
const explanation = element('p', 'explanation');
const diff = element('pre', 'diff');
const reviewActions = element('div', 'actions');
reviewActions.append(button('Apply and Run Checks', 'primary', () => vscode.postMessage({ type: 'apply' })), button('Reject', 'secondary', () => vscode.postMessage({ type: 'reject' })));
review.append(reviewTitle, explanation, diff, reviewActions);
const details = element('details', 'details');
const detailsSummary = element('summary', '', 'Notes and Cargo output');
const notes = element('ul');
const log = element('pre', 'log');
details.append(detailsSummary, notes, log);
const composer = element('form', 'composer');
const input = element('textarea');
input.rows = 2; input.placeholder = 'Describe a change, for example: skip zero scores';
const send = element('button', 'primary', 'Send');
composer.append(input, send);
app.append(toolbar, banner, editorHost, review, details, composer);

const syntax = new Compartment();
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
]);
const view = new EditorView({
  parent: editorHost,
  extensions: [basicSetup, syntax.of([]), syntaxHighlighting(highlight), EditorView.lineWrapping,
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
    EditorView.domEventHandlers({ click: (_event, editor) => { vscode.postMessage({ type: 'jump', offset: editor.state.selection.main.head }); return false; } }),
  ],
});
const setText = (text: string) => { if (timer) { clearTimeout(timer); timer = undefined; } view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: remote.of(true) }); };

let current = '';
let blocked = true;
const updateSend = () => { send.disabled = blocked || !input.value.trim(); };
const render = (state: State) => {
  if (state.text !== undefined) setText(state.text);
  if (state.language !== current) { current = state.language; view.dispatch({ effects: syntax.reconfigure(grammar(current)) }); }
  picker.update(state.languages, state.language, state.busy);
  blocked = state.busy || !state.hasDraft;
  previewButton.disabled = blocked; draftsButton.disabled = state.busy; input.disabled = blocked;
  updateSend();
  view.dom.classList.toggle('busy', state.busy);
  banner.className = 'banner' + (state.error ? ' error' : state.busy ? ' working' : '');
  bannerText.textContent = state.error || state.status;
  banner.hidden = !state.error && !state.status;
  cancelButton.hidden = !state.cancellable;
  review.hidden = !state.review;
  for (const node of reviewActions.querySelectorAll('button')) node.disabled = state.busy;
  if (state.review) {
    explanation.textContent = state.review.explanation;
    diff.replaceChildren(...state.review.diff.map(line => element('div', { '+': 'add', '-': 'del', ' ': 'same', '…': 'gap' }[line.kind], `${line.kind} ${line.text}`)));
  }
  notes.replaceChildren(...state.notes.map(note => element('li', '', note)));
  log.textContent = state.log;
};
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'state') render(message);
  if (message.type === 'log') { log.textContent = message.text; log.scrollTop = log.scrollHeight; }
  if (message.type === 'highlight') view.dispatch({ selection: EditorSelection.range(message.from, message.to), effects: EditorView.scrollIntoView(message.from, { y: 'center' }) });
});
input.addEventListener('input', updateSend);
const submit = () => { const request = input.value.trim(); if (!request || send.disabled) return; flush(); vscode.postMessage({ type: 'ask', request }); input.value = ''; updateSend(); };
composer.addEventListener('submit', event => { event.preventDefault(); submit(); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } });
review.hidden = true; banner.hidden = true; updateSend();
vscode.postMessage({ type: 'ready' });
