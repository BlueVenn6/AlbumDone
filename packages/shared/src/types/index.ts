export type {
  PhotoQuality,
  Photo,
  Album,
  DuplicateGroup,
  CullingDecision,
  CullingItem,
} from './photo';

export type {
  LLMProvider,
  ProviderMode,
  CustomLLMProtocol,
  LLMConnectionTestMode,
  ProviderConnectionTests,
  ProviderConfig,
  LLMMessage,
  LLMContentPart,
  LLMResponse,
} from './llm';

export {
  COMPAT_MODEL_A_PREFIX,
  COMPAT_MODEL_B_PREFIX,
  COMPAT_PROVIDER_A,
  COMPAT_PROVIDER_B,
  COMPAT_PROVIDER_C,
  PROVIDER_MODELS,
  normalizeProviderModel,
  providerHasVisionModels,
  modelSupportsVision,
  proxyModelSupportsVision,
  configSupportsVision,
  CUSTOM_LLM_PROTOCOLS,
  CUSTOM_LLM_PROTOCOL_LABELS,
  getProviderConfigSignature,
  getValidConnectionTests,
  withConnectionTestResult,
  getConfiguredProviders,
  resolveProviderRoute,
  formatProviderRouteLabel,
} from './llm';
export type { ResolvedProviderRoute } from './llm';

export type {
  SyncMode,
  CloudProvider,
  TrashRetentionDays,
  AppLanguage,
  OcrLanguage,
  Settings,
  CustomInstruction,
} from './settings';

export { DEFAULT_SETTINGS } from './settings';
