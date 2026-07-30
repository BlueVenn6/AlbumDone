import type { Photo } from '../types';
import type { LLMClient } from '../api/llmClient';
import type { ScreenshotAnalysis } from '../api/vision';
import { analyzeScreenshot } from '../api/vision';

export type ScreenshotDetectionInput = {
  filename: string;
  width?: number | undefined;
  height?: number | undefined;
  uri?: string | undefined;
  filePath?: string | undefined;
  albumId?: string | undefined;
  fileSize?: number | undefined;
  extension?: string | undefined;
  tags?: string[] | undefined;
};

export type ScreenshotDetectionResult = {
  isScreenshot: boolean;
  confidence: number;
  reasons: string[];
};

// Common screenshot aspect ratios (portrait phone screens)
const SCREENSHOT_ASPECT_RATIOS = [
  { w: 9, h: 19.5 }, // iPhone X/11/12/13/14
  { w: 9, h: 20 }, // Various Android
  { w: 9, h: 16 }, // 16:9 screens
  { w: 3, h: 4 }, // iPad
  { w: 2, h: 3 }, // Older phones
];

// Screenshot filename patterns
const SCREENSHOT_FILENAME_PATTERNS = [
  /^screenshot/i,
  /^screen_shot/i,
  /^screen\s*shot/i,
  /^screen[-_ ]?capture/i,
  /screenshot_\d/i,
  /^img_\d+.*screenshot/i,
  /^capture/i,
  /^snap\d+/i,
  /^\d{4}-\d{2}-\d{2}.*\d{2}\.\d{2}\.\d{2}/i, // macOS date format
  /^screenshot \d{4}-\d{2}-\d{2}/i,
  /^mmexport\d/i, // WeChat exported screenshots (mmexport[timestamp].png)
  /截屏/u,
  /截图/u,
  /截圖/u,
  /螢幕截圖/u,
  /屏幕截图/u,
];

const SCREENSHOT_PATH_PATTERNS = [
  /^screenshots?$/i,
  /^screen\s*shots?$/i,
  /^screen[-_ ]?captures?$/i,
  /screenshot/i,
  /screen\s*shot/i,
  /screen[-_ ]?capture/i,
  /截屏/u,
  /截图/u,
  /截圖/u,
  /螢幕截圖/u,
  /屏幕截图/u,
];

// Common screen resolutions that indicate screenshots
const COMMON_SCREEN_WIDTHS = [
  360, 375, 390, 393, 412, 414, 428, 430, // Phone logical widths
  720, 750, 828, 1080, 1125, 1170, 1240, 1242, 1284, 1440, // Phone pixel widths
  768, 810, 820, 834, 1024, 1112, 1180, 1194, // Tablet widths
  1280, 1366, 1440, 1920, 2560, 3840, // Desktop widths
  640, // Older phone pixel width
];

const COMMON_SCREEN_HEIGHTS = [
  640, 720, 750, 812, 828, 844, 896, 926, 1080, 1125, 1170, 1242, 1284, 1334,
  1366, 1440, 1600, 1624, 1792, 1920, 2208, 2280, 2316, 2340, 2376, 2400, 2412,
  2436, 2532, 2556, 2560, 2688, 2700, 2712, 2772, 2778, 2796, 2960, 3040, 3088,
  3120, 3168, 3200, 3216, 3840,
];

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeText(value: string | undefined): string {
  return safeDecode(value ?? '').toLowerCase();
}

function normalizeExtension(value: string | undefined): string {
  return normalizeText(value).replace(/^\./, '');
}

function splitPathSegments(input: ScreenshotDetectionInput): string[] {
  const sources = [input.filePath, input.albumId, input.uri].filter((value): value is string => Boolean(value));
  const segments: string[] = [];
  for (const source of sources) {
    const normalized = normalizeText(source)
      .replace(/^local-file:\/\/\//i, '')
      .replace(/^local-photo:\/\/\//i, '');
    segments.push(
      ...normalized
        .split(/[\\/]+/)
        .map((segment) => segment.trim())
        .filter(Boolean),
    );
  }
  return segments;
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function detectScreenshotCandidate(input: ScreenshotDetectionInput): ScreenshotDetectionResult {
  const reasons: string[] = [];
  let confidence = 0;
  const filename = normalizeText(input.filename);
  const basename = filename.replace(/\.[^.]+$/, '');

  if (matchesAny(basename, SCREENSHOT_FILENAME_PATTERNS)) {
    confidence += 0.8;
    reasons.push('filename');
  }

  const segments = splitPathSegments(input);
  const pathMatch = segments.some((segment) => matchesAny(segment, SCREENSHOT_PATH_PATTERNS));
  if (pathMatch) {
    confidence += 0.7;
    reasons.push('path');
  }

  const width = Math.max(0, Math.round(input.width ?? 0));
  const height = Math.max(0, Math.round(input.height ?? 0));
  if (width > 0 && height > 0) {
    const portraitRatio = height / width;
    const landscapeRatio = width / height;
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);
    const ratioLooksLikeScreen = SCREENSHOT_ASPECT_RATIOS.some((ratio) => {
      const target = ratio.h / ratio.w;
      return Math.abs(portraitRatio - target) < 0.04 || Math.abs(landscapeRatio - target) < 0.04;
    });
    const hasCommonScreenSide =
      COMMON_SCREEN_WIDTHS.includes(width)
      || COMMON_SCREEN_WIDTHS.includes(height)
      || COMMON_SCREEN_HEIGHTS.includes(width)
      || COMMON_SCREEN_HEIGHTS.includes(height);

    if (ratioLooksLikeScreen && hasCommonScreenSide) {
      confidence += 0.45;
      reasons.push('dimensions');
    } else if (ratioLooksLikeScreen && shortSide >= 720 && longSide >= 1280) {
      confidence += 0.3;
      reasons.push('screen-ratio');
    } else if (hasCommonScreenSide && (portraitRatio > 1.45 || landscapeRatio > 1.45)) {
      confidence += 0.25;
      reasons.push('screen-size');
    }

    const extension = normalizeExtension(input.extension ?? filename.split('.').pop());
    const fileSize = Math.max(0, input.fileSize ?? 0);
    const looksLikePhoneScreen =
      shortSide >= 720
      && shortSide <= 1600
      && longSide >= 1280
      && longSide <= 3400
      && (portraitRatio >= 1.65 || landscapeRatio >= 1.65);
    if (looksLikePhoneScreen && ['png', 'webp'].includes(extension)) {
      confidence += 0.35;
      reasons.push('screen-format');
    }
    if (looksLikePhoneScreen && fileSize > 0 && fileSize <= 2_500_000) {
      confidence += 0.2;
      reasons.push('screen-file-size');
    }
  }

  if (input.tags?.some((tag) => normalizeText(tag).includes('screenshot'))) {
    confidence += 0.5;
    reasons.push('tag');
  }

  const cappedConfidence = Math.min(1, confidence);
  return {
    isScreenshot: cappedConfidence >= 0.65,
    confidence: cappedConfidence,
    reasons,
  };
}

/**
 * Detect if a photo is a screenshot based on heuristics:
 * 1. Filename patterns
 * 2. Aspect ratio matching common screen ratios
 * 3. Resolution matching known screen sizes
 * 4. Album/source metadata
 */
export function isScreenshot(photo: Photo): boolean {
  return detectScreenshotCandidate({
    filename: photo.filename,
    width: photo.width,
    height: photo.height,
    uri: photo.uri,
    albumId: photo.albumId,
    fileSize: photo.fileSize,
    extension: photo.extension,
    tags: photo.tags,
  }).isScreenshot;
}

/**
 * Classify a screenshot using LLM vision.
 * Wraps the vision API analyzeScreenshot function.
 */
export async function classifyScreenshot(
  imageBase64: string,
  client: LLMClient,
): Promise<ScreenshotAnalysis> {
  return analyzeScreenshot(imageBase64, 'image/jpeg', client);
}

/**
 * Filter screenshots from a list of photos.
 */
export function filterScreenshots(photos: Photo[]): Photo[] {
  return photos.filter((p) => p.isScreenshot || isScreenshot(p));
}

/**
 * Filter non-screenshot photos from a list.
 */
export function filterNonScreenshots(photos: Photo[]): Photo[] {
  return photos.filter((p) => !p.isScreenshot && !isScreenshot(p));
}

/**
 * Batch-detect screenshots and return an updated photo list.
 */
export function detectScreenshots(photos: Photo[]): Photo[] {
  return photos.map((photo) => ({
    ...photo,
    isScreenshot: photo.isScreenshot || isScreenshot(photo),
  }));
}
