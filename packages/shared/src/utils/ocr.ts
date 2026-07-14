import type { OcrLanguage } from '../types';

const OCR_LANG_MAP: Record<OcrLanguage, string> = {
  'chi_sim+eng': 'chi_sim+eng',
  'eng': 'eng',
  'jpn+eng': 'jpn+eng',
  'auto': 'chi_sim+eng+jpn', // best-effort multi-language auto
};

/**
 * Extract text from an image using Tesseract.js (fully offline, no API key).
 * @param source  A local file path, a `local-file://` URL, or a base64 data URI.
 * @param lang    OCR language pack from OcrLanguage — defaults to chi_sim+eng.
 */
export async function extractTextFromImage(
  source: string,
  lang: OcrLanguage = 'chi_sim+eng',
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const tesseractLang = OCR_LANG_MAP[lang];
  const worker = await createWorker(tesseractLang);
  try {
    const { data: { text } } = await worker.recognize(source);
    return text.trim();
  } finally {
    await worker.terminate();
  }
}
