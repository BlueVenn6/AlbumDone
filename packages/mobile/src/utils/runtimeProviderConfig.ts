import type { ProviderConfig } from '@photo-manager/shared';
import { LLMClient } from '@photo-manager/shared';
import { getStoredApiKey } from './secureApiKeys';
import { getMobileEndpointRisk } from './mobileEndpointPolicy';

export async function resolveRuntimeProviderConfig(
  config: ProviderConfig | null | undefined,
): Promise<ProviderConfig | null> {
  if (!config) {
    return null;
  }

  if (getMobileEndpointRisk(config.baseUrl ?? '', config.provider)?.level === 'blocked') {
    throw new Error('Mobile supports cloud HTTPS endpoints only.');
  }

  const apiKey = config.apiKey?.trim()
    || (config.hasApiKey ? await getStoredApiKey(config.provider) : null);

  return {
    ...config,
    ...(apiKey ? { apiKey } : { apiKey: '' }),
    hasApiKey: Boolean(apiKey || config.hasApiKey),
  };
}

export async function createRuntimeLLMClient(
  config: ProviderConfig | null | undefined,
): Promise<LLMClient | null> {
  const runtimeConfig = await resolveRuntimeProviderConfig(config);
  return runtimeConfig?.apiKey?.trim() ? new LLMClient(runtimeConfig) : null;
}
