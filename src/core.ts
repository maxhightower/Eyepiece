import { createHash } from 'node:crypto';
import { ProposedEdit, SourceSnapshot, TranslationResult, ViewRevision } from './providers/types';
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
/** Models quote the text to replace because they miscount offsets. Quotes must match exactly one place in the source. */
export function locateReplacements(value: unknown, source: SourceSnapshot): unknown {
  const v = object(value);
  if (!Array.isArray(v.replacements)) return v;
  const eol = (text: string) => source.text.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
  return { ...v, replacements: v.replacements.map(item => {
    const e = object(item), find = eol(string(e.find)), start = source.text.indexOf(find);
    if (!find || start < 0) throw new Error('The proposed change quotes text that is not in the source file. Preview again.');
    if (source.text.includes(find, start + 1)) throw new Error('The proposed change matches more than one place in the source file. Preview again.');
    return { start, end: start + find.length, text: eol(string(e.text)) };
  }) };
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
/** Translation links quote both sides, like replacements. Quotes that cannot be found are dropped: links are optional. */
export function locateLinks(value: unknown, source: SourceSnapshot): unknown {
  const v = object(value), text = string(v.text);
  const eol = (quote: string) => source.text.includes('\r\n') ? quote.replace(/\r?\n/g, '\r\n') : quote;
  const mappings = [];
  for (const item of Array.isArray(v.links) ? v.links : []) {
    if (!item || typeof item !== 'object') continue;
    const link = item as Record<string, unknown>;
    if (typeof link.source !== 'string' || typeof link.view !== 'string' || !link.source || !link.view) continue;
    const quote = eol(link.source), sourceStart = source.text.indexOf(quote), viewStart = text.indexOf(link.view);
    if (sourceStart >= 0 && viewStart >= 0) mappings.push({ sourceStart, sourceEnd: sourceStart + quote.length, viewStart, viewEnd: viewStart + link.view.length });
  }
  return { ...v, mappings };
}
export function parseRevision(value: unknown): ViewRevision {
  const v = object(value), text = string(v.text);
  if (!text.trim()) throw new Error('The model returned an empty view.');
  return { text, summary: string(v.summary) };
}
export interface DiffLine { kind: ' ' | '+' | '-' | '…'; text: string }
/** Line diff with three lines of context, for rendering a review inside the panel. */
export function lineDiff(before: string, after: string, context = 3): DiffLine[] {
  const a = before.split(/\r?\n/), b = after.split(/\r?\n/);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = a[start + i] === b[start + j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const lines: DiffLine[] = a.slice(0, start).map(text => ({ kind: ' ', text }));
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) { lines.push({ kind: ' ', text: a[start + i]! }); i++; j++; }
    else if (i < n && (j === m || table[i + 1]![j]! >= table[i]![j + 1]!)) lines.push({ kind: '-', text: a[start + i++]! });
    else lines.push({ kind: '+', text: b[start + j++]! });
  }
  lines.push(...a.slice(endA).map(text => ({ kind: ' ' as const, text })));
  const keep = lines.map((line, index) => lines.slice(Math.max(0, index - context), index + context + 1).some(near => near.kind !== ' '));
  const shown: DiffLine[] = [];
  lines.forEach((line, index) => {
    if (keep[index]) shown.push(line);
    else if (shown.length && shown[shown.length - 1]!.kind !== '…') shown.push({ kind: '…', text: '' });
  });
  if (shown[shown.length - 1]?.kind === '…') shown.pop();
  return shown;
}
/** Finds the end of the Rust item starting at `from`, skipping comments, strings, and char literals. */
function rustItemEnd(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i]!, next = text[i + 1];
    if (c === '/' && next === '/') { const end = text.indexOf('\n', i); if (end < 0) return text.length; i = end; }
    else if (c === '/' && next === '*') { const end = text.indexOf('*/', i + 2); if (end < 0) return text.length; i = end + 1; }
    else if (c === '"') { for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++; }
    else if (c === "'" && /^'(\\.|[^\\'])'/.test(text.slice(i, i + 4))) i = text.indexOf("'", i + 2);
    else if (c === '{') depth++;
    else if (c === '}') { if (--depth === 0) return i + 1; }
    else if (c === ';' && depth === 0) return i + 1;
  }
  return text.length;
}
/** Ranges of Rust test code: items marked #[cfg(test)], #[test], or a test macro such as #[tokio::test]. */
export function rustTestRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(/#\[\s*(?:cfg\([^\]]*\btest\b[^\]]*\)|(?:[\w]+::)*test)\s*\]/g)) {
    const start = match.index, last = ranges[ranges.length - 1];
    if ((last && start < last.end) || text.slice(text.lastIndexOf('\n', start) + 1, start).includes('//')) continue;
    ranges.push({ start, end: rustItemEnd(text, start + match[0].length) });
  }
  return ranges;
}
const testWords = /\b(test|assert|expect)/i;
export interface TestEdits { touchesTests: boolean; testsOnly: string; withoutTests?: string }
const applyEdits = (text: string, edits: ProposedEdit['replacements']) => [...edits].reverse().reduce((result, e) => result.slice(0, e.start) + e.text + result.slice(e.end), text);
/** Separates a proposal's test edits. withoutTests is only offered when production edits can stand alone. */
export function splitTestEdits(source: SourceSnapshot, proposal: ProposedEdit): TestEdits {
  const rust = source.language === 'rust', ranges = rust ? rustTestRanges(source.text) : [];
  const overlaps = (e: { start: number; end: number }, r: { start: number; end: number }) => e.start === e.end ? r.start < e.start && e.start < r.end : e.start < r.end && e.end > r.start;
  // Other languages have no parser here, so any edit mentioning test words counts. This errs towards asking.
  const touching = proposal.replacements.filter(e => rust ? ranges.some(r => overlaps(e, r)) : testWords.test(source.text.slice(e.start, e.end) + e.text));
  const others = proposal.replacements.filter(e => !touching.includes(e));
  const partial = rust && touching.some(e => !ranges.some(r => r.start <= e.start && e.end <= r.end));
  const withoutTests = touching.length && others.length && !partial ? applyEdits(source.text, others) : undefined;
  return { touchesTests: touching.length > 0, testsOnly: applyEdits(source.text, touching), ...(withoutTests === undefined ? {} : { withoutTests }) };
}
/** Whether typed edits change test code in the view. Comment lines do not count; unrecognised edits stay blocked. */
export function editsTestCode(before: string, after: string): boolean {
  return lineDiff(before, after).some(line => (line.kind === '+' || line.kind === '-') && !/^\s*(#|\/\/)/.test(line.text) && testWords.test(line.text));
}
export const asksForTestChange = (request: string): boolean => /\btests?\b/i.test(request);
