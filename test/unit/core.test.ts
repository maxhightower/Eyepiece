import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksForTestChange, editsTestCode, rustTestRanges, splitTestEdits, lineDiff, locateLinks, locateReplacements, parseRevision, revision, parseTranslation, parseProposal, applyProposal } from '../../src/core';
const source = { uri: 'file:///sample.rs', language: 'rust', text: 'abc😀xyz', revision: revision('abc😀xyz') };
const proposal = (replacements: unknown[]) => ({sourceRevision:source.revision, replacements, explanation:'change', unresolvedChoices:[]});
test('valid edits use UTF-16 offsets and apply in source order', () => {
  assert.equal(applyProposal(source, parseProposal(proposal([{start:5,end:8,text:'z'},{start:0,end:1,text:'A'}]),source)), 'Abc😀z');
});
test('malformed, stale, overlapping, reversed and surrogate-splitting edits are rejected', () => {
  for (const replacements of [[{start:-1,end:1,text:''}], [{start:1.2,end:2,text:''}], [{start:0,end:99,text:''}], [{start:3,end:2,text:''}], [{start:0,end:3,text:''},{start:2,end:4,text:''}], [{start:2,end:2,text:'a'},{start:2,end:2,text:'b'}], [{start:4,end:5,text:''}], [{start:0,end:0,text:7}]]) {
    assert.throws(() => parseProposal(proposal(replacements),source));
  }
  assert.throws(() => parseProposal({...proposal([]),sourceRevision:'stale'},source));
  assert.throws(() => parseProposal(null,source));
});
test('ambiguity and no-op proposals cannot apply', () => {
  assert.throws(() => applyProposal(source,{...parseProposal(proposal([{start:0,end:1,text:'A'}]),source),unresolvedChoices:['which?']}), /ambiguous/);
  assert.throws(() => applyProposal(source,parseProposal(proposal([]),source)), /Nothing to apply/);
});
test('translation requires revision, bounded mappings, caveats and nonempty text', () => {
  const translation = {text:'python',sourceRevision:source.revision,mappings:[{sourceStart:0,sourceEnd:3,viewStart:0,viewEnd:6}],caveats:['overflow differs']};
  assert.deepEqual(parseTranslation(translation,source),translation);
  for (const bad of [{...translation,text:''},{...translation,sourceRevision:'stale'},{...translation,caveats:[7]},{...translation,mappings:[{sourceStart:0,sourceEnd:30,viewStart:0,viewEnd:1}]}]) assert.throws(() => parseTranslation(bad,source));
});
test('quoted replacements resolve to exact offsets and fail closed', () => {
  const crlf = { uri: 'file:///a.rs', language: 'rust', text: 'let a = 1;\r\nlet b = 1;\r\n', revision: 'r' };
  const located = (find: string, text = 'x') => locateReplacements({ replacements: [{ find, text }] }, crlf) as { replacements: Array<{ start: number; end: number; text: string }> };
  assert.deepEqual(located('b = 1').replacements[0], { start: 16, end: 21, text: 'x' });
  assert.deepEqual(located('a = 1;\nlet b', 'c\nd').replacements[0], { start: 4, end: 17, text: 'c\r\nd' });
  assert.throws(() => located('= 1'), /more than one/);
  assert.throws(() => located('missing'), /not in the source file/);
  assert.throws(() => located(''), /not in the source file/);
});
test('translation links resolve from quotes and skip anything unfound', () => {
  const rust = { uri: 'file:///a.rs', language: 'rust', text: 'fn a() {}\r\nfn b() {}\r\n', revision: 'r' };
  const located = locateLinks({ text: 'def a():\n  pass\n', links: [{ source: 'fn a() {}', view: 'def a():' }, { source: 'fn missing()', view: 'def a():' }, { source: 'fn b() {}', view: 'nope' }, 'bad'] }, rust) as { mappings: unknown[] };
  assert.deepEqual(located.mappings, [{ sourceStart: 0, sourceEnd: 9, viewStart: 0, viewEnd: 8 }]);
});
test('line diff marks changes, keeps context, and collapses the rest', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\r\n');
  const diff = lineDiff(before, before.replace('line 10', 'changed'));
  assert.deepEqual(diff.filter(line => line.kind !== ' ').map(line => `${line.kind}${line.text}`), ['-line 10', '+changed']);
  assert.equal(diff.filter(line => line.kind === ' ').length, 6);
  assert.deepEqual(lineDiff('same', 'same'), []);
});
test('view revisions must contain text', () => {
  assert.deepEqual(parseRevision({ text: 'x', summary: 's' }), { text: 'x', summary: 's' });
  assert.throws(() => parseRevision({ text: '  ', summary: 's' }), /empty view/);
});
const rust = [
  'fn add(a: i32) -> i32 { a + 1 }',
  '// #[test] in a comment is not a test',
  '#[cfg(test)]',
  'mod tests {',
  '    #[test]',
  '    fn braces_in_strings() { assert_eq!("}", "}"); let c = \'}\'; }',
  '}',
  'fn after() {}',
  '#[tokio::test]',
  'async fn top_level() { assert!(true); }',
  'fn last() {}',
].join('\n');
const source2 = { uri: 'file:///a.rs', language: 'rust', text: rust, revision: revision(rust) };
const at = (text: string) => rust.indexOf(text);
const edit = (find: string, text: string) => ({ start: at(find), end: at(find) + find.length, text });
const plan = (...replacements: Array<{ start: number; end: number; text: string }>) => ({ sourceRevision: source2.revision, replacements, explanation: '', unresolvedChoices: [] });
test('Rust test ranges cover whole test items and skip lookalikes', () => {
  const found = rustTestRanges(rust).map(r => rust.slice(r.start, r.end));
  assert.equal(found.length, 2);
  assert.ok(found[0]!.startsWith('#[cfg(test)]') && found[0]!.endsWith('}\n}'));
  assert.ok(found[1]!.startsWith('#[tokio::test]') && found[1]!.endsWith('assert!(true); }'));
  assert.ok(!rust.slice(0, rustTestRanges(rust)[0]!.start).includes('assert'));
});
test('test edits are separated from production edits', () => {
  const production = edit('a + 1', 'a + 2'), tests = edit('assert!(true)', 'assert!(false)');
  assert.deepEqual(splitTestEdits(source2, plan(production)), { touchesTests: false, testsOnly: rust });
  const mixed = splitTestEdits(source2, plan(production, tests));
  assert.equal(mixed.touchesTests, true);
  assert.ok(mixed.withoutTests!.includes('a + 2') && mixed.withoutTests!.includes('assert!(true)'));
  assert.ok(mixed.testsOnly.includes('a + 1') && mixed.testsOnly.includes('assert!(false)'));
  assert.equal(splitTestEdits(source2, plan(tests)).withoutTests, undefined, 'nothing is left without the test edit');
  const spanning = { start: at('fn after'), end: at('assert!(true)'), text: '' };
  assert.equal(splitTestEdits(source2, plan(production, spanning)).withoutTests, undefined, 'partly overlapping edits cannot be separated');
  assert.equal(splitTestEdits(source2, plan({ start: at('mod tests') + 3, end: at('mod tests') + 3, text: 'x' })).touchesTests, true, 'insertions inside tests count');
});
test('other languages flag any edit that mentions test words', () => {
  const text = 'def add(x):\n    return x\n\ndef test_add():\n    assert add(1) == 1\n';
  const python = { uri: 'file:///a.py', language: 'python', text, revision: revision(text) };
  const change = (find: string, to: string) => ({ start: text.indexOf(find), end: text.indexOf(find) + find.length, text: to });
  const proposal = (...replacements: Array<{ start: number; end: number; text: string }>) => ({ sourceRevision: python.revision, replacements, explanation: '', unresolvedChoices: [] });
  assert.equal(splitTestEdits(python, proposal(change('return x', 'return x + 1'))).touchesTests, false);
  const mixed = splitTestEdits(python, proposal(change('return x', 'return x + 1'), change('assert add(1) == 1', 'assert add(1) == 2')));
  assert.equal(mixed.touchesTests, true);
  assert.ok(mixed.withoutTests!.includes('return x + 1') && mixed.withoutTests!.includes('== 1'));
});
test('only test code and explicit requests count as asking for test changes', () => {
  assert.equal(editsTestCode('a\n', 'a\nassert x == 1\n'), true);
  assert.equal(editsTestCode('a\n', 'a\ndef test_new(): pass\n'), true);
  assert.equal(editsTestCode('a\n', 'a\n# test comment\n'), false);
  assert.equal(editsTestCode('a\n', 'a\nlatest = 1\n'), false);
  assert.equal(asksForTestChange('update the tests too'), true);
  assert.equal(asksForTestChange('skip the latest scores'), false);
});
