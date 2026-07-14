import type { OcrLanguage } from '../types';

type ElectronAPI = {
  ocr?: {
    extractText?: (imagePath: string, lang?: string) => Promise<unknown>;
  };
};

type RNTesseractModule = {
  recognize?: (imagePath: string, lang: string) => Promise<unknown>;
  default?: {
    recognize?: (imagePath: string, lang: string) => Promise<unknown>;
  };
};

function resolveElectronApi(): ElectronAPI | null {
  const globalScope = globalThis as {
    electronAPI?: ElectronAPI;
    window?: { electronAPI?: ElectronAPI };
  };
  return globalScope.electronAPI ?? globalScope.window?.electronAPI ?? null;
}

function isReactNativeRuntime(): boolean {
  const globalScope = globalThis as { navigator?: { product?: string } };
  return globalScope.navigator?.product === 'ReactNative';
}

function normalizeExtractedText(result: unknown): string {
  if (typeof result === 'string') {
    return result.trim();
  }

  if (result && typeof result === 'object' && 'text' in result) {
    const text = (result as { text?: unknown }).text;
    if (typeof text === 'string') {
      return text.trim();
    }
  }

  return String(result ?? '').trim();
}

function sanitizeReactNativeOcrLanguage(lang?: OcrLanguage): string {
  if (lang === 'eng') {
    return 'eng';
  }

  if (lang === 'jpn+eng') {
    return 'jpn+eng';
  }

  return 'chi_sim+eng';
}

export async function extractTextFromImage(
  imagePath: string,
  lang: OcrLanguage = 'chi_sim+eng',
): Promise<string> {
  try {
    const electronApi = resolveElectronApi();
    const ipcExtract = electronApi?.ocr?.extractText;

    if (typeof ipcExtract === 'function') {
      const result = await ipcExtract(imagePath, lang);
      return normalizeExtractedText(result);
    }

    if (isReactNativeRuntime()) {
      const moduleName = 'react-native-tesseract-ocr';
      const moduleRef = (await import(moduleName)) as RNTesseractModule;
      const recognize = moduleRef.default?.recognize ?? moduleRef.recognize;

      if (typeof recognize !== 'function') {
        throw new Error('react-native-tesseract-ocr is unavailable');
      }

      const sanitizedLanguage = sanitizeReactNativeOcrLanguage(lang);
      const result = await recognize(imagePath, sanitizedLanguage);
      return normalizeExtractedText(result);
    }

    const { extractTextFromImage: extractTextWithTesseractJs } = await import('../utils/ocr');
    return await extractTextWithTesseractJs(imagePath, lang);
  } catch (err) {
    throw new Error(
      `OCR extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
