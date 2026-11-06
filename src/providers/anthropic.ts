import Anthropic from '@anthropic-ai/sdk';
import { PromptedProvider } from './prompted';

export const defaultClaudeModel = 'claude-opus-5-5';
/** Models that accept server-side refusal fallbacks. */
const fallbackModels = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const clientFor = (apiKey: string, baseURL?: string) => new Anthropic({ apiKey, timeout: 300000, ...(baseURL ? { baseURL } : {}) });
function explain(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) return new Error('Anthropic rejected the API key. Use Change API Key in the Eyepiece sidebar.');
  if (error instanceof Anthropic.RateLimitError) return new Error('Anthropic rate limit reached. Try again shortly.');
  if (error instanceof Anthropic.APIError) return new Error(`Anthropic request failed: ${error.message}`);
  return error instanceof Error ? error : new Error(String(error));
}
export async function listClaudeModels(apiKey: string, baseURL?: string): Promise<string[]> {
  try {
    const ids: string[] = [];
    for await (const model of clientFor(apiKey, baseURL).models.list()) ids.push(model.id);
    return [...ids.filter(id => id === defaultClaudeModel), ...ids.filter(id => id !== defaultClaudeModel)];
  } catch (error) { throw explain(error); }
}
export class AnthropicProvider extends PromptedProvider {
  readonly id: string;
  private readonly client: Anthropic;
  constructor(apiKey: string, private readonly model: string, baseURL?: string) { super(); this.id = `anthropic:${model}`; this.client = clientFor(apiKey, baseURL); }
  protected async complete(prompt: string, signal: AbortSignal): Promise<string> {
    try {
      const fallback = fallbackModels.has(this.model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
      const stream = this.client.beta.messages.stream({ model: this.model, max_tokens: 64000, messages: [{ role: 'user', content: prompt }], ...fallback } as Parameters<typeof this.client.beta.messages.stream>[0], { signal });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') throw new Error('The model declined this request.');
      if (message.stop_reason === 'max_tokens') throw new Error('The model ran out of output space. Use a smaller file.');
      return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
    } catch (error) { signal.throwIfAborted(); throw explain(error); }
  }
}
