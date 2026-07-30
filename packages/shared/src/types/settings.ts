import type { LLMProvider, ProviderConfig } from './llm';

export type SyncMode = 'local' | 'cloud';
export type CloudProvider = 'icloud' | 'gdrive' | 'notion' | 'obsidian';
export type TrashRetentionDays = 7 | 14 | 30;
export type AppLanguage = 'system' | 'en' | 'zh-Hans' | 'zh-Hant';
export type OcrLanguage = 'chi_sim+eng' | 'eng' | 'jpn+eng' | 'auto';

export type Settings = {
  providers: Partial<Record<LLMProvider, ProviderConfig>>;
  defaultVisionProvider: LLMProvider | null;
  defaultTextProvider: LLMProvider | null;
  syncMode: SyncMode;
  cloudProvider?: CloudProvider;
  cloudConfig?: Record<string, string>;
  trashRetentionDays: TrashRetentionDays;
  language: AppLanguage;
  customInstructions: CustomInstruction[];
  deeplApiKey?: string;
  ocrLanguage?: OcrLanguage;
};

export type CustomInstruction = {
  id: string;
  name: string;
  prompt: string;
  createdAt: number;
};

export const DEFAULT_SETTINGS: Settings = {
  providers: {},
  defaultVisionProvider: null,
  defaultTextProvider: null,
  syncMode: 'local',
  trashRetentionDays: 30,
  language: 'system',
  customInstructions: [],
  ocrLanguage: 'chi_sim+eng',
};
