/**
 * The AI-provider catalogue, shared by the Settings page's "AI engine (LLM)"
 * card and the studio's first-run key gate.
 *
 * Both render the same form, so the list lives here rather than in either of
 * them: a provider added in one place and missed in the other would leave the
 * two screens quietly offering different choices, and the gate is the one most
 * people meet first.
 */

export const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

export interface LlmProviderMeta {
  value: string;
  label: string;
  /** OpenAI-compatible endpoints need the URL as well as the key. */
  needsBaseUrl?: boolean;
  hint: string;
  /** Where to get a key, when the provider has a single obvious page for it. */
  keyUrl?: string;
  keyUrlLabel?: string;
}

export const PROVIDERS: LlmProviderMeta[] = [
  {
    value: 'openrouter',
    label: 'OpenRouter',
    hint: 'One key, hundreds of models. Recommended.',
    keyUrl: 'https://openrouter.ai/keys',
    keyUrlLabel: 'openrouter.ai/keys',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    hint: 'Native Gemini API key.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyUrlLabel: 'aistudio.google.com/apikey',
  },
  {
    value: 'anthropic',
    label: 'Anthropic',
    hint: 'Claude models (sk-ant-…).',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'console.anthropic.com',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    hint: 'GPT models (sk-…).',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'platform.openai.com',
  },
  {
    value: 'custom',
    label: 'Custom (OpenAI-compatible)',
    needsBaseUrl: true,
    hint: 'Ollama / vLLM / LM Studio / any OpenAI-compatible endpoint.',
  },
];

export const MODEL_PLACEHOLDER: Record<string, string> = {
  openrouter: 'e.g. anthropic/claude-3.5-sonnet',
  gemini: 'e.g. gemini-3-flash-preview',
  anthropic: 'e.g. claude-3-5-sonnet-latest',
  openai: 'e.g. gpt-4o',
  custom: 'e.g. llama3.1:70b',
};

/** The catalogue entry for `value`, falling back to the recommended default. */
export function providerMeta(value: string): LlmProviderMeta {
  return PROVIDERS.find((p) => p.value === value) ?? PROVIDERS[0];
}

/** API-key placeholder per provider, so the expected shape is visible up front. */
export const KEY_PLACEHOLDER: Record<string, string> = {
  openrouter: 'sk-or-…',
  gemini: 'AIza…',
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
  custom: 'your endpoint key (or any value if it needs none)',
};
