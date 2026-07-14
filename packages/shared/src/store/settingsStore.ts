import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { getSettingsStorage } from './settingsStorage';
import type {
  Settings,
  LLMProvider,
  ProviderConfig,
  SyncMode,
  CloudProvider,
  TrashRetentionDays,
  AppLanguage,
  OcrLanguage,
  CustomInstruction,
} from '../types';
import { DEFAULT_SETTINGS, configSupportsVision } from '../types';

function createRuntimeProviderConfig(config: ProviderConfig): ProviderConfig {
  const trimmedApiKey = config.apiKey?.trim();

  return {
    provider: config.provider,
    model: config.model,
    ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
    ...(config.baseUrl?.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
    hasApiKey: Boolean(trimmedApiKey || config.hasApiKey),
    mode: config.mode ?? 'direct',
    supportsVision: configSupportsVision({
      ...config,
      mode: config.mode ?? 'direct',
    }),
  };
}

function sanitizeProviderConfigForPersistence(
  provider: LLMProvider,
  config: ProviderConfig,
): ProviderConfig {
  return {
    provider,
    model: config.model,
    hasApiKey: Boolean(config.apiKey?.trim() || config.hasApiKey),
    mode: config.mode ?? 'direct',
    ...(config.baseUrl?.trim() ? { baseUrl: config.baseUrl.trim() } : {}),
    supportsVision: configSupportsVision({
      ...config,
      provider,
      mode: config.mode ?? 'direct',
    }),
  };
}

export interface SettingsState extends Settings {
  // Actions
  updateProvider: (provider: LLMProvider, config: ProviderConfig) => void;
  removeProvider: (provider: LLMProvider) => void;
  setDefaultVisionProvider: (provider: LLMProvider | null) => void;
  setDefaultTextProvider: (provider: LLMProvider | null) => void;
  updateSyncMode: (mode: SyncMode) => void;
  updateCloudProvider: (provider: CloudProvider) => void;
  updateTrashRetention: (days: TrashRetentionDays) => void;
  updateLanguage: (lang: AppLanguage) => void;
  addCustomInstruction: (instruction: Omit<CustomInstruction, 'id' | 'createdAt'>) => void;
  removeCustomInstruction: (id: string) => void;
  updateCustomInstruction: (
    id: string,
    updates: Partial<Omit<CustomInstruction, 'id' | 'createdAt'>>,
  ) => void;
  updateDeeplApiKey: (key: string) => void;
  updateOcrLanguage: (lang: OcrLanguage) => void;
  resetToDefaults: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    immer((set) => ({
      ...DEFAULT_SETTINGS,

      updateProvider: (provider, config) =>
        set((state) => {
          state.providers[provider] = createRuntimeProviderConfig({
            ...config,
            provider,
          });
          const savedConfig = state.providers[provider];
          if (configSupportsVision(savedConfig)) {
            state.defaultVisionProvider ??= provider;
          } else if (state.defaultVisionProvider === provider) {
            state.defaultVisionProvider = null;
          }
          state.defaultTextProvider ??= provider;
        }),

      removeProvider: (provider) =>
        set((state) => {
          delete state.providers[provider];
          if (state.defaultVisionProvider === provider) {
            state.defaultVisionProvider = null;
          }
          if (state.defaultTextProvider === provider) {
            state.defaultTextProvider = null;
          }
        }),

      setDefaultVisionProvider: (provider) =>
        set((state) => {
          state.defaultVisionProvider = provider;
        }),

      setDefaultTextProvider: (provider) =>
        set((state) => {
          state.defaultTextProvider = provider;
        }),

      updateSyncMode: (mode) =>
        set((state) => {
          state.syncMode = mode;
        }),

      updateCloudProvider: (provider) =>
        set((state) => {
          state.cloudProvider = provider;
        }),

      updateTrashRetention: (days) =>
        set((state) => {
          state.trashRetentionDays = days;
        }),

      updateLanguage: (lang) =>
        set((state) => {
          state.language = lang;
        }),

      addCustomInstruction: (instruction) =>
        set((state) => {
          const newInstruction: CustomInstruction = {
            ...instruction,
            id: `instruction_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            createdAt: Date.now(),
          };
          state.customInstructions.push(newInstruction);
        }),

      removeCustomInstruction: (id) =>
        set((state) => {
          state.customInstructions = state.customInstructions.filter(
            (i) => i.id !== id,
          );
        }),

      updateCustomInstruction: (id, updates) =>
        set((state) => {
          const idx = state.customInstructions.findIndex((i) => i.id === id);
          if (idx !== -1) {
            Object.assign(state.customInstructions[idx]!, updates);
          }
        }),

      updateDeeplApiKey: (key) =>
        set((state) => {
          const trimmedKey = key.trim();
          if (trimmedKey) {
            state.deeplApiKey = trimmedKey;
          } else {
            delete state.deeplApiKey;
          }
        }),

      updateOcrLanguage: (lang) =>
        set((state) => {
          state.ocrLanguage = lang;
        }),

      resetToDefaults: () =>
        set((state) => {
          state.providers = {};
          state.defaultVisionProvider = DEFAULT_SETTINGS.defaultVisionProvider;
          state.defaultTextProvider = DEFAULT_SETTINGS.defaultTextProvider;
          state.syncMode = DEFAULT_SETTINGS.syncMode;
          delete state.cloudProvider;
          delete state.cloudConfig;
          state.trashRetentionDays = DEFAULT_SETTINGS.trashRetentionDays;
          state.language = DEFAULT_SETTINGS.language;
          state.customInstructions = [...DEFAULT_SETTINGS.customInstructions];
          state.ocrLanguage = DEFAULT_SETTINGS.ocrLanguage ?? 'chi_sim+eng';
          delete state.deeplApiKey;
        }),
    })),
    {
      name: 'photo-manager-settings',
      onRehydrateStorage: () => (_state, error) => {
        if (error) return;
        const currentState = useSettingsStore.getState();
        const nextProviders: Partial<Record<LLMProvider, ProviderConfig>> = {};

        for (const [key, rawConfig] of Object.entries(currentState.providers)) {
          const provider = key as LLMProvider;
          const config = rawConfig;
          if (!config) continue;

          nextProviders[provider] = sanitizeProviderConfigForPersistence(provider, config);
        }

        useSettingsStore.setState((state) => {
          state.providers = nextProviders;
          state.language = DEFAULT_SETTINGS.language;
          if (state.deeplApiKey) {
            delete state.deeplApiKey;
          }
          if (
            state.defaultVisionProvider &&
            (
              !state.providers[state.defaultVisionProvider]
              || !configSupportsVision(state.providers[state.defaultVisionProvider])
            )
          ) {
            state.defaultVisionProvider = null;
          }
          if (
            state.defaultTextProvider &&
            !state.providers[state.defaultTextProvider]
          ) {
            state.defaultTextProvider = null;
          }

          state.defaultVisionProvider ??= Object.entries(state.providers).find(
            ([, config]) => configSupportsVision(config),
          )?.[0] as LLMProvider | undefined ?? null;
          state.defaultTextProvider ??= Object.keys(state.providers)[0] as LLMProvider | undefined ?? null;
        });
      },
      partialize: (state) => ({
        providers: Object.fromEntries(
          Object.entries(state.providers).flatMap(([key, config]) => {
            if (!config) {
              return [];
            }
            return [[key, sanitizeProviderConfigForPersistence(key as LLMProvider, config)]];
          }),
        ),
        defaultVisionProvider: state.defaultVisionProvider,
        defaultTextProvider: state.defaultTextProvider,
        trashRetentionDays: state.trashRetentionDays,
        customInstructions: state.customInstructions,
        ocrLanguage: state.ocrLanguage,
      }),
      storage: createJSONStorage(() => getSettingsStorage()),
    },
  ),
);

// Selector helpers
export const selectVisionClient = (state: SettingsState) => {
  const provider = state.defaultVisionProvider;
  if (!provider) return null;
  const config = state.providers[provider] ?? null;
  if (!config?.apiKey?.trim()) return null;
  return config;
};

export const selectTextClient = (state: SettingsState) => {
  const provider = state.defaultTextProvider;
  if (!provider) return null;
  const config = state.providers[provider] ?? null;
  if (!config?.apiKey?.trim()) return null;
  return config;
};
