import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, describeStatus } from '../../src/config';
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
