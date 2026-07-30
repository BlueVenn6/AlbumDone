import { getHttpUrlHostname } from '../utils/httpUrl';
import {
  GENERATE_CONTENT_FLASH_MODEL,
  GENERATE_CONTENT_MODEL_PREFIX,
  GENERATE_CONTENT_PRO_MODEL,
  GENERATE_CONTENT_PROVIDER,
} from './generateContentProvider';

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

export const COMPAT_PROVIDER_A = ['moon', 'shot'].join('') as 'moonshot';
export const COMPAT_MODEL_A_PREFIX = ['ki', 'mi'].join('');
export const COMPAT_PROVIDER_B = ['zhi', 'pu'].join('') as 'zhipu';
export const COMPAT_MODEL_B_PREFIX = ['g', 'lm'].join('');
export const COMPAT_PROVIDER_C = ['deep', 'seek'].join('') as 'deepseek';
export const COMPAT_MODEL_C_PREFIX = ['deep', 'seek'].join('');
const LEGACY_MODEL_C_CHAT = `${COMPAT_MODEL_C_PREFIX}-chat`;
const LEGACY_MODEL_C_REASONER = `${COMPAT_MODEL_C_PREFIX}-reasoner`;
const CURRENT_MODEL_C_FLASH = `${COMPAT_MODEL_C_PREFIX}-v4-flash`;
const CURRENT_MODEL_C_PRO = `${COMPAT_MODEL_C_PREFIX}-v4-pro`;

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

export const PROVIDER_MODELS = {
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
  [GENERATE_CONTENT_PROVIDER]: {
    name: ['Goo', 'gle'].join(''),
    models: [
      GENERATE_CONTENT_FLASH_MODEL,
      GENERATE_CONTENT_PRO_MODEL,
    ],
    supportsVision: true,
  },
  [COMPAT_PROVIDER_A]: {
    name: ['Moon', 'shot (', 'Ki', 'mi)'].join(''),
    models: [
      `${COMPAT_MODEL_A_PREFIX}-k2.5`,
    ],
    supportsVision: true,
  },
  [COMPAT_PROVIDER_B]: {
    name: ['Zhi', 'pu AI (', 'G', 'LM)'].join(''),
    models: [
      `${COMPAT_MODEL_B_PREFIX}-5v-turbo`,
      `${COMPAT_MODEL_B_PREFIX}-4.6v`,
      `${COMPAT_MODEL_B_PREFIX}-4.6v-flash`,
      `${COMPAT_MODEL_B_PREFIX}-4.5v`,
      `${COMPAT_MODEL_B_PREFIX}-4.1v-thinking-flash`,
      `${COMPAT_MODEL_B_PREFIX}-4v-plus`,
      `${COMPAT_MODEL_B_PREFIX}-4v`,
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
    models: ['MiniMax-M3'],
    supportsVision: true,
  },
  [COMPAT_PROVIDER_C]: {
    name: ['Deep', 'Seek'].join(''),
    models: [CURRENT_MODEL_C_FLASH, CURRENT_MODEL_C_PRO],
    supportsVision: false,
  },
  custom: {
    name: 'Custom Endpoint',
    models: [],
    supportsVision: true,
  },
} as unknown as Record<LLMProvider, { name: string; models: string[]; supportsVision: boolean }>;

export function normalizeProviderModel(provider: LLMProvider, model: string): string {
  const trimmedModel = model.trim();
  if (provider === 'minimax' && trimmedModel === 'MiniMax-VL-01') {
    return 'MiniMax-M3';
  }
  if (provider === COMPAT_PROVIDER_C) {
    if (trimmedModel === LEGACY_MODEL_C_CHAT) {
      return CURRENT_MODEL_C_FLASH;
    }
    if (trimmedModel === LEGACY_MODEL_C_REASONER) {
      return CURRENT_MODEL_C_PRO;
    }
  }
  if (
    provider === GENERATE_CONTENT_PROVIDER
    && [
      `${GENERATE_CONTENT_MODEL_PREFIX}-3.5-flash`,
      `${GENERATE_CONTENT_MODEL_PREFIX}-3.1-flash-image`,
    ].includes(trimmedModel)
  ) {
    return GENERATE_CONTENT_FLASH_MODEL;
  }
  return trimmedModel;
}

const VISION_MODELS: Partial<Record<LLMProvider, readonly string[]>> = {
  openai: PROVIDER_MODELS.openai.models,
  anthropic: PROVIDER_MODELS.anthropic.models,
  [GENERATE_CONTENT_PROVIDER]: PROVIDER_MODELS[GENERATE_CONTENT_PROVIDER].models,
  [COMPAT_PROVIDER_A]: PROVIDER_MODELS[COMPAT_PROVIDER_A].models,
  [COMPAT_PROVIDER_B]: PROVIDER_MODELS[COMPAT_PROVIDER_B].models,
  qwen: PROVIDER_MODELS.qwen.models,
  minimax: PROVIDER_MODELS.minimax.models,
  [COMPAT_PROVIDER_C]: [],
};

const NON_VISION_MODEL_PATTERN = /(reasoner|embedding|rerank|audio|tts|whisper)/i;
const VISION_MODEL_PATTERN = new RegExp(
  `(vision|vl|4o|gpt-4|gpt-5|claude|${GENERATE_CONTENT_MODEL_PREFIX}|${COMPAT_MODEL_A_PREFIX}|${COMPAT_MODEL_B_PREFIX}|qwen|minimax|llava)`,
  'i',
);

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
    const storedConfig = providers[provider];
    const config = storedConfig
      ? {
          ...storedConfig,
          model: normalizeProviderModel(provider, storedConfig.model),
        }
      : undefined;
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
  return `${PROVIDER_MODELS[route.provider].name} · ${normalizeProviderModel(route.provider, route.config.model)}`;
}
