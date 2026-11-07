import { languagePicker } from './picker';
import { LanguageOption } from '../src/config';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
interface State { enabled: boolean; language: string; languages: LanguageOption[]; panelOpen: boolean; previewReady: boolean }

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; };
const command = (label: string, id: string, kind = 'primary') => { const node = element('button', kind, label); node.addEventListener('click', () => vscode.postMessage({ type: 'command', id })); return node; };
const section = (text: string, ...children: HTMLElement[]) => { const node = element('section', 'sidebar-section'); if (text) node.append(element('p', '', text)); node.append(...children); return node; };

const picker = languagePicker(id => vscode.postMessage({ type: 'language', id }));
const label = element('label', 'sidebar-label', 'Language');
const enable = section('Eyepiece uses your GitHub Copilot account. Nothing is sent until you click a button.', command('Enable Copilot', 'eyepiece.enableCopilot'));
const language = section('', label, picker.root);
const open = section('Open a file, then open Eyepiece beside it.', command('Open Eyepiece', 'eyepiece.translate'), command('Reopen Saved Draft', 'eyepiece.reopenDraft', 'secondary'));
const preview = section('Edit the view or send a request in the panel, then review the matching source change. The source is not changed yet.', command('Preview Source Change', 'eyepiece.preview'));
const apply = section('Write the reviewed change to the source file, then run the project checks.', command('Apply and Run Checks', 'eyepiece.apply'));
const settings = section('', command('Settings', 'eyepiece.openSettings', 'secondary'));
document.getElementById('app')!.append(enable, language, open, preview, apply, settings);

window.addEventListener('message', event => {
  const state = event.data as State;
  enable.hidden = state.enabled;
  language.hidden = open.hidden = !state.enabled;
  preview.hidden = !state.enabled || !state.panelOpen;
  apply.hidden = !state.enabled || !state.previewReady;
  picker.update(state.languages, state.language, false);
});
vscode.postMessage({ type: 'ready' });
