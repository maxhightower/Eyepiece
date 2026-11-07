import { languagePicker } from './picker';
import { LanguageOption } from '../src/config';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
interface State { provider: string; providers: LanguageOption[]; language: string; languages: LanguageOption[]; panelOpen: boolean; previewReady: boolean }

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const command = (label: string, id: string, kind = 'primary') => { const node = element('button', kind, label); node.addEventListener('click', () => vscode.postMessage({ type: 'command', id })); return node; };
const section = (text: string, ...children: HTMLElement[]) => { const node = element('section', 'sidebar-section'); if (text) node.append(element('p', '', text)); node.append(...children); return node; };

const picker = languagePicker(id => vscode.postMessage({ type: 'language', id }));
const label = element('label', 'sidebar-label', 'Language');
const providerPicker = languagePicker(id => vscode.postMessage({ type: 'provider', id }), { title: 'AI provider', search: 'Search providers', empty: 'No matching providers', unset: 'Choose a provider' });
const providerNote = element('p', 'sidebar-note');
const keyButton = command('Change API Key', 'eyepiece.setApiKey', 'secondary');
const modelButton = command('Change Model', 'eyepiece.chooseModel', 'secondary');
const provider = section('', element('label', 'sidebar-label', 'AI provider'), providerPicker.root, providerNote, keyButton, modelButton);
const notes: Record<string, string> = {
  none: 'Your code is sent to the provider you choose, only when you click a button.',
  copilot: 'Uses your GitHub Copilot account in VS Code.',
  anthropic: 'Uses your Anthropic API key. Usage is billed by Anthropic.',
  openai: 'Uses your OpenAI API key. Usage is billed by OpenAI.',
  codex: 'Uses your installed Codex and its ChatGPT sign-in.',
  claudeCode: 'Personal use only. Uses your local Claude Code sign-in.',
};
const language = section('', label, picker.root);
const open = section('Open a file, then open Eyepiece beside it.', command('Open Eyepiece', 'eyepiece.translate'), command('Reopen Saved Draft', 'eyepiece.reopenDraft', 'secondary'));
const preview = section('Edit the view or send a request in the panel, then review the matching source change. The source is not changed yet.', command('Preview Source Change', 'eyepiece.preview'));
const apply = section('Write the reviewed change to the source file, then run the project checks.', command('Apply and Run Checks', 'eyepiece.apply'));
const settings = section('', command('Settings', 'eyepiece.openSettings', 'secondary'));
document.getElementById('app')!.append(provider, language, open, preview, apply, settings);

window.addEventListener('message', event => {
  const state = event.data as State;
  const enabled = state.provider !== 'none', usesKey = state.provider === 'anthropic' || state.provider === 'openai';
  providerPicker.update(state.providers, state.provider, false);
  providerNote.textContent = notes[state.provider] ?? '';
  keyButton.hidden = !usesKey;
  modelButton.hidden = !usesKey && state.provider !== 'copilot';
  open.hidden = !enabled;
  preview.hidden = !enabled || !state.panelOpen;
  apply.hidden = !enabled || !state.previewReady;
  picker.update(state.languages, state.language, false);
});
vscode.postMessage({ type: 'ready' });
