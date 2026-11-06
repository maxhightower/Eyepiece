export const providerIds = ['none', 'copilot', 'anthropic', 'openai', 'codex', 'claudeCode'] as const;
export type ProviderId = typeof providerIds[number];
export const providerLabels: Record<ProviderId, string> = { none: 'None', copilot: 'GitHub Copilot', anthropic: 'Anthropic API key', openai: 'OpenAI API key', codex: 'Codex (ChatGPT plan)', claudeCode: 'Claude Code (personal use)' };
/** Languages a source file can be viewed in. extension names the saved draft file. */
export const targetLanguages = {
  english: { label: 'English', extension: 'md' },
  python: { label: 'Python', extension: 'py' },
  rust: { label: 'Rust', extension: 'rs' },
  typescript: { label: 'TypeScript', extension: 'ts' },
  javascript: { label: 'JavaScript', extension: 'js' },
  go: { label: 'Go', extension: 'go' },
  java: { label: 'Java', extension: 'java' },
  csharp: { label: 'C#', extension: 'cs' },
  cpp: { label: 'C++', extension: 'cpp' },
  c: { label: 'C', extension: 'c' },
  ruby: { label: 'Ruby', extension: 'rb' },
  php: { label: 'PHP', extension: 'php' },
  swift: { label: 'Swift', extension: 'swift' },
  kotlin: { label: 'Kotlin', extension: 'kt' },
} as const;
export type TargetLanguage = keyof typeof targetLanguages;
export interface LanguageOption { id: string; label: string }
export const languageOptions = (): LanguageOption[] => Object.entries(targetLanguages).map(([id, item]) => ({ id, label: item.label }));
/** The session choice wins, then the saved default, then the first model. A choice that no longer exists is skipped. */
export function pickModel(models: string[], saved?: string, override?: string): string | undefined {
  return [override, saved].find(id => id !== undefined && models.includes(id)) ?? models[0];
}
export function filterLanguages(options: LanguageOption[], query: string): LanguageOption[] {
  const text = query.trim().toLowerCase();
  return options.filter(option => option.label.toLowerCase().includes(text) || option.id.includes(text));
}
export interface Settings { provider: ProviderId; targetLanguage: string }
export function normalizeSettings(provider: unknown, language: unknown): Settings {
  return {
    provider: providerIds.includes(provider as ProviderId) ? provider as ProviderId : 'none',
    targetLanguage: typeof language === 'string' && language.trim().toLowerCase() in targetLanguages
      ? language.trim().toLowerCase() : 'python',
  };
}
export function describeStatus(settings: Settings): string {
  return `Eyepiece EYE-0 + EYE-1
Preferred view: ${settings.targetLanguage}
Preferred provider: ${settings.provider}
Connection: ${settings.provider === 'none' ? 'disabled or not implemented' : `${providerLabels[settings.provider]} selected; availability checked on request`}
Source file → editable view; Preview → explicit Apply → project checks → refreshed view.
Editing the view does not change the source. No telemetry. Model requests send the selected source and draft to the selected provider.`;
}
