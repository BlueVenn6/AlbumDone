import { resolveProviderRoute, useSettingsStore } from '@photo-manager/shared';
import type { LLMMessage, LLMProvider, LLMResponse } from '@photo-manager/shared';

export function resolveDesktopLLMRoute(
  providerKey?: LLMProvider | null,
  options: { requiresVision?: boolean } = {},
) {
  const { defaultVisionProvider, defaultTextProvider, providers } =
    useSettingsStore.getState();

  return resolveProviderRoute(
    providers,
    {
      providerKey,
      defaultVisionProvider,
      defaultTextProvider,
    },
    { ...options, allowMissingApiKey: true },
  );
}

type DesktopLLMClient = {
  chat(messages: LLMMessage[], options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse>;
  chatWithImage(
    prompt: string,
    imageBase64: string,
    mimeType: string,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<LLMResponse>;
};

export async function createDesktopLLMClient(
  providerKey?: LLMProvider | null,
  options: { requiresVision?: boolean } = {},
): Promise<DesktopLLMClient | null> {
  const requiresVision = options.requiresVision ?? false;
  const route = resolveDesktopLLMRoute(providerKey, { requiresVision });

  if (!route) {
    return null;
  }

  const config = route.config;
  if (!config) {
    return null;
  }

  const status = await window.electronAPI?.settings?.getApiKeyStatus(route.provider);
  if (!status?.hasApiKey && !config.hasApiKey) {
    return null;
  }

  const requestConfig = {
    provider: route.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    supportsVision: config.supportsVision,
    mode: config.mode,
  };

  return {
    chat: (messages, requestOptions = {}) => {
      if (!window.electronAPI?.llm?.chat) {
        throw new Error('Desktop LLM bridge is not available.');
      }
      return window.electronAPI.llm.chat({
        ...requestConfig,
        messages,
        options: requestOptions,
      });
    },
    chatWithImage: (prompt, imageBase64, mimeType, requestOptions = {}) => {
      if (!window.electronAPI?.llm?.chatWithImage) {
        throw new Error('Desktop LLM bridge is not available.');
      }
      return window.electronAPI.llm.chatWithImage({
        ...requestConfig,
        prompt,
        imageBase64,
        mimeType,
        options: requestOptions,
      });
    },
  };
}
