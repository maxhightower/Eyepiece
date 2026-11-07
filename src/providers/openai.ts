import OpenAI from 'openai';
import { PromptedProvider } from './prompted';

const clientFor = (apiKey: string, baseURL?: string) => new OpenAI({ apiKey, timeout: 300000, ...(baseURL ? { baseURL } : {}) });
function explain(error: unknown): Error {
  if (error instanceof OpenAI.AuthenticationError) return new Error('OpenAI rejected the API key. Use Change API Key in the Eyepiece sidebar.');
  if (error instanceof OpenAI.RateLimitError) return new Error('OpenAI rate limit or quota reached. Check your API billing, or try again shortly.');
  if (error instanceof OpenAI.APIError) return new Error(`OpenAI request failed: ${error.message}`);
  return error instanceof Error ? error : new Error(String(error));
}
/** Text models only, newest first. The API lists audio, image, and embedding models too. */
export async function listOpenAIModels(apiKey: string, baseURL?: string): Promise<string[]> {
  try {
    const models = [];
    for await (const model of clientFor(apiKey, baseURL).models.list()) models.push(model);
    return models.filter(model => /^(gpt|o\d|chatgpt)/.test(model.id) && !/audio|realtime|image|tts|transcribe|search|embedding/.test(model.id))
      .sort((a, b) => b.created - a.created).map(model => model.id);
  } catch (error) { throw explain(error); }
}
export class OpenAIProvider extends PromptedProvider {
  readonly id: string;
  private readonly client: OpenAI;
  constructor(apiKey: string, private readonly model: string, baseURL?: string) { super(); this.id = `openai:${model}`; this.client = clientFor(apiKey, baseURL); }
  protected async complete(prompt: string, signal: AbortSignal): Promise<string> {
    try {
      const response = await this.client.responses.create({ model: this.model, input: prompt }, { signal });
      if (response.status === 'incomplete') throw new Error('The model ran out of output space. Use a smaller file.');
      return response.output_text;
    } catch (error) { signal.throwIfAborted(); throw explain(error); }
  }
}
