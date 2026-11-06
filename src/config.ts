export const providerIds = ['none', 'copilot', 'chatgpt', 'claudeCode'] as const;
export type ProviderId = typeof providerIds[number];
export interface Settings { provider: ProviderId; targetLanguage: string }
export function normalizeSettings(provider: unknown, language: unknown): Settings {
  return {
    provider: providerIds.includes(provider as ProviderId) ? provider as ProviderId : 'none',
    targetLanguage: typeof language === 'string' && /^[a-z][a-z0-9_+-]{0,39}$/i.test(language.trim())
      ? language.trim().toLowerCase() : 'python',
  };
}
export function describeStatus(settings: Settings): string {
  return `Eyepiece EYE-0 + EYE-1
Preferred view: ${settings.targetLanguage}
Preferred provider: ${settings.provider}
Connection: ${settings.provider === 'copilot' ? 'Copilot selected; model availability checked on request' : 'disabled or not implemented'}
Rust → Python drafts; Preview → explicit Apply → Cargo checks → refreshed view.
Saving Python does not change Rust. No telemetry. Model requests send the selected source and draft to Copilot.`;
}
