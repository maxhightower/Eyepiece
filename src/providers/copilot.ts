import * as vscode from 'vscode';
import { PromptedProvider } from './prompted';
export class CopilotProvider extends PromptedProvider {
  readonly id: string;
  constructor(private readonly model: vscode.LanguageModelChat) { super(); this.id = `copilot:${model.id}`; }
  private static chosenModelId: string | undefined;
  static forgetChoice(): void { CopilotProvider.chosenModelId = undefined; }
  static async select(): Promise<CopilotProvider> {
    // Internal Copilot helpers (utility, dictation) also appear here but are not general chat models.
    const models = (await vscode.lm.selectChatModels({ vendor: 'copilot' })).filter(model => !/^copilot-(utility|dictation)/.test(model.id));
    const remembered = models.find(model => model.id === CopilotProvider.chosenModelId);
    if (remembered) return new CopilotProvider(remembered);
    if (!models.length) throw new Error('No Copilot models available. Enable GitHub Copilot in VS Code and sign in with an eligible account.');
    const selected = models.length === 1 ? { model: models[0]! } : await vscode.window.showQuickPick(models.map(model => ({ label: model.name, description: model.id, model })), { title: 'Eyepiece: choose a Copilot model' });
    if (!selected) throw new vscode.CancellationError();
    CopilotProvider.chosenModelId = selected.model.id;
    return new CopilotProvider(selected.model);
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
