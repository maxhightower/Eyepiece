import * as vscode from 'vscode';
import { PromptedProvider } from './prompted';
export class CopilotProvider extends PromptedProvider {
  readonly id: string;
  constructor(private readonly model: vscode.LanguageModelChat) { super(); this.id = `copilot:${model.id}`; }
  // Internal Copilot helpers (utility, dictation) also appear here but are not general chat models.
  private static async available(): Promise<vscode.LanguageModelChat[]> {
    return (await vscode.lm.selectChatModels({ vendor: 'copilot' })).filter(model => !/^copilot-(utility|dictation)/.test(model.id));
  }
  static async listModels(): Promise<Array<{ id: string; label: string }>> {
    return (await CopilotProvider.available()).map(model => ({ id: model.id, label: model.name }));
  }
  static async select(modelId?: string): Promise<CopilotProvider> {
    const models = await CopilotProvider.available();
    const model = models.find(item => item.id === modelId) ?? models[0];
    if (!model) throw new Error('No Copilot models available. Enable GitHub Copilot in VS Code and sign in with an eligible account.');
    return new CopilotProvider(model);
  }
  protected async complete(input: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const cancellation = new vscode.CancellationTokenSource();
    const cancel = () => cancellation.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 120000);
    try {
      const prompt = vscode.LanguageModelChatMessage.User(input);
      if (await this.model.countTokens(prompt, cancellation.token) > this.model.maxInputTokens - 2048) throw new Error('File exceeds the selected model context limit. Use a smaller file.');
      const response = await this.model.sendRequest([prompt], {}, cancellation.token);
      let text = '';
      for await (const fragment of response.text) {
        signal.throwIfAborted(); text += fragment;
        if (text.length > 1000000) throw new Error('Model response exceeds 1 MB limit');
      }
      if (cancellation.token.isCancellationRequested) throw new vscode.CancellationError();
      return text;
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); cancellation.dispose(); }
  }
}
