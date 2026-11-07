import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LanguageOption, pickModel, ProviderId } from '../config';
import { ModelProvider } from './types';
import { CopilotProvider } from './copilot';
import { AnthropicProvider, listClaudeModels } from './anthropic';
import { OpenAIProvider, listOpenAIModels } from './openai';
import { CliProvider, claudeCommand, codexCommand } from './cli';

type ApiProvider = 'anthropic' | 'openai';
const apiNames: Record<ApiProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI' };
const isApi = (id: ProviderId): id is ApiProvider => id === 'anthropic' || id === 'openai';
/** The provider extension ships the official program, so a separate install is optional. */
function claudeProgram(): string {
  const extension = vscode.extensions.getExtension('anthropic.claude-code');
  const bundled = extension && join(extension.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return bundled && existsSync(bundled) ? bundled : 'claude';
}
export class ProviderSelector {
  constructor(private readonly context: vscode.ExtensionContext) {}
  private secret(id: ApiProvider): string { return `eyepiece.${id}.apiKey`; }
  private modelKey(id: ProviderId): string { return `eyepiece.${id}.model`; }
  /** Keys live in VS Code's encrypted secret storage, never in settings or drafts. */
  async askForKey(id: ApiProvider): Promise<string> {
    const key = (await vscode.window.showInputBox({ title: `Eyepiece: ${apiNames[id]} API key`, prompt: 'Stored in VS Code secret storage. Usage is billed by the provider.', password: true, ignoreFocusOut: true }))?.trim();
    if (!key) throw new vscode.CancellationError();
    await this.context.secrets.store(this.secret(id), key);
    return key;
  }
  private async key(id: ApiProvider): Promise<string> { return await this.context.secrets.get(this.secret(id)) ?? await this.askForKey(id); }
  async ensureKey(id: ProviderId): Promise<void> { if (isApi(id)) await this.key(id); }
  /** Models to offer. Empty when a provider has no list, or no key yet. Never prompts. */
  async models(provider: ProviderId): Promise<LanguageOption[]> {
    if (provider === 'copilot') return await CopilotProvider.listModels();
    if (!isApi(provider)) return [];
    const key = await this.context.secrets.get(this.secret(provider));
    if (!key) return [];
    const ids = provider === 'anthropic' ? await listClaudeModels(key) : await listOpenAIModels(key);
    return ids.map(id => ({ id, label: id }));
  }
  savedModel(provider: ProviderId): string | undefined { return this.context.globalState.get<string>(this.modelKey(provider)); }
  async saveModel(provider: ProviderId, model: string): Promise<void> { await this.context.globalState.update(this.modelKey(provider), model); }
  async select(provider: ProviderId, override?: string): Promise<ModelProvider> {
    switch (provider) {
      case 'copilot': return await CopilotProvider.select(override ?? this.savedModel(provider));
      case 'anthropic': case 'openai': {
        const key = await this.key(provider);
        const model = pickModel((await this.models(provider)).map(item => item.id), this.savedModel(provider), override);
        if (!model) throw new Error(`No ${apiNames[provider]} models are available for this key.`);
        return provider === 'anthropic' ? new AnthropicProvider(key, model) : new OpenAIProvider(key, model);
      }
      case 'codex': return new CliProvider(codexCommand());
      case 'claudeCode': return new CliProvider(claudeCommand(claudeProgram()));
      default: throw new Error('Choose an AI provider in the Eyepiece sidebar first.');
    }
  }
}
