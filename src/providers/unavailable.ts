import type { EditRequest, ModelProvider, ProposedEdit, TranslationRequest, TranslationResult } from './types';
export class UnavailableProvider implements ModelProvider {
  constructor(readonly id: string) {}
  async translate(_request: TranslationRequest, signal: AbortSignal): Promise<TranslationResult> {
    signal.throwIfAborted();
    throw new Error(`Provider '${this.id}' is not implemented in EYE-0. No request was sent.`);
  }
  async proposeEdit(_request: EditRequest, signal: AbortSignal): Promise<ProposedEdit> {
    signal.throwIfAborted();
    throw new Error(`Provider '${this.id}' is not implemented in EYE-0. No source was changed.`);
  }
}
