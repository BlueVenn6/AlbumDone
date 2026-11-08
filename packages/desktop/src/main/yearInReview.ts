import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  buildReviewMonths, getReviewSummary, getYearReviewMonthIds, initI18n, i18next,
  localFileUriToPath, normalizeLocale, pathToLocalFileUri, pickMonthEncouragements,
  selectMonthlyReviewPhotos, type MonthlyReviewPhoto, type ReviewMonth,
  type YearInReviewResult, type YearReviewTimeMode,
} from '@photo-manager/shared';

type YearInReviewInputPhoto = {
  uri: string; filename: string; timestamp?: number; width?: number; height?: number;
  fileSize?: number; isScreenshot?: boolean; thumbnailUri?: string;
};

function readFileHead(filePath: string, maxBytes: number): Buffer {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stats = fs.fstatSync(fd);
    const readLength = Math.max(0, Math.min(maxBytes, stats.size));
    if (readLength === 0) {
      return Buffer.alloc(0);
    }

    const buffer = Buffer.allocUnsafe(readLength);
    const bytesRead = fs.readSync(fd, buffer, 0, readLength, 0);
    return bytesRead === readLength ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function readExifUInt16(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
}

function readExifUInt32(buffer: Buffer, offset: number, littleEndian: boolean): number {
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

type ExifTagEntry = {
  entryOffset: number;
  type: number;
  count: number;
  valueOrOffset: number;
};

type ExifMetadata = {
  hasLocationMetadata: boolean;
  dateTimeOriginal: Date | null;
};

function parseExifDateTimeOriginal(raw: string): Date | null {
  const match = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText) {
    return null;
  }

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);
  const hour = Number.parseInt(hourText, 10);
  const minute = Number.parseInt(minuteText, 10);
  const second = Number.parseInt(secondText, 10);

  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function readIfdTagEntry(
  buffer: Buffer,
  ifdAbsoluteOffset: number,
  tagToFind: number,
  littleEndian: boolean,
  segmentEnd: number,
): ExifTagEntry | null {
  if (ifdAbsoluteOffset + 2 > segmentEnd || ifdAbsoluteOffset + 2 > buffer.length) {
    return null;
  }

  const entryCount = readExifUInt16(buffer, ifdAbsoluteOffset, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdAbsoluteOffset + 2 + (index * 12);
    if (entryOffset + 12 > segmentEnd || entryOffset + 12 > buffer.length) {
      return null;
    }

    const tag = readExifUInt16(buffer, entryOffset, littleEndian);
    if (tag !== tagToFind) {
      continue;
    }

    return {
      entryOffset,
      type: readExifUInt16(buffer, entryOffset + 2, littleEndian),
      count: readExifUInt32(buffer, entryOffset + 4, littleEndian),
      valueOrOffset: readExifUInt32(buffer, entryOffset + 8, littleEndian),
    };
  }

  return null;
}

function readAsciiTagValue(
  buffer: Buffer,
  tiffOffset: number,
  entry: ExifTagEntry,
  segmentEnd: number,
): string | null {
  if (entry.type !== 2 || entry.count === 0) {
    return null;
  }

  let valueStart = entry.entryOffset + 8;
  let valueEnd = valueStart + entry.count;

  if (entry.count > 4) {
    valueStart = tiffOffset + entry.valueOrOffset;
    valueEnd = valueStart + entry.count;
  }

  if (valueStart < 0 || valueEnd > segmentEnd || valueEnd > buffer.length) {
    return null;
  }

  return buffer.toString('ascii', valueStart, valueEnd).replace(/\0+$/, '');
}

function extractExifMetadataFromTiff(buffer: Buffer, tiffOffset: number, segmentEnd: number): ExifMetadata {
  const empty: ExifMetadata = { hasLocationMetadata: false, dateTimeOriginal: null };
  if (tiffOffset + 8 > segmentEnd || tiffOffset + 8 > buffer.length) {
    return empty;
  }

  const byteOrder = buffer.toString('ascii', tiffOffset, tiffOffset + 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') {
    return empty;
  }

  const ifd0Offset = readExifUInt32(buffer, tiffOffset + 4, littleEndian);
  const ifd0AbsoluteOffset = tiffOffset + ifd0Offset;
  const gpsEntry = readIfdTagEntry(buffer, ifd0AbsoluteOffset, 0x8825, littleEndian, segmentEnd);
  const hasLocationMetadata = Boolean(
    gpsEntry
    && gpsEntry.valueOrOffset > 0
    && (tiffOffset + gpsEntry.valueOrOffset + 2) <= segmentEnd
    && (tiffOffset + gpsEntry.valueOrOffset + 2) <= buffer.length,
  );

  let dateTimeOriginal: Date | null = null;
  const exifPointerEntry = readIfdTagEntry(buffer, ifd0AbsoluteOffset, 0x8769, littleEndian, segmentEnd);
  if (exifPointerEntry && exifPointerEntry.valueOrOffset > 0) {
    const exifIfdAbsoluteOffset = tiffOffset + exifPointerEntry.valueOrOffset;
    const dateEntry = readIfdTagEntry(buffer, exifIfdAbsoluteOffset, 0x9003, littleEndian, segmentEnd);
    if (dateEntry) {
      const rawDate = readAsciiTagValue(buffer, tiffOffset, dateEntry, segmentEnd);
      if (rawDate) {
        dateTimeOriginal = parseExifDateTimeOriginal(rawDate);
      }
    }
  }

  return { hasLocationMetadata, dateTimeOriginal };
}

function extractExifMetadata(fileBuffer: Buffer): ExifMetadata {
  if (fileBuffer.length < 4 || fileBuffer[0] !== 0xff || fileBuffer[1] !== 0xd8) {
    return { hasLocationMetadata: false, dateTimeOriginal: null };
  }

  let offset = 2;
  while (offset + 4 <= fileBuffer.length) {
    if (fileBuffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = fileBuffer[offset + 1];
    offset += 2;

    if (marker === 0xda || marker === 0xd9) {
      break;
    }

    if (offset + 2 > fileBuffer.length) {
      break;
    }

    const segmentLength = fileBuffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > fileBuffer.length) {
      break;
    }

    if (
      marker === 0xe1
      && segmentLength >= 10
      && fileBuffer.toString('ascii', offset + 2, offset + 8) === 'Exif\u0000\u0000'
    ) {
      return extractExifMetadataFromTiff(fileBuffer, offset + 8, offset + segmentLength);
    }

    offset += segmentLength;
  }

  return { hasLocationMetadata: false, dateTimeOriginal: null };
}

function extractJpegResolution(fileBuffer: Buffer): number {
  if (fileBuffer.length < 4 || fileBuffer[0] !== 0xff || fileBuffer[1] !== 0xd8) {
    return 0;
  }

  let offset = 2;
  while (offset + 9 < fileBuffer.length) {
    if (fileBuffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = fileBuffer[offset + 1];
    if (!marker || marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    if (marker === 0xda || offset + 4 > fileBuffer.length) {
      break;
    }

    const segmentLength = fileBuffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > fileBuffer.length) {
      break;
    }

    const isStartOfFrame =
      marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc;

    if (isStartOfFrame) {
      return fileBuffer.readUInt16BE(offset + 5) * fileBuffer.readUInt16BE(offset + 7);
    }

    offset += 2 + segmentLength;
  }

  return 0;
}

function extractImageResolution(fileBuffer: Buffer): number {
  if (fileBuffer.length >= 24 && fileBuffer.toString('ascii', 1, 4) === 'PNG') {
    return fileBuffer.readUInt32BE(16) * fileBuffer.readUInt32BE(20);
  }

  if (fileBuffer.length >= 10 && fileBuffer.toString('ascii', 0, 3) === 'GIF') {
    return fileBuffer.readUInt16LE(6) * fileBuffer.readUInt16LE(8);
  }

  return extractJpegResolution(fileBuffer);
}


/** Metadata stays local. Capture date takes precedence over file modification date. */
export async function prepareYearReview(
  photos: YearInReviewInputPhoto[], timeMode: YearReviewTimeMode = 'rolling',
  localeTag = 'en', now = new Date(),
): Promise<ReviewMonth[]> {
  const monthIds = getYearReviewMonthIds(timeMode, now);
  const candidates: MonthlyReviewPhoto[] = [];
  for (const input of photos) {
    const filePath = localFileUriToPath(input.uri);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      const header = readFileHead(filePath, 65536);
      const exif = extractExifMetadata(header);
      const timestamp = exif.dateTimeOriginal?.getTime() ?? input.timestamp ?? stat.mtimeMs;
      if (!Number.isFinite(timestamp) || timestamp > now.getTime()) continue;
      candidates.push({
        ...input, id: filePath, uri: pathToLocalFileUri(filePath),
        timestamp, ...(exif.dateTimeOriginal ? { capturedAt: exif.dateTimeOriginal.getTime() } : {}),
        width: input.width ?? 0, height: input.height ?? 0,
        fileSize: stat.size, isScreenshot: input.isScreenshot === true,
        tags: [], albumId: path.dirname(filePath),
      });
    } catch (error) {
      // A changed/unreadable library item cannot represent a month.
      console.warn('Year review skipped an unreadable photo:', filePath, String(error));
    }
  }
  const start = monthIds[0]!;
  const selections = selectMonthlyReviewPhotos(candidates, {
    startDate: new Date(Math.floor(start / 12), start % 12, 1),
    months: monthIds.length, now, allowLowConfidence: true,
  });
  return buildReviewMonths(selections, monthIds, pickMonthEncouragements(localeTag, monthIds.length));
}

function wrapText(context: any, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  // Segment at words where possible; break a single overlong word by graphemes.
  const words = text.match(/\S+\s*|\s+/gu) ?? [''];
  for (const word of words) {
    if (context.measureText(line + word).width <= maxWidth) { line += word; continue; }
    if (line.trim()) { lines.push(line.trim()); line = ''; }
    for (const { segment } of new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }).segment(word)) {
      if (context.measureText(line + segment).width > maxWidth && line) {
        lines.push(line.trim()); line = '';
      }
      line += segment;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// Skia's generic sans-serif resolves differently from Chromium on Windows.
// Name the installed text families explicitly so CJK glyphs use text fonts.
function reviewFont(locale: string, size: number, bold = false): string {
  const cjk = locale === 'ja' ? '"Yu Gothic", "Meiryo", "Microsoft YaHei"'
    : locale === 'ko' ? '"Malgun Gothic", "Microsoft YaHei"'
      : locale === 'zh-Hant' ? '"Microsoft JhengHei", "Microsoft YaHei"'
        : '"Microsoft YaHei", "Microsoft JhengHei"';
  return `${bold ? 'bold ' : ''}${size}px "Segoe UI", ${cjk}, "Arial", sans-serif`;
}

/** Render the exact choices currently shown in the editor, without selecting again. */
export async function exportYearReview(
  months: ReviewMonth[], outputDir: string, localeTag = 'en',
): Promise<YearInReviewResult> {
  const locale = normalizeLocale(localeTag);
  await initI18n(locale);
  if (months.length !== 12 || new Set(months.map(m => m.monthId)).size !== 12 ||
      months.some((m, i) => !Number.isInteger(m.monthId) || (i > 0 && m.monthId !== months[i - 1]!.monthId + 1))) {
    throw new Error('A review must contain twelve consecutive months.');
  }
  if (!months.some(month => month.photo)) throw new Error(i18next.t('yearInReview.noPhotosInRange'));
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const cardWidth = 360, cardHeight = 340, gap = 16, margin = 24, heading = 64;
  const width = margin * 2 + 4 * cardWidth + 3 * gap;
  const height = heading + margin + 3 * cardHeight + 2 * gap + margin;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2f6fa'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#152b45'; ctx.font = reviewFont(locale, 30, true);
  ctx.fillText(i18next.t('yearInReview.title'), margin, 42);
  for (const [index, month] of months.entries()) {
    if (typeof month.quote !== 'string' || month.quote.length > 500) throw new Error('Invalid review caption.');
    const x = margin + index % 4 * (cardWidth + gap);
    const y = heading + margin + Math.floor(index / 4) * (cardHeight + gap);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, cardWidth, cardHeight);
    ctx.fillStyle = '#152b45'; ctx.font = reviewFont(locale, 19, true);
    const label = new Date(Math.floor(month.monthId / 12), month.monthId % 12, 1)
      .toLocaleDateString(locale, { year: 'numeric', month: 'long' });
    ctx.fillText(label, x + 16, y + 30, cardWidth - 32);
    if (month.photo) {
      const date = new Date(month.photo.timestamp);
      if (date.getFullYear() * 12 + date.getMonth() !== month.monthId) throw new Error('Photo is outside its review month.');
      // Never silently export a placeholder if an explicitly selected photo fails.
      const image = await loadImage(await fs.promises.readFile(localFileUriToPath(month.photo.uri)));
      const scale = Math.min((cardWidth - 24) / image.width, 268 / image.height);
      const w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, x + (cardWidth - w) / 2, y + 48 + (268 - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#e4f6f2'; ctx.fillRect(x + 12, y + 48, cardWidth - 24, 268);
      ctx.fillStyle = '#23776c'; ctx.font = reviewFont(locale, 21);
      const lines = wrapText(ctx, month.quote, cardWidth - 64);
      if (lines.length > 8) throw new Error('Review caption does not fit.');
      lines.forEach((line, row) => ctx.fillText(line, x + 32, y + 170 - lines.length * 14 + row * 28));
    }
  }
  await fs.promises.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `AlbumDone-review-${Date.now()}-${randomUUID().slice(0, 8)}.jpg`);
  await fs.promises.writeFile(outputPath, canvas.toBuffer('image/jpeg', 92));
  const summary = getReviewSummary(months);
  return { outputPath, topPersonPhotoCount: 0, monthsCovered: summary.covered, mode: 'scene',
    emptyMonths: months.filter(m => !m.photo).map(m => String(m.monthId)),
  };
}

/** Backend smoke/export compatibility shares the same editor and exporter. */
export async function generateYearInReview(
  photos: YearInReviewInputPhoto[], outputDir: string, timeMode: YearReviewTimeMode = 'rolling',
  localeTag = 'en', now = new Date(),
): Promise<YearInReviewResult> {
  return exportYearReview(await prepareYearReview(photos, timeMode, localeTag, now), outputDir, localeTag);
}
