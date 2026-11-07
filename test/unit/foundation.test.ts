import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeSettings, describeStatus, targetLanguages, languageOptions, filterLanguages, providerIds } from '../../src/config';
import { UnavailableProvider } from '../../src/providers/unavailable';
import type { TranslationRequest } from '../../src/providers/types';
const request: TranslationRequest = { source: { uri: 'file:///sample.rs', text: 'fn main() {}', language: 'rust', revision: 'fixture' }, targetLanguage: 'python' };
test('invalid persisted settings fall back to safe defaults', () => {
  assert.deepEqual(normalizeSettings('unknown', '../bad'), {provider: 'none', targetLanguage: 'python'});
  assert.deepEqual(normalizeSettings('copilot', ' Python '), {provider: 'copilot', targetLanguage: 'python'});
});
test('selecting a provider never falsely reports a connection', () => {
  assert.match(describeStatus(normalizeSettings('chatgpt', 'python')), /Connection: disabled or not implemented/);
});
test('unimplemented providers fail explicitly for both operations', async () => {
  const provider = new UnavailableProvider('copilot');
  await assert.rejects(provider.translate(request, new AbortController().signal), /No request was sent/);
  await assert.rejects(provider.proposeEdit({...request, baseline: {text: '', sourceRevision: 'fixture', mappings: [], caveats: []}, editedText: ''}, new AbortController().signal), /No source was changed/);
});
test('cancellation is preserved through the provider boundary', async () => {
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  await assert.rejects(new UnavailableProvider('none').translate(request, controller.signal), /cancelled/);
});
test('UI buttons are declared and sit left of neighbouring editor title buttons', () => {
  const root = path.resolve(__dirname, '../../..');
  const { contributes } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commands = new Set(contributes.commands.map((c: { command: string }) => c.command));
  const title = contributes.menus['editor/title'] as Array<{ command: string; group: string }>;
  assert.deepEqual(title.map(item => item.command), ['eyepiece.translate']);
  for (const item of title) { assert.ok(commands.has(item.command)); assert.equal(item.group, 'navigation@-1'); }
  const sidebar = fs.readFileSync(path.join(root, 'webview/sidebar.ts'), 'utf8');
  for (const [, id] of sidebar.matchAll(/'(eyepiece\.[\w]+)'/g)) assert.ok(commands.has(id), id);
  assert.equal(contributes.views.eyepiece[0].type, 'webview');
  assert.ok(fs.existsSync(path.join(root, contributes.viewsContainers.activitybar[0].icon)));
  assert.match(fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8'), /!media/);
  assert.deepEqual(contributes.configuration.properties['eyepiece.targetLanguage'].enum, Object.keys(targetLanguages));
  assert.deepEqual(contributes.configuration.properties['eyepiece.provider'].enum, [...providerIds]);
});
test('language search matches labels and ids, ignoring case', () => {
  const found = (query: string) => filterLanguages(languageOptions(), query).map(option => option.id);
  assert.equal(found('').length, Object.keys(targetLanguages).length);
  assert.deepEqual(found('TYPE'), ['typescript']);
  assert.deepEqual(found('c#'), ['csharp']);
  assert.deepEqual(found('script'), ['typescript', 'javascript']);
  assert.deepEqual(found('zzz'), []);
});
