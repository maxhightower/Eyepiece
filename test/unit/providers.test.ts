import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { AnthropicProvider, listClaudeModels } from '../../src/providers/anthropic';
import { OpenAIProvider, listOpenAIModels } from '../../src/providers/openai';
import { CliCommand, CliProvider, claudeCommand, codexCommand } from '../../src/providers/cli';
import { parseModelJson, revision } from '../../src/core';

const text = 'fn main() {}';
const source = { uri: 'file:///a.rs', language: 'rust', text, revision: revision(text) };
const reply = JSON.stringify({ text: 'def main(): pass', sourceRevision: source.revision, links: [{ source: 'fn main()', view: 'def main()' }], caveats: [] });
const signal = () => new AbortController().signal;
async function serve(handler: (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void, run: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer((request, response) => {
    let body = ''; request.on('data', data => { body += data; }); request.on('end', () => handler(request, body, response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { server.closeAllConnections(); server.close(); }
}
const sse = (response: http.ServerResponse, stopReason: string, content: string) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (data: Record<string, unknown>) => response.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`);
  send({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  send({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  send({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } });
  send({ type: 'content_block_stop', index: 0 });
  send({ type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } });
  send({ type: 'message_stop' });
  response.end();
};
test('model JSON may be fenced but must still be JSON', () => {
  assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```\n'), { a: 1 });
  assert.throws(() => parseModelJson('Here you go: {"a":1}'));
});
test('Anthropic adapter sends the key and default fallbacks, and reads streamed text', async () => {
  const seen: { key?: string; beta?: string; body?: Record<string, unknown> } = {};
  await serve((request, body, response) => {
    seen.key = request.headers.authorization as string; seen.beta = request.headers['anthropic-beta'] as string; seen.body = JSON.parse(body);
    sse(response, 'end_turn', reply);
  }, async url => {
    const result = await new AnthropicProvider('key-1', 'claude-opus-5-5', url).translate({ source, targetLanguage: 'python' }, signal());
    assert.equal(result.text, 'def main(): pass');
    assert.equal(result.mappings.length, 1);
  });
  assert.equal(seen.key, 'Bearer key-1');
  assert.match(seen.beta!, /server-side-fallback-2026-07-01/);
  assert.equal(seen.body!.fallbacks, 'default');
  assert.equal(seen.body!.model, 'claude-opus-5-5');
});
test('Anthropic adapter reports refusals, truncation, and bad keys clearly', async () => {
  let stop = 'refusal';
  await serve((_request, _body, response) => {
    if (stop === 'auth') { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad' } })); return; }
    sse(response, stop, reply);
  }, async url => {
    const run = () => new AnthropicProvider('k', 'claude-haiku-5-5', url).translate({ source, targetLanguage: 'python' }, signal());
    await assert.rejects(run(), /declined/);
    stop = 'max_tokens'; await assert.rejects(run(), /output space/);
    stop = 'auth'; await assert.rejects(run(), /rejected the API key/);
  });
});
test('Claude model list puts the default first', async () => {
  await serve((_request, _body, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ type: 'model', id: 'claude-haiku-5-5' }, { type: 'model', id: 'claude-opus-5-5' }], has_more: false, first_id: null, last_id: null }));
  }, async url => assert.deepEqual(await listClaudeModels('k', url), ['claude-opus-5-5', 'claude-haiku-5-5']));
});
test('OpenAI adapter reads response text and reports bad keys', async () => {
  let auth = false;
  await serve((request, body, response) => {
    if (auth) { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: 'bad' } })); return; }
    assert.equal(request.headers.authorization, 'Bearer key-2');
    assert.equal(JSON.parse(body).model, 'gpt-x');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 'r', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] }] }));
  }, async url => {
    const run = () => new OpenAIProvider('key-2', 'gpt-x', url).translate({ source, targetLanguage: 'python' }, signal());
    assert.equal((await run()).text, 'def main(): pass');
    auth = true; await assert.rejects(run(), /rejected the API key/);
  });
});
test('OpenAI model list keeps text models, newest first', async () => {
  await serve((_request, _body, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-old', created: 1 }, { id: 'gpt-new', created: 2 }, { id: 'gpt-audio', created: 3 }, { id: 'whisper-1', created: 4 }] }));
  }, async url => assert.deepEqual(await listOpenAIModels('k', url), ['gpt-new', 'gpt-old']));
});
const fake = (script: string, parse: CliCommand['parse'] = stdout => stdout): CliCommand => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eyepiece-fake-')), 'fake.js');
  fs.writeFileSync(file, script);
  return { id: 'fake', label: 'Fake', command: process.execPath, args: [file], shell: false, missing: 'Fake is not installed.', parse };
};
test('CLI adapter sends the prompt on stdin from an empty folder and parses stdout', async () => {
  const script = `let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{const fs=require('fs');if(fs.readdirSync(process.cwd()).length||!input.includes('fn main'))process.exit(3);console.log(${JSON.stringify(reply)});});`;
  assert.equal((await new CliProvider(fake(script)).translate({ source, targetLanguage: 'python' }, signal())).text, 'def main(): pass');
});
test('CLI adapter reports failures, missing programs, and cancellation', async () => {
  await assert.rejects(new CliProvider(fake(`console.error('signed out');process.exit(2)`)).translate({ source, targetLanguage: 'python' }, signal()), /Fake failed \(exit 2\)\. signed out/);
  await assert.rejects(new CliProvider({ ...fake(''), command: 'eyepiece-no-such-program' }, 500).translate({ source, targetLanguage: 'python' }, signal()), /not installed/);
  const controller = new AbortController();
  const running = new CliProvider(fake('setTimeout(()=>{},60000)')).translate({ source, targetLanguage: 'python' }, controller.signal);
  setTimeout(() => controller.abort(), 200);
  await assert.rejects(running, (error: Error) => error.name === 'AbortError');
});
test('local agents run locked down', () => {
  const claude = claudeCommand('claude').args;
  assert.equal(claude[claude.indexOf('--tools') + 1], '', 'Claude Code tools are off');
  assert.ok(claude.includes('--strict-mcp-config') && claude.includes('--no-session-persistence'));
  assert.equal(claudeCommand('claude').parse(JSON.stringify({ result: 'x' })), 'x');
  assert.throws(() => claudeCommand('claude').parse(JSON.stringify({ is_error: true, result: 'Not logged in' })), /Not logged in/);
  const codex = codexCommand().args;
  assert.equal(codex[codex.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(codex.includes('--ephemeral') && codex.includes('--ignore-user-config'));
  assert.ok(!codex.some(arg => /danger|full-auto|yolo/.test(arg)));
});
