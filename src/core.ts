import { createHash } from 'node:crypto';
import { ProposedEdit, SourceSnapshot, TranslationResult } from './providers/types';
export const revision = (text: string): string => createHash('sha256').update(text).digest('hex');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Expected string'); return value; }
function strings(value: unknown): string[] { if (!Array.isArray(value)) throw new Error('Expected string array'); return value.map(string); }
function offset(value: unknown, limit: number): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > limit) throw new Error('Invalid text offset');
  return value as number;
}
export function parseTranslation(value: unknown, source: SourceSnapshot): TranslationResult {
  const v = object(value), text = string(v.text);
  if (!text.trim() || v.sourceRevision !== source.revision) throw new Error('Empty translation or stale revision');
  if (!Array.isArray(v.mappings)) throw new Error('Missing mappings');
  const mappings = v.mappings.map(item => {
    const m = object(item);
    const result = { sourceStart: offset(m.sourceStart, source.text.length), sourceEnd: offset(m.sourceEnd, source.text.length), viewStart: offset(m.viewStart, text.length), viewEnd: offset(m.viewEnd, text.length) };
    if (result.sourceStart > result.sourceEnd || result.viewStart > result.viewEnd) throw new Error('Reversed mapping');
    return result;
  });
  return { text, sourceRevision: source.revision, mappings, caveats: strings(v.caveats) };
}
export function parseProposal(value: unknown, source: SourceSnapshot): ProposedEdit {
  const v = object(value);
  if (v.sourceRevision !== source.revision || !Array.isArray(v.replacements)) throw new Error('Invalid proposal or stale revision');
  const replacements = v.replacements.map(item => {
    const e = object(item);
    const result = { start: offset(e.start, source.text.length), end: offset(e.end, source.text.length), text: string(e.text) };
    if (result.start > result.end) throw new Error('Reversed edit');
    for (const p of [result.start, result.end]) {
      if (p > 0 && p < source.text.length && /[\uD800-\uDBFF]/.test(source.text[p-1]!) && /[\uDC00-\uDFFF]/.test(source.text[p]!)) throw new Error('Edit splits Unicode character');
    }
    return result;
  }).sort((a,b) => a.start-b.start || a.end-b.end);
  for (let i=1;i<replacements.length;i++) {
    const previous = replacements[i-1]!, current = replacements[i]!;
    if (current.start < previous.end || current.start === previous.start) throw new Error('Overlapping edits');
  }
  return { sourceRevision: source.revision, replacements, explanation: string(v.explanation), unresolvedChoices: strings(v.unresolvedChoices) };
}
export function applyProposal(source: SourceSnapshot, proposal: ProposedEdit): string {
  const valid = parseProposal(proposal, source);
  if (valid.unresolvedChoices.length) throw new Error('Resolve ambiguous choices before applying');
  let text = source.text;
  for (const e of [...valid.replacements].reverse()) text = text.slice(0,e.start)+e.text+text.slice(e.end);
  if (text === source.text) throw new Error('Proposal contains no source changes');
  return text;
}
