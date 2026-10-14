import type { AiProvider } from './ai-connections.js';

export const aiProviderLabels: Record<AiProvider, string> = {
  openai: 'OpenAI',
  claude: 'Anthropic',
  deepseek: 'DeepSeek',
};

const defaultModels: Record<AiProvider, string> = {
  openai: process.env.OPENAI_MODEL ?? 'gpt-6-luna',
  claude: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
  deepseek: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
};

const fallbackModels: Record<AiProvider, string[]> = {
  openai: ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra'],
  claude: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'],
  deepseek: ['deepseek-flash', 'deepseek-v4-pro'],
};

export function getAiModels(provider: AiProvider) {
  const configured = process.env[`${provider.toUpperCase()}_MODELS`]
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean) ?? [];
  return [...new Set([defaultModels[provider], ...fallbackModels[provider], ...configured])];
}

export function getDefaultAiModel(provider: AiProvider) {
  return defaultModels[provider];
}

export function isSupportedAiModel(provider: AiProvider, model: string) {
  return getAiModels(provider).includes(model);
}

export function getAiApiKey(provider: AiProvider) {
  return process.env[`${provider.toUpperCase()}_API_KEY`];
}

export function normalizeAiProvider(value: unknown): AiProvider | null {
  return value === 'openai' || value === 'claude' || value === 'deepseek' ? value : null;
}
