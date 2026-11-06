import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revision, parseTranslation, parseProposal, applyProposal } from '../../src/core';
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
  assert.throws(() => applyProposal(source,parseProposal(proposal([]),source)), /no source changes/);
});
test('translation requires revision, bounded mappings, caveats and nonempty text', () => {
  const translation = {text:'python',sourceRevision:source.revision,mappings:[{sourceStart:0,sourceEnd:3,viewStart:0,viewEnd:6}],caveats:['overflow differs']};
  assert.deepEqual(parseTranslation(translation,source),translation);
  for (const bad of [{...translation,text:''},{...translation,sourceRevision:'stale'},{...translation,caveats:[7]},{...translation,mappings:[{sourceStart:0,sourceEnd:30,viewStart:0,viewEnd:1}]}]) assert.throws(() => parseTranslation(bad,source));
});
