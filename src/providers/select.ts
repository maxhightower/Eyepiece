import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderId } from '../config';
import { ModelProvider } from './types';
import { CopilotProvider } from './copilot';
import { AnthropicProvider, listClaudeModels } from './anthropic';
import { OpenAIProvider, listOpenAIModels } from './openai';
import { CliProvider, claudeCommand, codexCommand } from './cli';

type ApiProvider = 'anthropic' | 'openai';
const apiNames: Record<ApiProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
/** The Claude Code extension ships the official program, so a separate install is optional. */
function claudeProgram(): string {
  const extension = vscode.extensions.getExtension('anthropic.claude-code');
  const bundled = extension && join(extension.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return bundled && existsSync(bundled) ? bundled : 'claude';
}
export class ProviderSelector {
  constructor(private readonly context: vscode.ExtensionContext) {}
  private secret(id: ApiProvider): string { return `eyepiece.${id}.apiKey`; }
  private modelKey(id: ApiProvider): string { return `eyepiece.${id}.model`; }
  /** Keys live in VS Code's encrypted secret storage, never in settings or drafts. */
  async askForKey(id: ApiProvider): Promise<string> {
    const key = (await vscode.window.showInputBox({ title: `Eyepiece: ${apiNames[id]} API key`, prompt: 'Stored in VS Code secret storage. Usage is billed by the provider.', password: true, ignoreFocusOut: true }))?.trim();
    if (!key) throw new vscode.CancellationError();
    await this.context.secrets.store(this.secret(id), key);
    return key;
  }
  private async key(id: ApiProvider): Promise<string> { return await this.context.secrets.get(this.secret(id)) ?? await this.askForKey(id); }
  async askForModel(id: ApiProvider): Promise<string> {
    const key = await this.key(id);
    const models = id === 'anthropic' ? await listClaudeModels(key) : await listOpenAIModels(key);
    const selected = await vscode.window.showQuickPick(models, { title: `Eyepiece: choose a ${apiNames[id]} model` });
    if (!selected) throw new vscode.CancellationError();
    await this.context.globalState.update(this.modelKey(id), selected);
    return selected;
  }
  async chooseModel(provider: ProviderId): Promise<void> {
    if (provider === 'copilot') { CopilotProvider.forgetChoice(); await CopilotProvider.select(); }
    else if (provider === 'anthropic' || provider === 'openai') await this.askForModel(provider);
  }
  async select(provider: ProviderId): Promise<ModelProvider> {
    switch (provider) {
      case 'copilot': return await CopilotProvider.select();
      case 'anthropic': case 'openai': {
        const key = await this.key(provider), model = this.context.globalState.get<string>(this.modelKey(provider)) ?? await this.askForModel(provider);
        return provider === 'anthropic' ? new AnthropicProvider(key, model) : new OpenAIProvider(key, model);
      }
      case 'codex': return new CliProvider(codexCommand());
      case 'claudeCode': return new CliProvider(claudeCommand(claudeProgram()));
      default: throw new Error('Choose an AI provider in the Eyepiece sidebar first.');
    }
  }
}
