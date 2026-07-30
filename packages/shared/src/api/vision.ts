import type { Photo } from '../types';
import { LLMClient, type LLMRequestOptions } from './llmClient';
import { getResolvedLocale } from '../i18n';

export type ScreenshotType =
  | 'verification_code'
  | 'payment'
  | 'chat'
  | 'article'
  | 'ui_design'
  | 'unknown';

export type ScreenshotAnalysis = {
  type: ScreenshotType;
  suggestedAction: string;
  confidence: number;
};

export type CullingPreprocessResult = {
  keep: string[];
  delete: string[];
  uncertain: string[];
};

export type VisionLanguage = 'en' | 'zh-Hans' | 'zh-Hant';
type VisionLanguageName = 'English' | 'Simplified Chinese' | 'Traditional Chinese';
type VisionErrorKey = 'screenshotFailed' | 'instructionFailed' | 'cullingFailed' | 'bestPhotoFailed';

const SCREENSHOT_CLASSIFICATION_PROMPT = `You are analyzing a screenshot. Classify it into one of these categories:
- verification_code: Contains OTP, verification codes, SMS codes
- payment: Payment confirmations, receipts, transaction records
- chat: Chat messages, conversations, social media posts
- article: Articles, long-form text, blog posts, news
- ui_design: App screenshots, UI mockups, design references
- unknown: None of the above

Respond in JSON format:
{
  "type": "<category>",
  "suggestedAction": "<one sentence describing what to do with this screenshot>",
  "confidence": <0.0-1.0>
}

Only respond with the JSON, no other text.`;

const CULLING_PROMPT = `You are a photo culling assistant. Analyze the following photos and classify each as:
- keep: Good quality, in focus, well-exposed, worth keeping
- delete: Blurry, poorly exposed, accidental shot, duplicate scene
- uncertain: Borderline quality, needs human review

Return a JSON object with three arrays of photo IDs:
{
  "keep": ["id1", "id2"],
  "delete": ["id3"],
  "uncertain": ["id4", "id5"]
}

Photos to analyze (metadata only, no images provided for batch):
PHOTOS_JSON

Base your decision on: filename patterns, file size (very small = likely bad),
and any quality metadata provided.`;

const RESPONSE_LANGUAGE_MAP: Record<string, VisionLanguageName> = {
  en: 'English',
  'zh-hans': 'Simplified Chinese',
  'zh-hant': 'Traditional Chinese',
};

const TRANSLATION_SIGNAL_PATTERNS = [
  /translate/i,
  /翻译/u,
];

const EXPLICIT_TARGET_LANGUAGE_PATTERNS = [
  /\b(?:into|to)\s+(?:simplified chinese|traditional chinese|chinese|english)\b/i,
  /\b(?:respond|reply|output)\s+(?:in|with)\s+(?:simplified chinese|traditional chinese|chinese|english)\b/i,
  /(?:成|到|为|為)\s*(?:简体中文|繁體中文|中文|英文|英语|英語)/u,
];

function resolveUserLanguageName(languageCode: string | undefined): VisionLanguageName {
  const normalized = (languageCode ?? 'en').toLowerCase();
  if (normalized === 'zh' || normalized === 'zh-cn' || normalized === 'zh-sg' || normalized === 'zh-hans') {
    return 'Simplified Chinese';
  }
  if (normalized === 'zh-tw' || normalized === 'zh-hk' || normalized === 'zh-mo' || normalized === 'zh-hant') {
    return 'Traditional Chinese';
  }
  return RESPONSE_LANGUAGE_MAP[normalized] ?? 'English';
}

function resolveLocalizedError(
  languageCode: string | undefined,
  key: VisionErrorKey,
  detail: string,
): string {
  const languageName = resolveUserLanguageName(languageCode);
  const copy: Record<VisionErrorKey, Record<VisionLanguageName, string>> = {
    screenshotFailed: {
      English: `AI screenshot analysis failed: ${detail}`,
      'Simplified Chinese': `AI 截图分析失败：${detail}`,
      'Traditional Chinese': `AI 截圖分析失敗：${detail}`,
    },
    instructionFailed: {
      English: `AI instruction failed: ${detail}`,
      'Simplified Chinese': `AI 指令处理失败：${detail}`,
      'Traditional Chinese': `AI 指令處理失敗：${detail}`,
    },
    cullingFailed: {
      English: `AI culling pre-processing failed: ${detail}`,
      'Simplified Chinese': `AI 筛选预处理失败：${detail}`,
      'Traditional Chinese': `AI 篩選預處理失敗：${detail}`,
    },
    bestPhotoFailed: {
      English: `AI best-photo selection failed: ${detail}`,
      'Simplified Chinese': `AI 选图失败：${detail}`,
      'Traditional Chinese': `AI 選圖失敗：${detail}`,
    },
  };
  return copy[key][languageName] ?? copy[key].English;
}

function resolveManualReviewLabel(languageCode: string | undefined): string {
  const languageName = resolveUserLanguageName(languageCode);
  if (languageName === 'Simplified Chinese') return '手动查看';
  if (languageName === 'Traditional Chinese') return '手動檢視';
  return 'Review manually';
}

function resolveTryAgainLaterLabel(languageCode: string | undefined): string {
  const languageName = resolveUserLanguageName(languageCode);
  if (languageName === 'Simplified Chinese') return '请稍后重试';
  if (languageName === 'Traditional Chinese') return '請稍後重試';
  return 'Please try again later';
}

function instructionDefinesOutputLanguage(instruction: string): boolean {
  if (TRANSLATION_SIGNAL_PATTERNS.some((pattern) => pattern.test(instruction))) {
    return true;
  }
  return EXPLICIT_TARGET_LANGUAGE_PATTERNS.some((pattern) => pattern.test(instruction));
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

export async function analyzeScreenshot(
  imageBase64: string,
  mimeType: string,
  client: LLMClient,
  languageCode?: VisionLanguage | string,
): Promise<ScreenshotAnalysis> {
  let response;
  try {
    response = await client.chatWithImage(
      SCREENSHOT_CLASSIFICATION_PROMPT,
      imageBase64,
      mimeType,
      { temperature: 0, maxTokens: 256 },
    );
  } catch (err) {
    throw new Error(resolveLocalizedError(
      languageCode,
      'screenshotFailed',
      getErrorMessage(err, resolveTryAgainLaterLabel(languageCode)),
    ));
  }

  try {
    const cleaned = response.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as {
      type: ScreenshotType;
      suggestedAction: string;
      confidence: number;
    };
    return {
      type: parsed.type ?? 'unknown',
      suggestedAction: parsed.suggestedAction ?? '',
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0)),
    };
  } catch {
    return {
      type: 'unknown',
      suggestedAction: resolveManualReviewLabel(languageCode),
      confidence: 0,
    };
  }
}

export async function executeInstruction(
  imageBase64: string,
  mimeType: string,
  instruction: string,
  client: LLMClient,
  languageCode?: VisionLanguage | string,
  requestOptions: Pick<LLMRequestOptions, 'signal' | 'timeoutMs'> = {},
): Promise<string> {
  const effectiveLanguageCode = languageCode ?? getResolvedLocale();
  const userLanguage = resolveUserLanguageName(effectiveLanguageCode);
  const hasExplicitLanguageTarget = instructionDefinesOutputLanguage(instruction);
  const languageDirective = hasExplicitLanguageTarget
    ? ''
    : `\n\nIMPORTANT: You must respond in ${userLanguage}. Do not use any other language for your response.`;
  const prompt = `Please analyze this screenshot and ${instruction}. Provide a clear, concise response.${languageDirective}`;
  let response;
  try {
    response = await client.chatWithImage(prompt, imageBase64, mimeType, {
      temperature: 0.3,
      maxTokens: 1024,
      ...requestOptions,
    });
  } catch (err) {
    throw new Error(resolveLocalizedError(
      effectiveLanguageCode,
      'instructionFailed',
      getErrorMessage(err, resolveTryAgainLaterLabel(effectiveLanguageCode)),
    ));
  }
  return response.content;
}

export async function preProcessForCulling(
  photos: Photo[],
  client: LLMClient,
  languageCode?: VisionLanguage | string,
): Promise<CullingPreprocessResult> {
  const photoSummaries = photos.map((p) => ({
    id: p.id,
    filename: p.filename,
    fileSize: p.fileSize,
    width: p.width,
    height: p.height,
    quality: p.quality,
  }));

  const prompt = CULLING_PROMPT.replace(
    'PHOTOS_JSON',
    JSON.stringify(photoSummaries, null, 2),
  );

  let response;
  try {
    response = await client.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0, maxTokens: 2048 },
    );
  } catch (err) {
    throw new Error(resolveLocalizedError(
      languageCode,
      'cullingFailed',
      getErrorMessage(err, resolveTryAgainLaterLabel(languageCode)),
    ));
  }

  try {
    const cleaned = response.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as CullingPreprocessResult;
    return {
      keep: Array.isArray(parsed.keep) ? parsed.keep : [],
      delete: Array.isArray(parsed.delete) ? parsed.delete : [],
      uncertain: Array.isArray(parsed.uncertain) ? parsed.uncertain : [],
    };
  } catch {
    // If parsing fails, mark everything as uncertain
    return {
      keep: [],
      delete: [],
      uncertain: photos.map((p) => p.id),
    };
  }
}

export async function selectBestFromGroup(
  photos: Photo[],
  client: LLMClient,
  languageCode?: VisionLanguage | string,
): Promise<string> {
  if (photos.length === 0) throw new Error('No photos provided');
  if (photos.length === 1) return photos[0]!.id;

  const prompt = `Given these duplicate photos, which one is the best to keep?
Consider: technical quality (sharpness, exposure), composition, and metadata.

Photos:
${JSON.stringify(
  photos.map((p) => ({
    id: p.id,
    filename: p.filename,
    fileSize: p.fileSize,
    width: p.width,
    height: p.height,
    quality: p.quality,
  })),
  null,
  2,
)}

Respond with just the ID of the best photo and a brief reason:
{"id": "<photo_id>", "reason": "<brief reason>"}`;

  let response;
  try {
    response = await client.chat(
      [{ role: 'user', content: prompt }],
      { temperature: 0, maxTokens: 256 },
    );
  } catch (err) {
    throw new Error(resolveLocalizedError(
      languageCode,
      'bestPhotoFailed',
      getErrorMessage(err, resolveTryAgainLaterLabel(languageCode)),
    ));
  }

  try {
    const cleaned = response.content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    const parsed = JSON.parse(cleaned) as { id: string; reason: string };
    const found = photos.find((p) => p.id === parsed.id);
    if (found) return found.id;
  } catch {
    // Fall through to default
  }

  // Default: pick the photo with highest file size as fallback
  const sorted = [...photos].sort((a, b) => b.fileSize - a.fileSize);
  return sorted[0]!.id;
}
