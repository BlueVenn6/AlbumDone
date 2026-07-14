import {
  buildYearReviewLayoutPlan,
  pathToLocalFileUri,
  selectMonthlyReviewPhotos,
  type MonthlyReviewPhoto,
  type YearInReviewMode,
  type YearInReviewMoment,
  type YearInReviewResult,
} from '@photo-manager/shared';

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger') as typeof import('./logger');

type TimeMode = 'rolling' | 'calendar';
type ReviewLocale = 'en' | 'zh-Hans' | 'zh-Hant';

type MonthlyPhoto = {
  photoPath: string;
  thumbnailPath?: string;
  filename: string;
  fileSize: number;
  photoDate: Date;
  monthId: number;
  resolution: number;
  width: number;
  height: number;
  isScreenshot: boolean;
  hasLocationMetadata: boolean;
  faceCount: number;
};

type PreliminaryMonthlyPhoto = {
  photoPath: string;
  thumbnailPath?: string;
  filename: string;
  fileSize: number;
  photoDate: Date;
  monthId: number;
  width: number;
  height: number;
  isScreenshot: boolean;
};

type YearInReviewInputPhoto = {
  uri: string;
  filename: string;
  timestamp?: number;
  width?: number;
  height?: number;
  fileSize?: number;
  isScreenshot?: boolean;
  thumbnailUri?: string;
};

const EXIF_HEADER_READ_BYTES = 65536;
const MONTH_SELECTION_CANDIDATE_LIMIT = 20;
const RAW_MONTH_CANDIDATE_LIMIT = 60;
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMPTY_YEAR_IN_REVIEW_RESULT: YearInReviewResult = {
  outputPath: '',
  topPersonPhotoCount: 0,
  monthsCovered: 0,
  mode: 'scene',
};

function normalizeReviewLocale(locale: string | undefined): ReviewLocale {
  const normalized = (locale ?? '').replace('_', '-').toLowerCase();
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo') || normalized.startsWith('zh-hant')) {
    return 'zh-Hant';
  }
  if (normalized === 'zh' || normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg') || normalized.startsWith('zh-hans')) {
    return 'zh-Hans';
  }
  return 'en';
}

function formatReviewMomentTitle(monthId: string, locale: ReviewLocale): string {
  if (locale === 'zh-Hant') {
    return `${monthId} 代表照片`;
  }
  if (locale === 'zh-Hans') {
    return `${monthId} 代表照片`;
  }
  return `${monthId} representative photo`;
}

function localizeSelectionReason(reason: string, locale: ReviewLocale): string {
  const englishReplacements: Array<[RegExp, string]> = [
    [/疑似截图或屏幕导出图片/g, 'Likely a screenshot or screen export'],
    [/疑似票据\/账单图片/g, 'Likely a receipt or bill image'],
    [/疑似聊天截图/g, 'Likely a chat screenshot'],
    [/疑似表情包或梗图/g, 'Likely a sticker, emoji, or meme image'],
    [/拍摄时间有效/g, 'Valid capture time'],
    [/图片分辨率很高/g, 'Very high image resolution'],
    [/图片分辨率较高/g, 'High image resolution'],
    [/图片分辨率可用/g, 'Usable image resolution'],
    [/图片分辨率偏低/g, 'Low image resolution'],
    [/缺少图片尺寸元数据/g, 'Missing image dimensions'],
    [/文件体积支持高质量照片判断/g, 'File size supports high-quality photo selection'],
    [/文件体积正常/g, 'Normal file size'],
    [/文件体积偏小/g, 'Small file size'],
    [/缺少文件大小元数据/g, 'Missing file size metadata'],
    [/本地质量评分较高/g, 'High local quality score'],
    [/有人物或合照信号/g, 'People or group-photo signal detected'],
    [/构图评分较好/g, 'Good composition score'],
    [/曝光不理想/g, 'Exposure is not ideal'],
    [/疑似模糊照片/g, 'Likely blurry photo'],
    [/清晰度信号一般/g, 'Average sharpness signal'],
    [/疑似截图/g, 'Likely screenshot'],
    [/用户收藏或手动保留/g, 'Favorited or manually kept by the user'],
    [/有分享行为信号/g, 'Sharing signal detected'],
    [/用户编辑过/g, 'Edited by the user'],
    [/包含拍摄地点信息/g, 'Contains location metadata'],
    [/地点相对少见，可能代表一次外出或旅行/g, 'Less common location, likely an outing or trip'],
    [/包含旅行、人物或事件标签/g, 'Contains travel, people, or event tags'],
    [/同一天照片很多，降低普通连拍权重/g, 'Many photos on the same day, lowering ordinary burst weight'],
    [/同一天有一组事件照片/g, 'Event photo group on the same day'],
    [/已标记为重复组保留图/g, 'Marked as the kept photo in a duplicate group'],
    [/该月没有照片/g, 'No photo record for this month'],
    [/该月照片缺少有效拍摄时间/g, 'This month has photos without valid capture time'],
    [/缺少有效拍摄时间/g, 'Missing valid capture time'],
    [/从 (\d+) 张相似或连拍照片中胜出/g, 'Selected from $1 similar or burst photos'],
    [/低置信度因素/g, 'Low-confidence factor'],
    [/该月缺少高质量候选，保留为低置信度代表图/g, 'This month has few high-quality candidates, kept as a low-confidence representative'],
  ];
  const hant = locale === 'zh-Hant';
  const replacements: Array<[RegExp, string]> = [
    [/疑似截图或屏幕导出图片/g, hant ? '疑似截圖或螢幕匯出圖片' : '疑似截图或屏幕导出图片'],
    [/疑似票据\/账单图片/g, hant ? '疑似票據/帳單圖片' : '疑似票据/账单图片'],
    [/疑似聊天截图/g, hant ? '疑似聊天截圖' : '疑似聊天截图'],
    [/疑似表情包或梗图/g, hant ? '疑似貼圖、表情包或梗圖' : '疑似表情包或梗图'],
    [/拍摄时间有效/g, hant ? '拍攝時間有效' : '拍摄时间有效'],
    [/图片分辨率很高/g, hant ? '圖片解析度很高' : '图片分辨率很高'],
    [/图片分辨率较高/g, hant ? '圖片解析度較高' : '图片分辨率较高'],
    [/图片分辨率可用/g, hant ? '圖片解析度可用' : '图片分辨率可用'],
    [/图片分辨率偏低/g, hant ? '圖片解析度偏低' : '图片分辨率偏低'],
    [/缺少图片尺寸元数据/g, hant ? '缺少圖片尺寸中繼資料' : '缺少图片尺寸元数据'],
    [/文件体积支持高质量照片判断/g, hant ? '檔案大小支援高品質照片判斷' : '文件体积支持高质量照片判断'],
    [/文件体积正常/g, hant ? '檔案大小正常' : '文件体积正常'],
    [/文件体积偏小/g, hant ? '檔案大小偏小' : '文件体积偏小'],
    [/缺少文件大小元数据/g, hant ? '缺少檔案大小中繼資料' : '缺少文件大小元数据'],
    [/本地质量评分较高/g, hant ? '本機品質評分較高' : '本地质量评分较高'],
    [/有人物或合照信号/g, hant ? '有人物或合照訊號' : '有人物或合照信号'],
    [/构图评分较好/g, hant ? '構圖評分較好' : '构图评分较好'],
    [/曝光不理想/g, hant ? '曝光不理想' : '曝光不理想'],
    [/疑似模糊照片/g, hant ? '疑似模糊照片' : '疑似模糊照片'],
    [/清晰度信号一般/g, hant ? '清晰度訊號一般' : '清晰度信号一般'],
    [/疑似截图/g, hant ? '疑似截圖' : '疑似截图'],
    [/用户收藏或手动保留/g, hant ? '使用者收藏或手動保留' : '用户收藏或手动保留'],
    [/有分享行为信号/g, hant ? '有分享行為訊號' : '有分享行为信号'],
    [/用户编辑过/g, hant ? '使用者編輯過' : '用户编辑过'],
    [/包含拍摄地点信息/g, hant ? '包含拍攝地點資訊' : '包含拍摄地点信息'],
    [/地点相对少见，可能代表一次外出或旅行/g, hant ? '地點相對少見，可能代表一次外出或旅行' : '地点相对少见，可能代表一次外出或旅行'],
    [/包含旅行、人物或事件标签/g, hant ? '包含旅行、人物或事件標籤' : '包含旅行、人物或事件标签'],
    [/同一天照片很多，降低普通连拍权重/g, hant ? '同一天照片很多，降低普通連拍權重' : '同一天照片很多，降低普通连拍权重'],
    [/同一天有一组事件照片/g, hant ? '同一天有一組事件照片' : '同一天有一组事件照片'],
    [/已标记为重复组保留图/g, hant ? '已標記為重複組保留圖' : '已标记为重复组保留图'],
    [/该月没有照片/g, hant ? '該月沒有照片' : '该月没有照片'],
    [/该月照片缺少有效拍摄时间/g, hant ? '該月照片缺少有效拍攝時間' : '该月照片缺少有效拍摄时间'],
    [/缺少有效拍摄时间/g, hant ? '缺少有效拍攝時間' : '缺少有效拍摄时间'],
    [/从 (\d+) 张相似或连拍照片中胜出/g, hant ? '從 $1 張相似或連拍照片中勝出' : '从 $1 张相似或连拍照片中胜出'],
    [/低置信度因素/g, hant ? '低信心因素' : '低置信度因素'],
    [/该月缺少高质量候选，保留为低置信度代表图/g, hant ? '該月缺少高品質候選，保留為低信心代表圖' : '该月缺少高质量候选，保留为低置信度代表图'],
  ];

  let next = reason;
  for (const [pattern, replacement] of locale === 'en' ? englishReplacements : replacements) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function getMonthId(date: Date): number {
  return date.getFullYear() * 12 + date.getMonth();
}

function getDateFromMonthId(monthId: number): Date {
  const year = Math.floor(monthId / 12);
  const month = monthId % 12;
  return new Date(year, month, 1);
}

function formatMonthLabel(monthId: number): string {
  const date = getDateFromMonthId(monthId);
  const month = MONTH_LABELS[date.getMonth()] ?? 'Jan';
  const year = String(date.getFullYear()).slice(-2);
  return `${month} ${year}`;
}

function getNoPhotosMessage(locale: ReviewLocale): string {
  if (locale === 'zh-Hant') {
    return '這個月沒有留下照片記錄';
  }
  if (locale === 'zh-Hans') {
    return '这个月没有留下照片记录';
  }
  return 'No photo record for this month';
}

function getPlaceholderLine(locale: ReviewLocale, monthId: number): string {
  const monthIndex = getDateFromMonthId(monthId).getMonth();
  const messages: Record<ReviewLocale, string[]> = {
    en: [
      'A quiet month still belongs in the story.',
      'This month keeps its place in the year.',
      'This space is reserved for a memory.',
      'A pause is part of the year too.',
    ],
    'zh-Hans': [
      '这个月暂时没有可用照片，但它仍在这一年里。',
      '这一格为这个月保留。',
      '没有读到照片，也要把这个月放进回看。',
      '安静的月份，也是这一年的一部分。',
    ],
    'zh-Hant': [
      '這個月暫時沒有可用照片，但它仍在這一年裡。',
      '這一格為這個月保留。',
      '沒有讀到照片，也要把這個月放進回顧。',
      '安靜的月份，也是這一年的一部分。',
    ],
  };
  const localized = messages[locale] ?? messages.en;
  return localized[monthIndex % localized.length] ?? localized[0]!;
}

function drawPlaceholderCard(
  ctx: any,
  options: {
    x: number;
    y: number;
    cell: number;
    monthId: number;
    locale: ReviewLocale;
    isCalendarReview: boolean;
  },
): void {
  const { x, y, cell, monthId, locale, isCalendarReview } = options;
  const gradient = ctx.createLinearGradient(x, y, x + cell, y + cell);
  gradient.addColorStop(0, '#182533');
  gradient.addColorStop(0.55, '#222222');
  gradient.addColorStop(1, '#163831');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, cell, cell);

  ctx.fillStyle = 'rgba(28, 184, 168, 0.18)';
  ctx.beginPath();
  ctx.arc(x + cell * 0.78, y + cell * 0.22, cell * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.font = isCalendarReview ? 'bold 30px sans-serif' : 'bold 19px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.84)';
  const lines = wrapText(ctx, getPlaceholderLine(locale, monthId), cell * 0.72).slice(0, isCalendarReview ? 4 : 3);
  const lineHeight = isCalendarReview ? 42 : 27;
  const startY = y + cell * 0.42 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, lineIndex) => {
    ctx.fillText(line, x + cell / 2, startY + lineIndex * lineHeight);
  });

  ctx.font = isCalendarReview ? '22px sans-serif' : '14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.66)';
  ctx.fillText(getNoPhotosMessage(locale), x + cell / 2, y + cell * 0.66);
}

function wrapText(ctx: any, text: string, maxWidth: number): string[] {
  const hasSpaces = text.includes(' ');
  const words = hasSpaces ? text.split(/\s+/) : [...text];
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? (hasSpaces ? `${current} ${word}` : `${current}${word}`) : word;
    if (ctx.measureText(next).width <= maxWidth || current.length === 0) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines;
}

function compareMonthlyPhotos(a: MonthlyPhoto, b: MonthlyPhoto): number {
  if (a.faceCount !== b.faceCount) {
    return b.faceCount - a.faceCount;
  }

  if (a.hasLocationMetadata !== b.hasLocationMetadata) {
    return a.hasLocationMetadata ? -1 : 1;
  }

  if (a.resolution !== b.resolution) {
    return b.resolution - a.resolution;
  }

  if (a.fileSize !== b.fileSize) {
    return b.fileSize - a.fileSize;
  }

  return b.photoDate.getTime() - a.photoDate.getTime();
}

function pickRepresentativePhoto(monthPhotos: MonthlyPhoto[]): MonthlyPhoto | null {
  const rankedPhotos = [...monthPhotos].sort(compareMonthlyPhotos);
  return rankedPhotos[0] ?? null;
}

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

function localUriToNativePath(inputPath: string): string {
  if (inputPath.startsWith('local-file:///')) {
    return decodeURIComponent(inputPath.slice('local-file:///'.length)).replace(/\//g, path.sep);
  }
  if (inputPath.startsWith('local-photo:///')) {
    return decodeURIComponent(inputPath.slice('local-photo:///'.length)).replace(/\//g, path.sep);
  }
  return inputPath;
}

function isReadableFile(filePath: string | undefined): filePath is string {
  if (!filePath) {
    return false;
  }
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function loadReviewImage(canvas: any, filePath: string): Promise<any> {
  if (process.platform === 'win32') {
    return canvas.loadImage(fs.readFileSync(filePath));
  }
  return canvas.loadImage(filePath);
}

async function renderVerticalReview(
  photos: PreliminaryMonthlyPhoto[],
  outputDir: string,
  locale: ReviewLocale,
  canvas: any,
): Promise<YearInReviewResult> {
  const cell = 900;
  const headerHeight = 80;
  const collage = canvas.createCanvas(cell, headerHeight + photos.length * cell);
  const ctx = collage.getContext('2d');
  ctx.fillStyle = '#151515';
  ctx.fillRect(0, 0, collage.width, collage.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    locale === 'en' ? 'Year in Review' : locale === 'zh-Hant' ? '年度回顧' : '年度回看',
    cell / 2,
    52,
  );

  const moments: YearInReviewMoment[] = [];
  for (const [index, photo] of photos.entries()) {
    const x = 0;
    const y = headerHeight + index * cell;
    try {
      const imagePath = photo.thumbnailPath && isReadableFile(photo.thumbnailPath)
        ? photo.thumbnailPath
        : photo.photoPath;
      const image = await loadReviewImage(canvas, imagePath);
      const scale = Math.max(cell / image.width, cell / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cell, cell);
      ctx.clip();
      ctx.drawImage(image, x - (width - cell) / 2, y - (height - cell) / 2, width, height);
      ctx.restore();
    } catch {
      drawPlaceholderCard(ctx, {
        x,
        y,
        cell,
        monthId: photo.monthId,
        locale,
        isCalendarReview: true,
      });
    }

    const monthText = `${photo.photoDate.getFullYear()}-${String(photo.photoDate.getMonth() + 1).padStart(2, '0')}`;
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(x, y + cell - 64, cell, 64);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(monthText, cell / 2, y + cell - 22);

    const coverPhoto: MonthlyReviewPhoto = {
      id: Buffer.from(photo.photoPath).toString('base64url'),
      uri: pathToLocalFileUri(photo.photoPath),
      filename: photo.filename,
      timestamp: photo.photoDate.getTime(),
      capturedAt: photo.photoDate.getTime(),
      width: photo.width,
      height: photo.height,
      fileSize: photo.fileSize,
      isScreenshot: photo.isScreenshot,
      tags: [],
      albumId: '',
    };
    moments.push({
      month: monthText,
      momentTitle: formatReviewMomentTitle(monthText, locale),
      dateRange: photo.photoDate.toISOString().slice(0, 10),
      coverPhoto,
      photos: [coverPhoto],
      score: 0,
      whySelected: [locale === 'en' ? 'One of the available photos' : locale === 'zh-Hant' ? '實際可用照片' : '实际可用照片'],
    });
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `year-in-review-${Date.now()}.jpg`);
  fs.writeFileSync(outputPath, collage.toBuffer('image/jpeg', { quality: 0.92 }));
  return {
    outputPath,
    topPersonPhotoCount: 0,
    monthsCovered: new Set(photos.map((photo) => photo.monthId)).size,
    mode: 'scene',
    moments,
    emptyMonths: [],
  };
}

async function generateYearInReview(
  photos: YearInReviewInputPhoto[],
  outputDir: string,
  timeMode: TimeMode = 'rolling',
  localeTag?: string,
): Promise<YearInReviewResult> {
  try {
    const locale = normalizeReviewLocale(localeTag);
    logger.info('yearInReview', 'starting', { totalPhotos: photos.length, timeMode, outputDir });

    const normalizedPaths = photos.map((photo) => ({
      ...photo,
      filePath: localUriToNativePath(photo.uri),
      thumbnailPath: photo.thumbnailUri ? localUriToNativePath(photo.thumbnailUri) : undefined,
    }));

    let loadedCount = 0;
    let failedCount = 0;

    const rawPhotosByMonth = new Map<number, PreliminaryMonthlyPhoto[]>();
    const SUPPORTED_EXTENSIONS = new Set([
      '.jpg', '.jpeg', '.jfif', '.png', '.gif', '.webp', '.avif',
      '.heic', '.heif', '.tif', '.tiff', '.bmp',
    ]);
    let skippedFormat = 0;

    for (const photo of normalizedPaths) {
      try {
        const ext = path.extname(photo.filePath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
          skippedFormat++;
          continue;
        }

        let fileSize = Number.isFinite(photo.fileSize) ? Number(photo.fileSize) : 0;
        let photoDate = Number.isFinite(photo.timestamp) ? new Date(Number(photo.timestamp)) : null;
        if (!fileSize || !photoDate || Number.isNaN(photoDate.getTime())) {
          const stat = fs.statSync(photo.filePath);
          if (!stat.isFile()) continue;
          fileSize = fileSize || stat.size;
          photoDate = photoDate && !Number.isNaN(photoDate.getTime())
            ? photoDate
            : new Date(stat.mtime);
        }
        const mtimeDate = photoDate;
        if (Number.isNaN(mtimeDate.getTime())) {
          continue;
        }
        const monthId = getMonthId(mtimeDate);

        if (!rawPhotosByMonth.has(monthId)) {
          rawPhotosByMonth.set(monthId, []);
        }

        rawPhotosByMonth.get(monthId)?.push({
          photoPath: photo.filePath,
          ...(isReadableFile(photo.thumbnailPath) ? { thumbnailPath: photo.thumbnailPath } : {}),
          filename: photo.filename,
          fileSize,
          photoDate: mtimeDate,
          monthId,
          width: Math.max(0, Math.round(Number(photo.width) || 0)),
          height: Math.max(0, Math.round(Number(photo.height) || 0)),
          isScreenshot: photo.isScreenshot === true,
        });
      } catch {
        // Ignore inaccessible files.
      }
    }

    logger.info('yearInReview', 'skipped unsupported formats', { skippedFormat });

    if (rawPhotosByMonth.size === 0) {
      throw new Error('No photos found in the selected time range.');
    }

    const allPreliminaryPhotos = [...rawPhotosByMonth.values()].flat();
    const layoutPlan = buildYearReviewLayoutPlan(
      allPreliminaryPhotos.map((photo) => ({
        id: photo.photoPath,
        timestamp: photo.photoDate.getTime(),
      })),
      timeMode,
    );
    if (layoutPlan.layout === 'empty') {
      throw new Error('No photos found in the selected time range.');
    }

    const loadCanvasModule = (): any => {
      try {
        return require('canvas');
      } catch {
        return require('@napi-rs/canvas');
      }
    };
    const canvas = loadCanvasModule();
    if (layoutPlan.layout === 'vertical') {
      const photoByPath = new Map(allPreliminaryPhotos.map((photo) => [photo.photoPath, photo]));
      const verticalPhotos = layoutPlan.photoIds.flatMap((photoId) => {
        const photo = photoByPath.get(photoId);
        return photo ? [photo] : [];
      });
      return await renderVerticalReview(verticalPhotos, outputDir, locale, canvas);
    }

    const selectedMonthIds = layoutPlan.monthIds;
    const selectionStartMonthId = selectedMonthIds[0]!;
    const selectionMonthCount = selectedMonthIds.length;

    const photosByMonth = new Map<number, MonthlyPhoto[]>();
    for (const monthId of selectedMonthIds) {
      const monthPhotos = rawPhotosByMonth.get(monthId);
      if (monthPhotos && monthPhotos.length > 0) {
        const rawCandidates = [...monthPhotos]
          .sort((a, b) =>
            (b.fileSize - a.fileSize)
            || (b.photoDate.getTime() - a.photoDate.getTime()))
          .slice(0, Math.min(RAW_MONTH_CANDIDATE_LIMIT, monthPhotos.length));
        const rankedCandidates: MonthlyPhoto[] = rawCandidates
          .map((candidate) => {
            const cachedResolution = candidate.width > 0 && candidate.height > 0
              ? candidate.width * candidate.height
              : 0;
            try {
              const shouldReadHeader = cachedResolution <= 0;
              const exifHeader = shouldReadHeader
                ? readFileHead(candidate.photoPath, EXIF_HEADER_READ_BYTES)
                : null;
              const exifMetadata = exifHeader ? extractExifMetadata(exifHeader) : {
                dateTimeOriginal: null,
                hasLocationMetadata: false,
              };
              return {
                ...candidate,
                photoDate: exifMetadata.dateTimeOriginal ?? candidate.photoDate,
                resolution: cachedResolution || (exifHeader ? extractImageResolution(exifHeader) : 0),
                width: candidate.width,
                height: candidate.height,
                isScreenshot: candidate.isScreenshot,
                hasLocationMetadata: exifMetadata.hasLocationMetadata,
                faceCount: 0,
              };
            } catch {
              return {
                ...candidate,
                resolution: cachedResolution,
                width: candidate.width,
                height: candidate.height,
                isScreenshot: candidate.isScreenshot,
                hasLocationMetadata: false,
                faceCount: 0,
              };
            }
          })
          .sort(compareMonthlyPhotos)
          .slice(0, Math.min(MONTH_SELECTION_CANDIDATE_LIMIT, rawCandidates.length));
        photosByMonth.set(monthId, rankedCandidates);
      }
    }

    logger.info('yearInReview', 'months with photos', { selectedMonthIds });

    logger.info('yearInReview', 'metadata selection path enabled', {
      candidateMonths: photosByMonth.size,
      maxCandidatesPerMonth: MONTH_SELECTION_CANDIDATE_LIMIT,
    });

    const monthlyReviewCandidates: MonthlyReviewPhoto[] =
      [...photosByMonth.values()].flat().map((photo) => ({
        id: Buffer.from(photo.photoPath).toString('base64url'),
        uri: pathToLocalFileUri(photo.photoPath),
        filename: photo.filename,
        timestamp: photo.photoDate.getTime(),
        capturedAt: photo.photoDate.getTime(),
        width: photo.width > 0 ? photo.width : (photo.resolution > 0 ? Math.round(Math.sqrt(photo.resolution)) : 0),
        height: photo.height > 0 ? photo.height : (photo.resolution > 0 ? Math.round(Math.sqrt(photo.resolution)) : 0),
        fileSize: photo.fileSize,
        isScreenshot: photo.isScreenshot,
        quality: {
          sharpness: photo.resolution > 0 ? 350 : 120,
          exposure: 'normal' as const,
          noise: 0.2,
          hasFace: photo.faceCount > 0,
          faceScore: Math.min(1, photo.faceCount / 3),
          compositionScore: photo.hasLocationMetadata ? 0.7 : 0.55,
          timestamp: photo.photoDate.getTime(),
        },
        tags: photo.faceCount > 0 ? ['people'] : [],
        albumId: '',
        ...(photo.hasLocationMetadata ? { locationKey: 'gps' } : {}),
      }));

    const monthlySelections = selectMonthlyReviewPhotos(monthlyReviewCandidates, {
      startDate: getDateFromMonthId(selectionStartMonthId),
      months: selectionMonthCount,
      allowLowConfidence: true,
    });

    logger.debug('yearInReview', 'monthly selection', monthlySelections.map((selection) => ({
      monthId: selection.monthId,
      selectedPhotoId: selection.selectedPhoto?.id ?? null,
      confidence: selection.confidence,
      score: selection.score,
      reasons: selection.reasons,
      excludedCount: selection.excludedCandidates.length,
    })));

    const momentByMonth = new Map(
      monthlySelections
        .filter((selection) => selection.selectedPhoto)
        .map((selection) => [
          selectionStartMonthId + selection.slotIndex,
          selection,
        ]),
    );
    const selectedPhotos = new Map<number, MonthlyPhoto>();
    for (const monthId of selectedMonthIds) {
      const selection = momentByMonth.get(monthId);
      const monthCandidates = photosByMonth.get(monthId) ?? [];
      const selectedPath = selection?.selectedPhoto?.uri
        ? localUriToNativePath(selection.selectedPhoto.uri)
        : null;
      const selectedPhoto = selectedPath
        ? monthCandidates.find((photo) =>
          path.resolve(photo.photoPath).toLowerCase() === path.resolve(selectedPath).toLowerCase())
        : null;
      const readableSelectedPhoto = selectedPhoto && isReadableFile(selectedPhoto.photoPath)
        ? selectedPhoto
        : null;
      const fallbackPhoto = readableSelectedPhoto
        ?? (selectedPath
          ? monthCandidates.find((photo) => isReadableFile(photo.photoPath)) ?? null
          : null);
      if (fallbackPhoto) {
        selectedPhotos.set(monthId, fallbackPhoto);
      }
    }

    const selectionByMonth = new Map(
      monthlySelections.map((selection) => [
        selectionStartMonthId + selection.slotIndex,
        selection,
      ]),
    );
    const meaningfulMoments: YearInReviewMoment[] = [...selectedPhotos.entries()]
      .sort(([a], [b]) => a - b)
      .map(([monthId, photo]) => {
        const selection = selectionByMonth.get(monthId);
        const coverPhoto: MonthlyReviewPhoto = {
          id: Buffer.from(photo.photoPath).toString('base64url'),
          uri: pathToLocalFileUri(photo.photoPath),
          filename: photo.filename,
          timestamp: photo.photoDate.getTime(),
          capturedAt: photo.photoDate.getTime(),
          width: photo.width,
          height: photo.height,
          fileSize: photo.fileSize,
          isScreenshot: photo.isScreenshot,
          quality: {
            sharpness: photo.resolution > 0 ? 350 : 120,
            exposure: 'normal',
            noise: 0.2,
            hasFace: photo.faceCount > 0,
            faceScore: Math.min(1, photo.faceCount / 3),
            compositionScore: photo.hasLocationMetadata ? 0.7 : 0.55,
            timestamp: photo.photoDate.getTime(),
          },
          tags: photo.faceCount > 0 ? ['people'] : [],
          albumId: '',
          ...(photo.hasLocationMetadata ? { locationKey: 'gps' } : {}),
        };
        return {
          month: `${getDateFromMonthId(monthId).getFullYear()}-${String(getDateFromMonthId(monthId).getMonth() + 1).padStart(2, '0')}`,
          momentTitle: formatReviewMomentTitle(`${getDateFromMonthId(monthId).getFullYear()}-${String(getDateFromMonthId(monthId).getMonth() + 1).padStart(2, '0')}`, locale),
          dateRange: new Date(coverPhoto.timestamp).toISOString().slice(0, 10),
          coverPhoto,
          photos: [coverPhoto],
          score: selection?.score ?? 0,
          whySelected: (selection?.reasons ?? ['Fallback readable photo for this month'])
            .map((reason) => localizeSelectionReason(reason, locale)),
        };
      });

    const selectedFacePhotoCount = [...selectedPhotos.values()]
      .filter((photo) => photo.faceCount > 0)
      .length;
    const mode: YearInReviewMode = 'scene';

    const isCalendarReview = false;
    const visibleMonthIds = selectedMonthIds;
    const cell = 400;
    const cols = visibleMonthIds.length === 12 ? 4 : 1;
    const rows = Math.max(1, Math.ceil(visibleMonthIds.length / cols));
    const headerHeight = isCalendarReview ? 64 : 40;
    const collage = canvas.createCanvas(cell * cols, cell * rows + headerHeight);
    const ctx = collage.getContext('2d');

    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, collage.width, collage.height);

    const headerStart = getDateFromMonthId(visibleMonthIds[0] ?? selectedMonthIds[0]!);
    const headerEnd = getDateFromMonthId(visibleMonthIds[visibleMonthIds.length - 1] ?? selectedMonthIds[selectedMonthIds.length - 1]!);
    const headerTitle =
      headerStart.getFullYear() === headerEnd.getFullYear()
        ? `${headerStart.getFullYear()}`
        : `${headerStart.getFullYear()} – ${headerEnd.getFullYear()}`;

    ctx.fillStyle = '#151515';
    ctx.fillRect(0, 0, collage.width, headerHeight);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = isCalendarReview ? 'bold 28px sans-serif' : 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(headerTitle, collage.width / 2, isCalendarReview ? 42 : 27);

    for (let i = 0; i < visibleMonthIds.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cell;
      const y = row * cell + headerHeight;

      const label = formatMonthLabel(visibleMonthIds[i]!);

      const selectedPhoto = selectedPhotos.get(visibleMonthIds[i]!);
      if (selectedPhoto?.photoPath) {
        try {
          const imagePath = selectedPhoto.thumbnailPath && fs.existsSync(selectedPhoto.thumbnailPath)
            ? selectedPhoto.thumbnailPath
            : selectedPhoto.photoPath;
          const img = await loadReviewImage(canvas, imagePath);
          loadedCount++;
          const scale = Math.max(cell / img.width, cell / img.height);
          const sw = img.width * scale;
          const sh = img.height * scale;
          const sx = (sw - cell) / 2;
          const sy = (sh - cell) / 2;

          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cell, cell);
          ctx.clip();
          ctx.drawImage(img, x - sx, y - sy, sw, sh);
          ctx.restore();
        } catch (err) {
          failedCount++;
          logger.warn('yearInReview', 'canvas.loadImage failed in collage pass', {
            path: selectedPhoto.photoPath,
            error: err instanceof Error ? err.message : String(err),
          });
          drawPlaceholderCard(ctx, {
            x,
            y,
            cell,
            monthId: visibleMonthIds[i]!,
            locale,
            isCalendarReview,
          });
        }
      } else {
        drawPlaceholderCard(ctx, {
          x,
          y,
          cell,
          monthId: visibleMonthIds[i]!,
          locale,
          isCalendarReview,
        });
      }

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x, y + cell - (isCalendarReview ? 54 : 36), cell, isCalendarReview ? 54 : 36);
      ctx.fillStyle = '#ffffff';
      ctx.font = isCalendarReview ? 'bold 28px sans-serif' : 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + cell / 2, y + cell - (isCalendarReview ? 17 : 12));

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, cell, cell);
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `year-in-review-${Date.now()}.jpg`);
    const buffer = collage.toBuffer('image/jpeg', { quality: 0.92 });
    fs.writeFileSync(outputPath, buffer);
    logger.info('yearInReview', 'canvas load result', { success: loadedCount, failed: failedCount });

    return {
      outputPath,
      topPersonPhotoCount: selectedFacePhotoCount,
      monthsCovered: visibleMonthIds.length,
      mode,
      moments: meaningfulMoments,
      emptyMonths: selectedMonthIds
        .filter((monthId) => !selectedPhotos.has(monthId))
        .map(formatMonthLabel),
    };
  } catch (err) {
    logger.error('yearInReview', 'fatal', err);
    return EMPTY_YEAR_IN_REVIEW_RESULT;
  }
}

module.exports = { generateYearInReview };
