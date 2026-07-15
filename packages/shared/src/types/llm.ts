import { getHttpUrlHostname } from '../utils/httpUrl';

export type LLMProvider =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'moonshot'
  | 'zhipu'
  | 'qwen'
  | 'minimax'
  | 'deepseek'
  | 'custom';

export type ProviderMode = 'direct' | 'proxy';

export type ProviderConfig = {
  provider: LLMProvider;
  apiKey?: string;
  hasApiKey?: boolean;
  baseUrl?: string;
  model: string;
  supportsVision: boolean;
  mode?: ProviderMode;
};

export type LLMMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string | LLMContentPart[];
};

export type LLMContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } };

export type LLMResponse = {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
};

export const PROVIDER_MODELS: Record<
  LLMProvider,
  { name: string; models: string[]; supportsVision: boolean }
> = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-5.5', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    supportsVision: true,
  },
  anthropic: {
    name: 'Anthropic',
    models: [
      'claude-sonnet-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
    ],
    supportsVision: true,
  },
  google: {
    name: 'Google',
    models: [
      'gemini-3.5-flash',
      'gemini-3.1-flash-image',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ],
    supportsVision: true,
  },
  moonshot: {
    name: 'Moonshot (Kimi)',
    models: [
      'kimi-k2.5',
    ],
    supportsVision: true,
  },
  zhipu: {
    name: 'Zhipu AI (GLM)',
    models: [
      'glm-5v-turbo',
      'glm-4.6v',
      'glm-4.6v-flash',
      'glm-4.5v',
      'glm-4.1v-thinking-flash',
      'glm-4v-plus',
      'glm-4v',
    ],
    supportsVision: true,
  },
  qwen: {
    name: 'Alibaba (Qwen)',
    models: [
      'qwen3.7-plus',
      'qwen3.6-flash',
      'qwen3.5-plus',
      'qwen3.5-flash',
      'qwen3.5-omni-plus',
      'qwen3-vl-plus',
      'qwen3-vl-flash',
      'qwen-vl-max',
      'qwen-vl-plus',
    ],
    supportsVision: true,
  },
  minimax: {
    name: 'MiniMax',
    models: ['MiniMax-VL-01'],
    supportsVision: true,
  },
  deepseek: {
    name: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    supportsVision: false,
  },
  custom: {
    name: 'Custom Endpoint',
    models: [],
    supportsVision: true,
  },
};

const VISION_MODELS: Partial<Record<LLMProvider, readonly string[]>> = {
  openai: PROVIDER_MODELS.openai.models,
  anthropic: PROVIDER_MODELS.anthropic.models,
  google: PROVIDER_MODELS.google.models,
  moonshot: PROVIDER_MODELS.moonshot.models,
  zhipu: PROVIDER_MODELS.zhipu.models,
  qwen: PROVIDER_MODELS.qwen.models,
  minimax: PROVIDER_MODELS.minimax.models,
  deepseek: [],
};

const NON_VISION_MODEL_PATTERN = /(reasoner|embedding|rerank|audio|tts|whisper)/i;
const VISION_MODEL_PATTERN = /(vision|vl|4o|gpt-4|gpt-5|claude|gemini|kimi|glm|qwen|minimax|llava)/i;

function getHostname(baseUrl?: string): string | null {
  return getHttpUrlHostname(baseUrl);
}

export function providerHasVisionModels(provider: LLMProvider): boolean {
  if (provider === 'custom') return true;
  return (VISION_MODELS[provider]?.length ?? 0) > 0;
}

export function modelSupportsVision(
  provider: LLMProvider,
  model: string,
  baseUrl?: string,
): boolean {
  if (provider === 'custom') {
    const normalizedModel = model.toLowerCase();
    if (NON_VISION_MODEL_PATTERN.test(normalizedModel)) {
      return false;
    }
    return VISION_MODEL_PATTERN.test(normalizedModel);
  }

  if (provider === 'anthropic') {
    const hostname = getHostname(baseUrl);
    if (hostname && hostname !== 'api.anthropic.com') {
      return false;
    }
  }

  const visionModels = VISION_MODELS[provider];
  if (!visionModels) {
    return PROVIDER_MODELS[provider].supportsVision;
  }

  if (visionModels.includes(model)) {
    return true;
  }

  if (!PROVIDER_MODELS[provider].supportsVision) {
    return false;
  }

  const normalizedModel = model.toLowerCase();
  if (NON_VISION_MODEL_PATTERN.test(normalizedModel)) {
    return false;
  }

  return VISION_MODEL_PATTERN.test(normalizedModel);
}

export function proxyModelSupportsVision(
  provider: LLMProvider,
  model: string,
  baseUrl?: string,
): boolean {
  const normalizedModel = model.toLowerCase();
  if (NON_VISION_MODEL_PATTERN.test(normalizedModel)) {
    return false;
  }
  if (VISION_MODELS[provider]?.includes(model)) {
    return true;
  }
  return VISION_MODEL_PATTERN.test(normalizedModel);
}

export function configSupportsVision(config?: ProviderConfig): boolean {
  if (!config) return false;
  if (config.mode === 'proxy') {
    return proxyModelSupportsVision(config.provider, config.model, config.baseUrl);
  }
  return modelSupportsVision(config.provider, config.model, config.baseUrl);
}

export type ResolvedProviderRoute = {
  provider: LLMProvider;
  config: ProviderConfig;
  source: 'selected' | 'defaultVision' | 'defaultText' | 'firstConfigured';
};

function hasConfiguredApiKey(config?: ProviderConfig): config is ProviderConfig {
  return Boolean(config?.apiKey?.trim() || config?.hasApiKey);
}

export function getConfiguredProviders(
  providers: Partial<Record<LLMProvider, ProviderConfig>>,
  options: { requiresVision?: boolean; allowMissingApiKey?: boolean } = {},
): LLMProvider[] {
  const requiresVision = options.requiresVision ?? false;
  const allowMissingApiKey = options.allowMissingApiKey ?? false;

  return Object.entries(providers).flatMap(([provider, config]) => {
    if (!config || (!allowMissingApiKey && !hasConfiguredApiKey(config))) {
      return [];
    }
    if (requiresVision && !configSupportsVision(config)) {
      return [];
    }
    return [provider as LLMProvider];
  });
}

export function resolveProviderRoute(
  providers: Partial<Record<LLMProvider, ProviderConfig>>,
  defaults: {
    providerKey?: LLMProvider | null;
    defaultVisionProvider?: LLMProvider | null;
    defaultTextProvider?: LLMProvider | null;
  } = {},
  options: { requiresVision?: boolean; allowMissingApiKey?: boolean } = {},
): ResolvedProviderRoute | null {
  const requiresVision = options.requiresVision ?? false;
  const allowMissingApiKey = options.allowMissingApiKey ?? false;
  const candidates: Array<[LLMProvider | null | undefined, ResolvedProviderRoute['source']]> = [
    [defaults.providerKey, 'selected'],
    [defaults.defaultVisionProvider, 'defaultVision'],
    [defaults.defaultTextProvider, 'defaultText'],
  ];

  for (const [provider, source] of candidates) {
    if (!provider) {
      continue;
    }
    const config = providers[provider];
    if (!config || (!allowMissingApiKey && !hasConfiguredApiKey(config))) {
      continue;
    }
    if (requiresVision && !configSupportsVision(config)) {
      continue;
    }
    return { provider, config, source };
  }

  const fallbackProvider = getConfiguredProviders(providers, { requiresVision, allowMissingApiKey })[0];
  if (!fallbackProvider) {
    return null;
  }

  const config = providers[fallbackProvider];
  if (!config) {
    return null;
  }

  return {
    provider: fallbackProvider,
    config,
    source: 'firstConfigured',
  };
}

export function formatProviderRouteLabel(route: Pick<ResolvedProviderRoute, 'provider' | 'config'>): string {
  return `${PROVIDER_MODELS[route.provider].name} · ${route.config.model}`;
}
