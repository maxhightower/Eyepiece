/** Offsets are zero-based UTF-16 offsets, matching VS Code text offsets. */
export interface SourceSnapshot {
  uri: string;
  language: string;
  text: string;
  revision: string;
}
export interface SourceMapping {
  sourceStart: number;
  sourceEnd: number;
  viewStart: number;
  viewEnd: number;
}
export interface TranslationRequest {
  source: SourceSnapshot;
  targetLanguage: string;
}
export interface TranslationResult {
  text: string;
  sourceRevision: string;
  mappings: SourceMapping[];
  caveats: string[];
}
export interface EditRequest extends TranslationRequest {
  baseline: TranslationResult;
  editedText: string;
}
export interface ProposedEdit {
  sourceRevision: string;
  replacements: Array<{ start: number; end: number; text: string }>;
  explanation: string;
  unresolvedChoices: string[];
}
/** Providers return proposals. Only the extension may apply edits or run checks. */
export interface ModelProvider {
  readonly id: string;
  translate(request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult>;
  proposeEdit(request: EditRequest, signal: AbortSignal): Promise<ProposedEdit>;
}
