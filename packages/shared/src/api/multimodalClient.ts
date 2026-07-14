import { LLMClient, testLLMConnection } from './llmClient';
import type { LLMRequestOptions, TestConnectionResult } from './llmClient';
import { modelSupportsVision, proxyModelSupportsVision } from '../types/llm';
import type { LLMProvider, ProviderConfig } from '../types/llm';

export { LLMClient, testLLMConnection };
export type { LLMRequestOptions, TestConnectionResult };

export {
  PROVIDER_MODELS,
  configSupportsVision,
  formatProviderRouteLabel,
  getConfiguredProviders,
  providerHasVisionModels,
  resolveProviderRoute,
} from '../types/llm';
export { modelSupportsVision, proxyModelSupportsVision };
export type {
  LLMContentPart,
  LLMMessage,
  LLMProvider,
  LLMResponse,
  ProviderConfig,
  ProviderMode,
  ResolvedProviderRoute,
} from '../types/llm';

export {
  LLMClientError,
  buildAnthropicMessagesUrl,
  buildGoogleGenerateContentUrl,
  buildOpenAIChatCompletionsUrl,
  buildOpenAIResponsesUrl,
  classifyLLMError,
  createLLMClientError,
  getDefaultProviderBaseUrl,
  normalizeProviderBaseUrl,
  sanitizeLLMErrorText,
} from './llmEndpoint';
export type {
  ClassifiedLLMError,
  LLMErrorCategory,
} from './llmEndpoint';

export type MultimodalInstruction = {
  imageBase64: string;
  mimeType: string;
  instruction: string;
  requestOptions?: LLMRequestOptions;
};

export function createMultimodalClient(config: ProviderConfig): LLMClient {
  return new LLMClient(config);
}

export async function executeImageInstruction(
  client: LLMClient,
  input: MultimodalInstruction,
): Promise<string> {
  const response = await client.chatWithImage(
    input.instruction,
    input.imageBase64,
    input.mimeType,
    input.requestOptions,
  );
  return response.content;
}

export function createProviderConfig(input: {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  mode?: ProviderConfig['mode'];
}): ProviderConfig {
  const supportsVision = input.mode === 'proxy'
    ? proxyModelSupportsVision(input.provider, input.model, input.baseUrl)
    : modelSupportsVision(input.provider, input.model, input.baseUrl);
  return {
    provider: input.provider,
    model: input.model,
    supportsVision,
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
  };
}
