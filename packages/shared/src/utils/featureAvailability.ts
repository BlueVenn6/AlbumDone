import type { Settings } from '../types';

export type FeatureAvailability = {
  ocr: true;
  translation: boolean;
  summarization: boolean;
  customInstruction: boolean;
};

/**
 * Derive which screenshot features are available given the current user config.
 * OCR is always available (Tesseract.js runs offline).
 * Translation requires DeepL key OR an LLM key.
 * Summarization and custom instructions require an LLM key.
 */
export function getFeatureAvailability(settings: Settings): FeatureAvailability {
  const visionProvider = settings.defaultVisionProvider;
  const textProvider = settings.defaultTextProvider;
  const deeplApiKey = settings.deeplApiKey?.trim();

  const hasLLMKey = Boolean(
    (visionProvider &&
      (settings.providers[visionProvider]?.apiKey ||
        settings.providers[visionProvider]?.hasApiKey)) ||
      (textProvider &&
        (settings.providers[textProvider]?.apiKey ||
          settings.providers[textProvider]?.hasApiKey)) ||
      Object.values(settings.providers).some((provider) =>
        Boolean(provider?.apiKey?.trim() || provider?.hasApiKey),
      ),
  );

  return {
    ocr: true,
    translation: Boolean(deeplApiKey) || hasLLMKey,
    summarization: hasLLMKey,
    customInstruction: hasLLMKey,
  };
}
