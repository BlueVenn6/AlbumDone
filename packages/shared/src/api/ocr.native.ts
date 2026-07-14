import type { OcrLanguage } from '../types';

export async function extractTextFromImage(
  _imagePath: string,
  _lang: OcrLanguage = 'chi_sim+eng',
): Promise<string> {
  throw new Error(
    'Mobile local OCR is not bundled. Use screenshot instructions with a configured vision model.',
  );
}
