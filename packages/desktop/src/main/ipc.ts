import { ipcMain, app, dialog, BrowserWindow, shell, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'crypto';
import { fork } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  LLMClient,
  computeVisualHashSignature,
  detectScreenshotCandidate,
  executeInstruction,
  modelSupportsVision,
  type LLMMessage,
  type LLMProvider,
  type ProviderConfig,
  type ProviderMode,
} from '@photo-manager/shared';
import { getLocalIp, startLanServer, stopLanServer, getLanServerUrl } from './lanServer';
import { normalizeDesktopLocale, readSystemDisplayLocale } from './locale';
import { logger, serializeError } from './logger';
import { RecoverableBatchError, runCrashIsolatedBatches } from './resilientBatch';
import { DESKTOP_PORTS } from './ports';
import { raceWithTimeout } from './asyncTimeout';
import { registerYearInReviewIpc } from './yearInReviewIpc';
import {
  addAllowedLocalFileRoot,
  assertAllowedLocalFilePath,
} from './localFileAccess';
const { generateYearInReview } = require('./yearInReview') as {
  generateYearInReview: (
    photos: Array<{
      uri: string;
      filename: string;
      timestamp?: number;
      width?: number;
      height?: number;
      fileSize?: number;
      isScreenshot?: boolean;
      thumbnailUri?: string;
    }>,
    outputDir: string,
    timeMode?: 'rolling' | 'calendar',
    locale?: string,
  ) => Promise<unknown>;
};

type IpcErrorResponse = {
  __ipcError: true;
  error: {
    channel: string;
    code: string;
    message: string;
  };
};

const HIGH_RISK_CHANNELS = new Set([
  'fs:readDirectory',
  'fs:readImageAsBase64',
  'fs:readImagePreviewAsBase64',
  'fs:getPhotoBase64',
  'fs:moveToTrash',
  'fs:deleteFiles',
  'fs:computeContentHashes',
  'fs:computeVisualHashes',
  'fs:cancelVisualHashes',
  'fs:cancelScan',
  'db:execute',
  'db:query',
  'db:queryOne',
  'db:transaction',
  'tasks:getCheckpoint',
  'tasks:saveCheckpoint',
  'tasks:deleteCheckpoint',
  'settings:setApiKey',
  'network:startLanServer',
  'llm:testConnection',
  'llm:chat',
  'llm:chatWithImage',
  'screenshot:executeInstruction',
  'screenshot:cancelInstruction',
  'ocr:extractText',
  'yearInReview:generate',
]);

const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.jfif',
  '.png',
  '.gif',
  '.webp',
  '.avif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
  '.bmp',
]);
const MAX_BASE64_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_VISION_SOURCE_IMAGE_BYTES = 256 * 1024 * 1024;
const MAX_VISION_PASSTHROUGH_BYTES = 4 * 1024 * 1024;
const MAX_SCAN_PHOTOS = 20000;
const SCAN_FILE_CONCURRENCY = 16;
const MAX_LLM_BODY_BYTES = 12 * 1024 * 1024;
const CREDENTIAL_OPERATION_TIMEOUT_MS = 5000;
const TEST_CONNECTION_TIMEOUT_MS = 25000;
const MAX_VISUAL_HASH_PHOTOS = 6000;
const VISUAL_HASH_SIZE = 32;
const THUMBNAIL_CACHE_DIR_NAME = 'photo-manager-thumbs';
const FINGERPRINT_SAMPLE_BYTES = 64 * 1024;
const DIMENSION_HEADER_BYTES = 256 * 1024;
const JPEG_DIMENSION_FALLBACK_BYTES = 2 * 1024 * 1024;
const SECRET_QUERY_PARAMS = new Set(['key', 'api_key', 'token', 'access_token']);
const validProviderPattern = /^[a-z0-9_-]{1,40}$/i;
const validScanIdPattern = /^[a-z0-9_-]{8,120}$/i;
let preferredLocalePromise: Promise<string | null> | null = null;
const photoScanControllers = new Map<string, AbortController>();
const screenshotInstructionControllers = new Map<string, AbortController>();

function getPreferredLocale(): Promise<string | null> {
  preferredLocalePromise ??= readSystemDisplayLocale();
  return preferredLocalePromise;
}

function createIpcError(channel: string, err: unknown): IpcErrorResponse {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = /NODE_MODULE_VERSION|compiled against a different Node\.js version/i.test(rawMessage)
    ? 'This desktop package has a native module version mismatch. Please rebuild or reinstall the latest AlbumDone package.'
    : sanitizeIpcText(rawMessage);

  return {
    __ipcError: true,
    error: {
      channel,
      code: err instanceof Error && err.name ? err.name : 'IPC_ERROR',
      message,
    },
  };
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!senderUrl) {
    return false;
  }

  if (process.env.NODE_ENV === 'development') {
    return senderUrl.startsWith(`http://localhost:${DESKTOP_PORTS.renderer}`)
      || senderUrl.startsWith(`http://127.0.0.1:${DESKTOP_PORTS.renderer}`)
      || senderUrl.startsWith('file://');
  }

  return senderUrl.startsWith('file://');
}

function safeHandle<T>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!isTrustedSender(event)) {
        throw new Error('IPC sender is not trusted.');
      }

      if (HIGH_RISK_CHANNELS.has(channel)) {
        logger.info('ipc', 'high-risk IPC invoked', {
          channel,
          argCount: args.length,
        });
      }

      return await handler(event, ...args);
    } catch (err) {
      logger.error('ipc', `${channel} failed`, sanitizeIpcText(serializeError(err)));
      return createIpcError(channel, err);
    }
  });
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  if (value.includes('\0')) {
    throw new Error(`${name} contains invalid null byte.`);
  }
  return value;
}

function assertStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array.`);
  }
  return value.map((item, index) => assertString(item, `${name}[${index}]`));
}

function isLoopbackHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

function sanitizeIpcText(value: string): string {
  return value
    .replace(/([?&](?:token|access_token|api_key|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(Authorization["'\s:=]+)(?:Bearer\s+)?[^"',\s}]+/gi, '$1[REDACTED]')
    .replace(/(x-api-key["'\s:=]+)[^"',\s}]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key["'\s:=]+)[^"',\s}]+/gi, '$1[REDACTED]')
    .replace(/[A-Za-z]:\\[^\s"',)]+/g, '[local-path]')
    .replace(/\/(?:Users|home|var|tmp)\/[^\s"',)]+/g, '[local-path]');
}

function summarizeProviderResponseBody(body: string): string {
  const sanitized = sanitizeIpcText(body).slice(0, 1200);
  try {
    const parsed = JSON.parse(sanitized) as {
      error?: { message?: unknown; code?: unknown; type?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const error = parsed.error;
    const parts = [
      typeof error?.code === 'string' ? `code=${error.code}` : null,
      typeof error?.type === 'string' ? `type=${error.type}` : null,
      typeof error?.message === 'string' ? error.message : null,
      typeof parsed.code === 'string' ? `code=${parsed.code}` : null,
      typeof parsed.message === 'string' ? parsed.message : null,
    ].filter(Boolean);
    return sanitizeIpcText(parts.join(' · ') || sanitized).slice(0, 600);
  } catch {
    return sanitized.slice(0, 600);
  }
}

function sanitizeIpcPayload<T>(value: T): T {
  if (typeof value === 'string') {
    return sanitizeIpcText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeIpcPayload(item)) as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/^(apiKey|authorization|x-api-key)$/i.test(key)) {
        result[key] = '[REDACTED]';
      } else if (/base64|image/i.test(key) && typeof entry === 'string' && entry.length > 2000) {
        result[key] = '[REDACTED_IMAGE_DATA]';
      } else {
        result[key] = sanitizeIpcPayload(entry);
      }
    }
    return result as T;
  }
  return value;
}

function assertSafeEndpointUrl(baseUrl: unknown): string | undefined {
  if (baseUrl === undefined || baseUrl === null || baseUrl === '') {
    return undefined;
  }
  const parsedUrl = new URL(assertString(baseUrl, 'baseUrl'));
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP(S) LLM endpoints are allowed.');
  }
  for (const key of parsedUrl.searchParams.keys()) {
    if (SECRET_QUERY_PARAMS.has(key.toLowerCase())) {
      throw new Error('LLM endpoint URLs must not include API keys or tokens in query parameters.');
    }
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error('Plain HTTP LLM endpoints are limited to localhost.');
  }
  return parsedUrl.toString();
}

function assertLLMProvider(value: unknown): LLMProvider {
  const provider = assertString(value, 'provider') as LLMProvider;
  if (!validProviderPattern.test(provider)) {
    throw new Error('Invalid provider name.');
  }
  return provider;
}

function assertProviderMode(value: unknown): ProviderMode {
  return value === 'proxy' ? 'proxy' : 'direct';
}

function assertLlmMessages(value: unknown): LLMMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new Error('LLM messages must be a non-empty array with at most 50 entries.');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_LLM_BODY_BYTES) {
    throw new Error('LLM request body is too large.');
  }
  return value as LLMMessage[];
}

function assertParamsArray(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error('SQL params must be an array with at most 100 values.');
  }
  return value;
}

function assertImagePath(inputPath: unknown, action: string): string {
  const filePath = assertPathAllowed(assertString(inputPath, 'filePath'), action);
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    throw new Error(`Unsupported image extension for ${action}: ${ext || 'none'}.`);
  }
  return filePath;
}

async function assertReadableImageFile(inputPath: unknown, action: string, maxBytes?: number): Promise<{
  filePath: string;
  stats: fs.Stats;
}> {
  const filePath = assertImagePath(inputPath, action);
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`${action} target is not a file.`);
  }
  if (maxBytes && stats.size > maxBytes) {
    throw new Error(`${action} refused oversized image (${Math.round(stats.size / 1024 / 1024)} MB).`);
  }
  return { filePath, stats };
}

function validateSql(sqlValue: unknown, mode: 'read' | 'write'): string {
  const sql = assertString(sqlValue, 'sql').trim();
  const normalized = sql.replace(/\s+/g, ' ').toUpperCase();
  if (sql.includes(';') && sql.replace(/;+\s*$/, '').includes(';')) {
    throw new Error('Multiple SQL statements are not allowed.');
  }
  if (/\b(ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|DROP|ALTER)\b/i.test(sql)) {
    throw new Error('SQL statement is not allowed.');
  }
  if (mode === 'read') {
    if (!/^(SELECT|WITH)\b/i.test(sql)) {
      throw new Error('Only SELECT queries are allowed.');
    }
    return sql;
  }

  const knownTables = [
    'PHOTOS',
    'DUPLICATE_GROUPS',
    'DUPLICATE_GROUP_PHOTOS',
    'CULLING_DECISIONS',
    'SCREENSHOT_RESULTS',
    'SETTINGS',
    'TRASH',
    'SCREENSHOT_ARCHIVE',
  ];
  const allowedStart = /^(CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|INSERT OR REPLACE INTO|INSERT OR IGNORE INTO|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(sql);
  if (!allowedStart || !knownTables.some((table) => normalized.includes(table))) {
    throw new Error('Write SQL must target a known app table.');
  }
  return sql;
}

let activeHeavyTaskKey: string | null = null;
const activeHeavyTaskControllers = new Map<string, AbortController>();

async function runExclusiveHeavyTask<T>(
  key: string,
  type: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (activeHeavyTaskKey && activeHeavyTaskKey !== key) {
    throw new Error(`Another heavy task is already running: ${activeHeavyTaskKey}`);
  }

  activeHeavyTaskKey = key;
  try {
    const controller = new AbortController();
    activeHeavyTaskControllers.set(key, controller);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timeoutId);
      activeHeavyTaskControllers.delete(key);
    }
  } finally {
    if (activeHeavyTaskKey === key) {
      activeHeavyTaskKey = null;
    }
  }
}

function cancelExclusiveHeavyTask(key: string): boolean {
  const controller = activeHeavyTaskControllers.get(key);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}

function normalizeForPathCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relative = path.relative(normalizeForPathCompare(parentPath), normalizeForPathCompare(childPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

type ImageDimensions = {
  width: number;
  height: number;
};

type PhotoScanOptions = {
  includeDimensions?: boolean;
  batchSize?: number;
  onBatch?: (photos: ImportedPhoto[], scanned: number) => void;
  onCachedBatch?: (photos: ImportedPhoto[]) => void;
  shouldCancel?: () => boolean;
};

type PhotoScanResult = {
  photos: ImportedPhoto[];
  failedDirs: string[];
  failedDimensions: string[];
  skippedUnsupported: number;
  truncated: boolean;
  timings: {
    cachedIndexMs: number;
    walkMs: number;
    fingerprintMs: number;
    upsertMs: number;
    touchMs: number;
    staleDeleteMs: number;
  };
};

type FingerprintCandidate = {
  photo: ImportedPhoto;
  filePath: string;
  stats: fs.Stats;
  ext: string;
  dimensions: ImageDimensions;
};

function shouldFingerprintCandidateGroup(candidates: FingerprintCandidate[]): boolean {
  if (candidates.length < 2) {
    return false;
  }

  const sorted = [...candidates].sort((a, b) => a.stats.mtimeMs - b.stats.mtimeMs);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index]!.stats.mtimeMs - sorted[index - 1]!.stats.mtimeMs <= 10_000) {
      return true;
    }
  }

  return candidates.some((candidate) =>
    /\b(copy|duplicate|副本|拷贝|複本|copy\s*\d*)\b/i.test(candidate.photo.filename),
  );
}

function toPhotoRecord(
  filePath: string,
  stats: fs.Stats,
  albumId: string,
  dimensions: ImageDimensions,
  screenshotInfo: ReturnType<typeof detectScreenshotCandidate>,
  fingerprint: string | undefined,
): ImportedPhoto {
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return {
    id: Buffer.from(path.resolve(filePath)).toString('base64url'),
    path: path.resolve(filePath),
    uri: toLocalFileUri(filePath),
    filename,
    extension: ext,
    timestamp: stats.mtime.getTime(),
    width: dimensions.width,
    height: dimensions.height,
    fileSize: stats.size,
    ...(fingerprint ? { fingerprint } : {}),
    isScreenshot: screenshotInfo.isScreenshot,
    screenshotConfidence: screenshotInfo.confidence,
    screenshotReasons: screenshotInfo.reasons,
    tags: [],
    albumId,
  };
}

async function getFileFingerprint(
  filePath: string,
  stats: fs.Stats,
  ext: string,
  dimensions: ImageDimensions,
): Promise<string> {
  const hash = createHash('sha1');
  hash.update('partial-content-v1');
  hash.update(ext);
  hash.update(String(stats.size));
  hash.update(`${dimensions.width}x${dimensions.height}`);

  const firstLength = Math.min(FINGERPRINT_SAMPLE_BYTES, stats.size);
  const first = await readFileRange(filePath, 0, firstLength);
  hash.update(first);

  if (stats.size > FINGERPRINT_SAMPLE_BYTES) {
    const lastOffset = Math.max(0, stats.size - FINGERPRINT_SAMPLE_BYTES);
    const last = await readFileRange(filePath, lastOffset, FINGERPRINT_SAMPLE_BYTES);
    hash.update(last);
  }

  return hash.digest('hex');
}

// Lazy-loaded keytar (optional secure credential store)
let keytar: typeof import('keytar') | null = null;
try {
  keytar = require('keytar') as typeof import('keytar');
} catch {
  logger.warn('native', 'keytar not available, using Electron safeStorage fallback for API keys');
}

// Lazy-loaded better-sqlite3 — native module must be rebuilt for each Electron ABI.
// Deferring the require() means a build mismatch only breaks DB calls, not all IPC handlers.
import type BetterSqlite3Type from 'better-sqlite3';
type SqliteDb = BetterSqlite3Type.Database;
let SqliteConstructor: typeof BetterSqlite3Type | null = null;
let db: SqliteDb | null = null;
let photoIndexDisabledReason: string | null = null;
const THUMBNAIL_MAX_CONCURRENT_TASKS = 3;

type ThumbnailTask = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

function toNativePath(inputPath: string): string {
  let nextPath = inputPath;
  if (nextPath.startsWith('local-file:///')) {
    nextPath = decodeURIComponent(nextPath.slice('local-file:///'.length));
  } else if (nextPath.startsWith('local-photo:///')) {
    nextPath = decodeURIComponent(nextPath.slice('local-photo:///'.length));
  }

  if (process.platform === 'win32') {
    if (/^\/[a-zA-Z]:\//.test(nextPath)) {
      nextPath = nextPath.slice(1);
    }
    if (/^[a-zA-Z]:\//.test(nextPath)) {
      nextPath = nextPath.replace(/\//g, path.sep);
    }
  }

  return path.resolve(nextPath);
}

function assertPathAllowed(inputPath: string, action: string): string {
  return assertAllowedLocalFilePath(toNativePath(inputPath), action);
}

function getThumbnailRoot(): string {
  return path.join(app.getPath('temp'), THUMBNAIL_CACHE_DIR_NAME);
}

function getAppOutputRoot(): string {
  if (!app.isPackaged && process.env.ALBUMDONE_TEST_OUTPUT_ROOT) {
    return path.resolve(process.env.ALBUMDONE_TEST_OUTPUT_ROOT);
  }
  return path.join(app.getPath('pictures'), 'AlbumDone');
}

function toLocalFileUri(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const forwardPath = resolvedPath.split(path.sep).join('/');
  const encodedPath = forwardPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `local-file:///${encodedPath}`;
}

async function readFileHead(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    const length = Math.max(0, Math.min(maxBytes, stats.size));
    if (length === 0) {
      return Buffer.alloc(0);
    }
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readFileRange(filePath: string, offset: number, length: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (offset < 0 || offset >= stats.size || length <= 0) {
      return Buffer.alloc(0);
    }
    const safeLength = Math.max(0, Math.min(length, stats.size - offset));
    const buffer = Buffer.allocUnsafe(safeLength);
    const { bytesRead } = await handle.read(buffer, 0, safeLength, offset);
    return bytesRead === safeLength ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function parseJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (!marker || marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    if (marker === 0xda || offset + 4 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) {
      break;
    }

    const isStartOfFrame =
      marker >= 0xc0
      && marker <= 0xcf
      && marker !== 0xc4
      && marker !== 0xc8
      && marker !== 0xcc;

    if (isStartOfFrame) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function parsePngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') {
    return null;
  }
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseBmpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 26 || buffer.toString('ascii', 0, 2) !== 'BM') {
    return null;
  }
  return {
    width: Math.abs(buffer.readInt32LE(18)),
    height: Math.abs(buffer.readInt32LE(22)),
  };
}

function readTiffNumber(buffer: Buffer, offset: number, bytes: 2 | 4, littleEndian: boolean): number {
  if (offset < 0 || offset + bytes > buffer.length) {
    return 0;
  }
  if (bytes === 2) {
    return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  }
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function parseTiffDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 8) {
    return null;
  }
  const byteOrder = buffer.toString('ascii', 0, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') {
    return null;
  }
  if (readTiffNumber(buffer, 2, 2, littleEndian) !== 42) {
    return null;
  }
  const ifdOffset = readTiffNumber(buffer, 4, 4, littleEndian);
  if (ifdOffset <= 0 || ifdOffset + 2 > buffer.length) {
    return null;
  }
  const entryCount = readTiffNumber(buffer, ifdOffset, 2, littleEndian);
  let width = 0;
  let height = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdOffset + 2 + (index * 12);
    if (entryOffset + 12 > buffer.length) {
      break;
    }
    const tag = readTiffNumber(buffer, entryOffset, 2, littleEndian);
    const type = readTiffNumber(buffer, entryOffset + 2, 2, littleEndian);
    const valueOffset = entryOffset + 8;
    const value = type === 3
      ? readTiffNumber(buffer, valueOffset, 2, littleEndian)
      : readTiffNumber(buffer, valueOffset, 4, littleEndian);
    if (tag === 256) {
      width = value;
    } else if (tag === 257) {
      height = value;
    }
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }
  return null;
}

function tiffByteOrder(buffer: Buffer): { littleEndian: boolean; ifdOffset: number } | null {
  if (buffer.length < 8) {
    return null;
  }
  const byteOrder = buffer.toString('ascii', 0, 2);
  const littleEndian = byteOrder === 'II';
  if (!littleEndian && byteOrder !== 'MM') {
    return null;
  }
  if (readTiffNumber(buffer, 2, 2, littleEndian) !== 42) {
    return null;
  }
  const ifdOffset = readTiffNumber(buffer, 4, 4, littleEndian);
  return ifdOffset > 0 ? { littleEndian, ifdOffset } : null;
}

async function getTiffDimensionsFromFile(filePath: string): Promise<ImageDimensions | null> {
  const header = await readFileHead(filePath, 8);
  const order = tiffByteOrder(header);
  if (!order) {
    return null;
  }

  const countBuffer = await readFileRange(filePath, order.ifdOffset, 2);
  const entryCount = readTiffNumber(countBuffer, 0, 2, order.littleEndian);
  if (entryCount <= 0 || entryCount > 4096) {
    return null;
  }

  const entries = await readFileRange(filePath, order.ifdOffset + 2, entryCount * 12);
  let width = 0;
  let height = 0;
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = index * 12;
    if (entryOffset + 12 > entries.length) {
      break;
    }
    const tag = readTiffNumber(entries, entryOffset, 2, order.littleEndian);
    const type = readTiffNumber(entries, entryOffset + 2, 2, order.littleEndian);
    const valueOffset = entryOffset + 8;
    const value = type === 3
      ? readTiffNumber(entries, valueOffset, 2, order.littleEndian)
      : readTiffNumber(entries, valueOffset, 4, order.littleEndian);
    if (tag === 256) {
      width = value;
    } else if (tag === 257) {
      height = value;
    }
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return null;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  if (offset < 0 || offset + 3 > buffer.length) {
    return 0;
  }
  return (buffer[offset] ?? 0) | ((buffer[offset + 1] ?? 0) << 8) | ((buffer[offset + 2] ?? 0) << 16);
}

function parseWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: readUInt24LE(buffer, 24) + 1,
      height: readUInt24LE(buffer, 27) + 1,
    };
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const b1 = buffer[21] ?? 0;
    const b2 = buffer[22] ?? 0;
    const b3 = buffer[23] ?? 0;
    const b4 = buffer[24] ?? 0;
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function parseImageDimensions(buffer: Buffer, ext: string): ImageDimensions | null {
  const byExtension = (() => {
    switch (ext) {
    case '.jpg':
    case '.jpeg':
    case '.jfif':
      return parseJpegDimensions(buffer);
    case '.png':
      return parsePngDimensions(buffer);
    case '.gif':
      return parseGifDimensions(buffer);
    case '.bmp':
      return parseBmpDimensions(buffer);
    case '.tif':
    case '.tiff':
      return parseTiffDimensions(buffer);
    case '.webp':
      return parseWebpDimensions(buffer);
    case '.avif':
    default:
      return null;
    }
  })();

  if (byExtension) {
    return byExtension;
  }

  return (
    parseJpegDimensions(buffer)
    ?? parsePngDimensions(buffer)
    ?? parseGifDimensions(buffer)
    ?? parseBmpDimensions(buffer)
    ?? parseTiffDimensions(buffer)
    ?? parseWebpDimensions(buffer)
  );
}

async function getImageDimensions(filePath: string, ext: string): Promise<ImageDimensions> {
  let buffer = await readFileHead(filePath, DIMENSION_HEADER_BYTES);
  let dimensions = parseImageDimensions(buffer, ext);

  if (!dimensions && (ext === '.jpg' || ext === '.jpeg' || ext === '.jfif')) {
    buffer = await readFileHead(filePath, JPEG_DIMENSION_FALLBACK_BYTES);
    dimensions = parseImageDimensions(buffer, ext);
  }

  if (!dimensions && (ext === '.tif' || ext === '.tiff' || tiffByteOrder(buffer))) {
    dimensions = await getTiffDimensionsFromFile(filePath);
  }
  if (!dimensions) {
    try {
      const sharp = loadSharpModule();
      if (sharp) {
        const metadata = await sharp(filePath).metadata();
        if (metadata.width && metadata.height) {
          dimensions = { width: metadata.width, height: metadata.height };
        }
      }
    } catch {
      // Keep the lightweight header-parser failure path; callers record the miss.
    }
  }
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { width: 0, height: 0 };
  }
  return dimensions;
}

type ImportedPhoto = {
  id: string; path?: string; uri: string; filename: string; extension?: string; timestamp: number;
  width: number; height: number; fileSize: number; thumbnailUri?: string; fingerprint?: string; contentHash?: string; visualHash?: string;
  isScreenshot: boolean; screenshotConfidence?: number; screenshotReasons?: string[];
  tags: string[]; albumId: string;
};

type PhotoIndexRow = {
  album_id: string;
  file_path: string;
  file_path_key: string;
  id: string;
  uri: string;
  filename: string;
  extension: string | null;
  timestamp: number;
  width: number;
  height: number;
  file_size: number;
  mtime_ms: number;
  is_screenshot: number;
  screenshot_confidence: number | null;
  screenshot_reasons: string | null;
  tags: string | null;
  fingerprint: string | null;
  content_hash: string | null;
  visual_hash: string | null;
  thumbnail_path: string | null;
  thumbnail_size: number | null;
  last_scanned_at: number;
};

async function scanPhotoFolder(folderPath: string, options: PhotoScanOptions = {}): Promise<PhotoScanResult> {
  const includeDimensions = options.includeDimensions !== false;
  const resolvedRoot = assertPathAllowed(assertString(folderPath, 'folderPath'), 'scanPhotoFolder');
  const scannedAt = Date.now();
  const cacheStartedAt = performance.now();
  const cachedRows = getCachedPhotoIndex(resolvedRoot);
  const cachedIndexMs = performance.now() - cacheStartedAt;
  if (options.onCachedBatch && cachedRows.size > 0) {
    options.onCachedBatch(
      [...cachedRows.values()].slice(0, 100).map((row) => photoFromIndexRow(row)),
    );
  }
  const rowsToUpsert: PhotoIndexRow[] = [];
  const indexKeysToTouch: string[] = [];
  const failedDirs: string[] = [];
  const failedDimensions: string[] = [];
  const photos: ImportedPhoto[] = [];
  const fingerprintCandidates = new Map<string, FingerprintCandidate[]>();
  let skippedUnsupported = 0;
  let truncated = false;
  const pendingBatch: ImportedPhoto[] = [];
  const batchSize = Math.max(10, Math.min(250, options.batchSize ?? 50));

  const throwIfScanCancelled = () => {
    if (options.shouldCancel?.()) {
      const error = new Error('Photo scan cancelled.');
      error.name = 'AbortError';
      throw error;
    }
  };

  const flushBatch = async () => {
    if (pendingBatch.length === 0) return;
    options.onBatch?.(pendingBatch.splice(0), photos.length);
    if (rowsToUpsert.length >= 200) {
      upsertPhotoIndexRows(rowsToUpsert.splice(0));
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    throwIfScanCancelled();
  };

  const addScannedPhoto = async (photo: ImportedPhoto) => {
    photos.push(photo);
    pendingBatch.push(photo);
    if (pendingBatch.length >= batchSize) {
      await flushBatch();
    }
  };

  type ProcessedScanFile = {
    photo: ImportedPhoto;
    row?: PhotoIndexRow;
    touchKey?: string;
    fingerprintCandidate?: FingerprintCandidate;
  };

  const processScanFile = async (
    dir: string,
    entry: fs.Dirent,
  ): Promise<ProcessedScanFile | null> => {
    const fullPath = path.resolve(path.join(dir, entry.name));
    const ext = path.extname(entry.name).toLowerCase();
    try {
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isFile()) return null;
      const cachedRow = cachedRows.get(photoIndexKey(fullPath));
      const unchanged = Boolean(
        cachedRow
        && cachedRow.file_size === stats.size
        && Math.abs(cachedRow.mtime_ms - stats.mtimeMs) < 1,
      );
      if (unchanged && cachedRow && (!includeDimensions || (cachedRow.width > 0 && cachedRow.height > 0))) {
        const photo = photoFromIndexRow({ ...cachedRow, last_scanned_at: scannedAt });
        const screenshotInfo = detectScreenshotCandidate({
          filename: photo.filename,
          filePath: fullPath,
          albumId: resolvedRoot,
          width: photo.width,
          height: photo.height,
          fileSize: photo.fileSize,
          extension: photo.extension,
        });
        const screenshotChanged =
          photo.isScreenshot !== screenshotInfo.isScreenshot
          || photo.screenshotConfidence !== screenshotInfo.confidence
          || JSON.stringify(photo.screenshotReasons ?? []) !== JSON.stringify(screenshotInfo.reasons);
        if (screenshotChanged) {
          photo.isScreenshot = screenshotInfo.isScreenshot;
          photo.screenshotConfidence = screenshotInfo.confidence;
          photo.screenshotReasons = screenshotInfo.reasons;
          return {
            photo,
            row: buildPhotoIndexRow(photo, stats, resolvedRoot, scannedAt, cachedRow),
          };
        }
        return {
          photo,
          touchKey: cachedRow.file_path_key,
        };
      }

      let dimensions: ImageDimensions = { width: 0, height: 0 };
      if (includeDimensions) {
        try {
          dimensions = await getImageDimensions(fullPath, ext);
          if (dimensions.width <= 0 || dimensions.height <= 0) {
            failedDimensions.push(fullPath);
          }
        } catch {
          failedDimensions.push(fullPath);
        }
      } else if (unchanged && cachedRow) {
        dimensions = { width: cachedRow.width, height: cachedRow.height };
      }

      const screenshotInfo = detectScreenshotCandidate({
        filename: entry.name,
        filePath: fullPath,
        albumId: resolvedRoot,
        width: dimensions.width,
        height: dimensions.height,
        fileSize: stats.size,
        extension: ext,
      });
      const photo = toPhotoRecord(fullPath, stats, resolvedRoot, dimensions, screenshotInfo, undefined);
      if (unchanged && cachedRow?.thumbnail_path) photo.thumbnailUri = toLocalFileUri(cachedRow.thumbnail_path);
      if (unchanged && cachedRow?.fingerprint) photo.fingerprint = cachedRow.fingerprint;
      if (unchanged && cachedRow?.content_hash) photo.contentHash = cachedRow.content_hash;
      if (unchanged && cachedRow?.visual_hash) photo.visualHash = cachedRow.visual_hash;

      const fingerprintCandidate = includeDimensions
        && dimensions.width > 0
        && dimensions.height > 0
        && stats.size > 0
        ? { photo, filePath: fullPath, stats, ext, dimensions }
        : undefined;
      return {
        photo,
        row: buildPhotoIndexRow(photo, stats, resolvedRoot, scannedAt, unchanged ? cachedRow : undefined),
        ...(fingerprintCandidate ? { fingerprintCandidate } : {}),
      };
    } catch (err) {
      logger.warn('scanPhotoFolder', 'skipping inaccessible file', {
        path: fullPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };

  const scanDir = async (dir: string): Promise<void> => {
    throwIfScanCancelled();
    if (photos.length >= MAX_SCAN_PHOTOS) {
      truncated = true;
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (err) {
      failedDirs.push(dir);
      logger.warn('scanPhotoFolder', 'unreadable dir skipped', {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const fileEntries: fs.Dirent[] = [];
    const directoryEntries: fs.Dirent[] = [];
    for (const entry of entries) {
      const fullPath = path.resolve(path.join(dir, entry.name));
      if (!isInsidePath(fullPath, resolvedRoot) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name !== '.photo-manager-trash') directoryEntries.push(entry);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) {
        skippedUnsupported += 1;
        continue;
      }
      fileEntries.push(entry);
    }

    for (let index = 0; index < fileEntries.length; index += SCAN_FILE_CONCURRENCY) {
      throwIfScanCancelled();
      const results = await Promise.all(
        fileEntries.slice(index, index + SCAN_FILE_CONCURRENCY)
          .map((entry) => processScanFile(dir, entry)),
      );
      for (const result of results) {
        if (!result) continue;
        if (photos.length >= MAX_SCAN_PHOTOS) {
          truncated = true;
          return;
        }
        await addScannedPhoto(result.photo);
        if (result.row) rowsToUpsert.push(result.row);
        if (result.touchKey) indexKeysToTouch.push(result.touchKey);
        if (result.fingerprintCandidate) {
          const { photo, filePath, stats, ext, dimensions } = result.fingerprintCandidate;
          const candidateKey = `${ext}:${stats.size}:${dimensions.width}x${dimensions.height}`;
          const candidates = fingerprintCandidates.get(candidateKey) ?? [];
          candidates.push({ photo, filePath, stats, ext, dimensions });
          fingerprintCandidates.set(candidateKey, candidates);
        }
      }
    }

    for (const entry of directoryEntries) {
      await scanDir(path.resolve(path.join(dir, entry.name)));
    }
  };

  const walkStartedAt = performance.now();
  await scanDir(resolvedRoot);
  await flushBatch();
  const walkMs = performance.now() - walkStartedAt;
  throwIfScanCancelled();

  const fingerprintStartedAt = performance.now();
  if (includeDimensions) {
    for (const candidates of fingerprintCandidates.values()) {
      if (!shouldFingerprintCandidateGroup(candidates)) {
        continue;
      }
      await Promise.all(
        candidates.map(async (candidate) => {
          try {
            candidate.photo.fingerprint = await getFileFingerprint(
              candidate.filePath,
              candidate.stats,
              candidate.ext,
              candidate.dimensions,
            );
          } catch {
            delete candidate.photo.fingerprint;
          }
        }),
      );
      throwIfScanCancelled();
      upsertPhotoIndexRows(
        candidates
          .map((candidate) => {
            const cachedRow = cachedRows.get(photoIndexKey(candidate.filePath));
            return buildPhotoIndexRow(candidate.photo, candidate.stats, resolvedRoot, scannedAt, cachedRow);
          }),
      );
    }
  }
  const fingerprintMs = performance.now() - fingerprintStartedAt;

  const upsertStartedAt = performance.now();
  upsertPhotoIndexRows(rowsToUpsert);
  const upsertMs = performance.now() - upsertStartedAt;
  const touchStartedAt = performance.now();
  touchPhotoIndexRows(resolvedRoot, indexKeysToTouch, scannedAt);
  const touchMs = performance.now() - touchStartedAt;
  const staleStartedAt = performance.now();
  deleteStalePhotoIndexRows(resolvedRoot, scannedAt);
  const staleDeleteMs = performance.now() - staleStartedAt;

  return {
    photos,
    failedDirs,
    failedDimensions,
    skippedUnsupported,
    truncated,
    timings: {
      cachedIndexMs,
      walkMs,
      fingerprintMs,
      upsertMs,
      touchMs,
      staleDeleteMs,
    },
  };
}

export async function runPhotoFolderSmoke(
  folderPath: string,
  fullWorkflow = false,
  reviewTimeMode: 'rolling' | 'calendar' = 'rolling',
  hashSampleLimit = 4,
): Promise<{
  count: number;
  photos: number;
  screenshots: number;
  thumbnails: number;
  visualHashes: number;
  yearInReview: boolean;
  firstPhoto: Pick<ImportedPhoto, 'albumId' | 'filename' | 'uri'> | null;
}> {
  const resolvedFolder = path.resolve(assertString(folderPath, 'folderPath'));
  addAllowedLocalFileRoot(resolvedFolder);
  const countScan = await scanPhotoFolder(resolvedFolder, { includeDimensions: false });
  const photoScan = await scanPhotoFolder(resolvedFolder, { includeDimensions: false });
  const workflowSampleLimit = fullWorkflow ? Math.max(24, hashSampleLimit) : 0;
  const workflowPhotos = photoScan.photos.slice(0, workflowSampleLimit);
  const yearInReviewPhotos = fullWorkflow ? photoScan.photos : [];
  let thumbnails = 0;
  let visualHashes = 0;
  let yearInReview = false;

  for (const photo of workflowPhotos.slice(0, 6)) {
    if (!photo.path) {
      continue;
    }
    try {
      await ensureThumbnail(photo.path, 200);
      thumbnails += 1;
    } catch (err) {
      logger.warn('smoke', 'thumbnail smoke failed', {
        filePath: photo.path,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const hashPaths = workflowPhotos
    .slice(0, Math.max(0, hashSampleLimit))
    .map((photo) => photo.path)
    .filter((filePath): filePath is string => Boolean(filePath));
  const cachedVisualHashes = getCachedVisualHashes(hashPaths);
  visualHashes += cachedVisualHashes.size;
  for (const filePath of hashPaths) {
    if (cachedVisualHashes.has(filePath)) {
      continue;
    }
    try {
      const hash = await computeVisualHashForFile(filePath);
      updatePhotoIndexVisualHash(filePath, hash);
      visualHashes += 1;
    } catch (err) {
      logger.warn('smoke', 'visual hash smoke failed', {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (yearInReviewPhotos.length > 0) {
    try {
      const result = await generateYearInReview(
        yearInReviewPhotos.map((photo) => ({
          uri: photo.uri,
          filename: photo.filename,
          timestamp: photo.timestamp,
          width: photo.width,
          height: photo.height,
          fileSize: photo.fileSize,
          isScreenshot: photo.isScreenshot,
          ...(photo.thumbnailUri ? { thumbnailUri: photo.thumbnailUri } : {}),
        })),
        getAppOutputRoot(),
        reviewTimeMode,
        'en',
      );
      yearInReview = Boolean(result);
    } catch (err) {
      logger.warn('smoke', 'year in review smoke failed', err);
    }
  }

  const firstPhoto = photoScan.photos[0]
    ? {
        albumId: photoScan.photos[0].albumId,
        filename: photoScan.photos[0].filename,
        uri: photoScan.photos[0].uri,
      }
    : null;

  return {
    count: countScan.photos.length,
    photos: photoScan.photos.length,
    screenshots: photoScan.photos.filter((photo) => photo.isScreenshot).length,
    thumbnails,
    visualHashes,
    yearInReview,
    firstPhoto,
  };
}

export async function runPhotoFolderProgressBenchmark(folderPath: string): Promise<{
  count: number;
  firstBatchCount: number;
  firstBatchMs: number;
  coldScanMs: number;
  warmScanMs: number;
  batchCount: number;
  peakRssBytes: number;
  cancellationObserved: boolean;
  coldTimings: PhotoScanResult['timings'];
  warmTimings: PhotoScanResult['timings'];
}> {
  const resolvedFolder = path.resolve(assertString(folderPath, 'folderPath'));
  addAllowedLocalFileRoot(resolvedFolder);
  const startedAt = performance.now();
  let firstBatchCount = 0;
  let firstBatchMs = 0;
  let batchCount = 0;
  let peakRssBytes = process.memoryUsage().rss;
  const cold = await scanPhotoFolder(resolvedFolder, {
    includeDimensions: false,
    batchSize: 50,
    onBatch: (batch) => {
      batchCount += 1;
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
      if (firstBatchCount === 0) {
        firstBatchCount = batch.length;
        firstBatchMs = performance.now() - startedAt;
      }
    },
    onCachedBatch: (batch) => {
      if (firstBatchCount === 0) {
        firstBatchCount = batch.length;
        firstBatchMs = performance.now() - startedAt;
      }
    },
  });
  const coldScanMs = performance.now() - startedAt;

  const warmStartedAt = performance.now();
  const warm = await scanPhotoFolder(resolvedFolder, { includeDimensions: false, batchSize: 50 });
  const warmScanMs = performance.now() - warmStartedAt;

  let cancelAfter = 120;
  let cancellationObserved = false;
  try {
    await scanPhotoFolder(resolvedFolder, {
      includeDimensions: false,
      batchSize: 50,
      shouldCancel: () => cancelAfter <= 0,
      onBatch: (batch) => {
        cancelAfter -= batch.length;
      },
    });
  } catch (error) {
    cancellationObserved = error instanceof Error && error.name === 'AbortError';
  }

  return {
    count: cold.photos.length,
    firstBatchCount,
    firstBatchMs,
    coldScanMs,
    warmScanMs,
    batchCount,
    peakRssBytes,
    cancellationObserved,
    coldTimings: cold.timings,
    warmTimings: warm.timings,
  };
}

export async function runVisionPreviewBenchmark(filePath: string): Promise<{
  sourceBytes: number;
  previewBytes: number;
  width: number;
  height: number;
  firstMs: number;
  cachedMs: number;
  reusedCachePath: boolean;
  sourcePassthrough: boolean;
  mimeType: string;
}> {
  const resolvedPath = path.resolve(assertString(filePath, 'filePath'));
  const sourceStats = await fs.promises.stat(resolvedPath);
  const firstStartedAt = performance.now();
  const first = await getVisionPreviewPayload(resolvedPath, 1536);
  const firstMs = performance.now() - firstStartedAt;
  const cachedStartedAt = performance.now();
  const cached = await getVisionPreviewPayload(resolvedPath, 1536);
  const cachedMs = performance.now() - cachedStartedAt;
  if (
    first.data.length <= 0
    || first.width <= 0
    || first.height <= 0
    || Math.max(first.width, first.height) > 1536
  ) {
    throw new Error('Vision preview benchmark produced an invalid sampled image.');
  }
  return {
    sourceBytes: sourceStats.size,
    previewBytes: first.data.length,
    width: first.width,
    height: first.height,
    firstMs,
    cachedMs,
    reusedCachePath: first.cachePath === cached.cachePath,
    sourcePassthrough: first.cachePath === resolvedPath,
    mimeType: first.mimeType,
  };
}

const thumbnailTaskQueue: ThumbnailTask[] = [];
const thumbnailJobs = new Map<string, Promise<string>>();
let activeThumbnailTasks = 0;

function loadCanvasModule(): {
  createCanvas: (width: number, height: number) => {
    getContext: (contextId: '2d') => {
      drawImage: (
        image: { width: number; height: number },
        dx: number,
        dy: number,
        dWidth: number,
        dHeight: number,
      ) => void;
      getImageData: (
        sx: number,
        sy: number,
        sw: number,
        sh: number,
      ) => { data: Uint8ClampedArray };
    };
    toBuffer: (mimeType: 'image/jpeg', config: { quality: number }) => Buffer;
  };
  loadImage: (source: string | Buffer) => Promise<{ width: number; height: number }>;
} {
  try {
    return require('canvas') as ReturnType<typeof loadCanvasModule>;
  } catch (err) {
    logger.error('native', 'canvas failed to load', err);
    throw new Error(`canvas failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function loadSharpModule():
  | ((input: Buffer | string) => {
      metadata: () => Promise<{ width?: number; height?: number }>;
      rotate: () => any;
      resize: (width: number, height: number, options: { fit: 'cover'; position: 'centre' }) => any;
      jpeg: (options: { quality: number }) => any;
      toBuffer: () => Promise<Buffer>;
    })
  | null {
  try {
    return require('sharp') as ReturnType<typeof loadSharpModule>;
  } catch {
    return null;
  }
}

async function loadCanvasImage(
  loadImage: (source: string | Buffer) => Promise<{ width: number; height: number }>,
  filePath: string,
): Promise<{ width: number; height: number }> {
  if (process.platform === 'win32') {
    return loadImage(await fs.promises.readFile(filePath));
  }

  try {
    return await loadImage(filePath);
  } catch (pathErr) {
    logger.warn('thumbnail', 'canvas loadImage path failed, retrying with buffer', {
      filePath,
      error: pathErr instanceof Error ? pathErr.message : String(pathErr),
    });
    return loadImage(await fs.promises.readFile(filePath));
  }
}

function getDb(): SqliteDb {
  if (!db) {
    if (!SqliteConstructor) {
      try {
        SqliteConstructor = require('better-sqlite3') as typeof BetterSqlite3Type;
      } catch (err) {
        logger.error('native', 'better-sqlite3 failed to load', err);
        throw new Error(
          `better-sqlite3 failed to load (may need electron-rebuild): ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    const dbPath = path.join(app.getPath('userData'), 'photo-manager.db');
    db = new SqliteConstructor(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function tryGetPhotoIndexDb(scope: string): SqliteDb | null {
  if (photoIndexDisabledReason) {
    return null;
  }

  try {
    return getDb();
  } catch (err) {
    photoIndexDisabledReason = err instanceof Error ? err.message : String(err);
    logger.error('photoIndex', `${scope} disabled SQLite photo index`, photoIndexDisabledReason);
    return null;
  }
}

let photoIndexSchemaReady = false;
let taskCheckpointSchemaReady = false;

function ensureTaskCheckpointSchema(database = getDb()): void {
  if (taskCheckpointSchemaReady) {
    return;
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_checkpoints (
      checkpoint_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  taskCheckpointSchemaReady = true;
}

function assertCheckpointKey(value: unknown): string {
  const key = assertString(value, 'checkpointKey');
  if (!/^photo-task:v1:(culling|deduplication):/.test(key) || key.length > 1024) {
    throw new Error('checkpointKey is invalid.');
  }
  return key;
}

function assertCheckpointPayload(value: unknown): string {
  const payload = assertString(value, 'checkpointPayload');
  if (Buffer.byteLength(payload, 'utf8') > 8 * 1024 * 1024) {
    throw new Error('checkpointPayload exceeds the 8 MB limit.');
  }
  const parsed = JSON.parse(payload) as { version?: unknown };
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) {
    throw new Error('checkpointPayload has an unsupported version.');
  }
  return payload;
}

function ensurePhotoIndexSchema(database = getDb()): void {
  if (photoIndexSchemaReady) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS photo_index (
      album_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_path_key TEXT NOT NULL,
      id TEXT NOT NULL,
      uri TEXT NOT NULL,
      filename TEXT NOT NULL,
      extension TEXT,
      timestamp INTEGER NOT NULL,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      file_size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      is_screenshot INTEGER NOT NULL DEFAULT 0,
      screenshot_confidence REAL,
      screenshot_reasons TEXT,
      tags TEXT,
      fingerprint TEXT,
      content_hash TEXT,
      visual_hash TEXT,
      thumbnail_path TEXT,
      thumbnail_size INTEGER,
      last_scanned_at INTEGER NOT NULL,
      PRIMARY KEY (album_id, file_path_key)
    );
    CREATE INDEX IF NOT EXISTS idx_photo_index_album_scanned
      ON photo_index(album_id, last_scanned_at);
    CREATE INDEX IF NOT EXISTS idx_photo_index_file_path_key
      ON photo_index(file_path_key);
    CREATE INDEX IF NOT EXISTS idx_photo_index_candidates
      ON photo_index(album_id, file_size, width, height, extension);
  `);
  const columns = database.prepare('PRAGMA table_info(photo_index)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'content_hash')) {
    database.exec('ALTER TABLE photo_index ADD COLUMN content_hash TEXT');
  }
  photoIndexSchemaReady = true;
}

function photoIndexKey(filePath: string): string {
  return normalizeForPathCompare(filePath);
}

function parseJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function photoFromIndexRow(row: PhotoIndexRow): ImportedPhoto {
  const thumbnailUri = row.thumbnail_path ? toLocalFileUri(row.thumbnail_path) : undefined;
  return {
    id: row.id,
    path: row.file_path,
    uri: row.uri,
    filename: row.filename,
    timestamp: row.timestamp,
    width: row.width,
    height: row.height,
    fileSize: row.file_size,
    ...(row.extension ? { extension: row.extension } : {}),
    ...(thumbnailUri ? { thumbnailUri } : {}),
    ...(row.fingerprint ? { fingerprint: row.fingerprint } : {}),
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    ...(row.visual_hash ? { visualHash: row.visual_hash } : {}),
    isScreenshot: row.is_screenshot === 1,
    ...(row.screenshot_confidence != null ? { screenshotConfidence: row.screenshot_confidence } : {}),
    screenshotReasons: parseJsonArray(row.screenshot_reasons),
    tags: parseJsonArray(row.tags),
    albumId: row.album_id,
  };
}

function buildPhotoIndexRow(
  photo: ImportedPhoto,
  stats: fs.Stats,
  albumId: string,
  scannedAt: number,
  existing?: PhotoIndexRow,
): PhotoIndexRow {
  const filePath = path.resolve(photo.path ?? photo.uri);
  const cachedThumbnailPath = existing?.thumbnail_path;
  return {
    album_id: albumId,
    file_path: filePath,
    file_path_key: photoIndexKey(filePath),
    id: photo.id,
    uri: photo.uri,
    filename: photo.filename,
    extension: photo.extension ?? null,
    timestamp: photo.timestamp,
    width: photo.width,
    height: photo.height,
    file_size: stats.size,
    mtime_ms: stats.mtimeMs,
    is_screenshot: photo.isScreenshot ? 1 : 0,
    screenshot_confidence: photo.screenshotConfidence ?? null,
    screenshot_reasons: JSON.stringify(photo.screenshotReasons ?? []),
    tags: JSON.stringify(photo.tags ?? []),
    fingerprint: photo.fingerprint ?? existing?.fingerprint ?? null,
    content_hash: photo.contentHash ?? existing?.content_hash ?? null,
    visual_hash: photo.visualHash ?? existing?.visual_hash ?? null,
    thumbnail_path: cachedThumbnailPath ?? null,
    thumbnail_size: existing?.thumbnail_size ?? null,
    last_scanned_at: scannedAt,
  };
}

function upsertPhotoIndexRows(rows: PhotoIndexRow[]): void {
  if (rows.length === 0) {
    return;
  }

  const database = tryGetPhotoIndexDb('upsert');
  if (!database) {
    return;
  }
  ensurePhotoIndexSchema(database);
  const statement = database.prepare(`
    INSERT INTO photo_index (
      album_id, file_path, file_path_key, id, uri, filename, extension, timestamp,
      width, height, file_size, mtime_ms, is_screenshot, screenshot_confidence,
      screenshot_reasons, tags, fingerprint, content_hash, visual_hash, thumbnail_path,
      thumbnail_size, last_scanned_at
    )
    VALUES (
      @album_id, @file_path, @file_path_key, @id, @uri, @filename, @extension, @timestamp,
      @width, @height, @file_size, @mtime_ms, @is_screenshot, @screenshot_confidence,
      @screenshot_reasons, @tags, @fingerprint, @content_hash, @visual_hash, @thumbnail_path,
      @thumbnail_size, @last_scanned_at
    )
    ON CONFLICT(album_id, file_path_key) DO UPDATE SET
      file_path = excluded.file_path,
      id = excluded.id,
      uri = excluded.uri,
      filename = excluded.filename,
      extension = excluded.extension,
      timestamp = excluded.timestamp,
      width = CASE
        WHEN excluded.width > 0 THEN excluded.width
        ELSE photo_index.width
      END,
      height = CASE
        WHEN excluded.height > 0 THEN excluded.height
        ELSE photo_index.height
      END,
      file_size = excluded.file_size,
      mtime_ms = excluded.mtime_ms,
      is_screenshot = excluded.is_screenshot,
      screenshot_confidence = excluded.screenshot_confidence,
      screenshot_reasons = excluded.screenshot_reasons,
      tags = excluded.tags,
      fingerprint = COALESCE(excluded.fingerprint, photo_index.fingerprint),
      content_hash = COALESCE(excluded.content_hash, photo_index.content_hash),
      visual_hash = COALESCE(excluded.visual_hash, photo_index.visual_hash),
      thumbnail_path = photo_index.thumbnail_path,
      thumbnail_size = photo_index.thumbnail_size,
      last_scanned_at = excluded.last_scanned_at
  `);
  const transaction = database.transaction((items: PhotoIndexRow[]) => {
    for (const row of items) {
      statement.run(row);
    }
  });
  transaction(rows);
}

function getCachedPhotoIndex(albumId: string): Map<string, PhotoIndexRow> {
  const database = tryGetPhotoIndexDb('read');
  if (!database) {
    return new Map();
  }
  ensurePhotoIndexSchema(database);
  const rows = database
    .prepare('SELECT * FROM photo_index WHERE album_id = ?')
    .all(albumId) as PhotoIndexRow[];
  const siblingStatement = database.prepare(`
    SELECT *
    FROM photo_index
    WHERE file_path_key = ?
    ORDER BY last_scanned_at DESC
  `);
  return new Map(rows.map((row) => {
    const siblings = (siblingStatement.all(row.file_path_key) as PhotoIndexRow[]).filter(
      (candidate) =>
        candidate.file_size === row.file_size && Math.abs(candidate.mtime_ms - row.mtime_ms) < 1,
    );
    const dimensions = siblings.find((candidate) => candidate.width > 0 && candidate.height > 0);
    const visualHash = siblings.find((candidate) => candidate.visual_hash?.startsWith('v2:'));
    const contentHash = siblings.find((candidate) => Boolean(candidate.content_hash));
    const fingerprint = siblings.find((candidate) => Boolean(candidate.fingerprint));
    const thumbnail = siblings.find((candidate) => Boolean(candidate.thumbnail_path));
    return [
      row.file_path_key,
      {
        ...row,
        width: row.width > 0 ? row.width : dimensions?.width ?? 0,
        height: row.height > 0 ? row.height : dimensions?.height ?? 0,
        visual_hash: row.visual_hash ?? visualHash?.visual_hash ?? null,
        content_hash: row.content_hash ?? contentHash?.content_hash ?? null,
        fingerprint: row.fingerprint ?? fingerprint?.fingerprint ?? null,
        thumbnail_path: row.thumbnail_path ?? thumbnail?.thumbnail_path ?? null,
        thumbnail_size: row.thumbnail_size ?? thumbnail?.thumbnail_size ?? null,
      },
    ];
  }));
}

function touchPhotoIndexRows(albumId: string, filePathKeys: string[], scannedAt: number): void {
  if (filePathKeys.length === 0) return;
  const database = tryGetPhotoIndexDb('touch unchanged rows');
  if (!database) return;
  ensurePhotoIndexSchema(database);
  const transaction = database.transaction((keys: string[]) => {
    for (let index = 0; index < keys.length; index += 500) {
      const chunk = keys.slice(index, index + 500);
      const placeholders = chunk.map(() => '?').join(',');
      database.prepare(`
        UPDATE photo_index
        SET last_scanned_at = ?
        WHERE album_id = ? AND file_path_key IN (${placeholders})
      `).run(scannedAt, albumId, ...chunk);
    }
  });
  transaction(filePathKeys);
}

function deleteStalePhotoIndexRows(albumId: string, scannedAt: number): void {
  const database = tryGetPhotoIndexDb('delete stale rows');
  if (!database) {
    return;
  }
  ensurePhotoIndexSchema(database);
  database
    .prepare('DELETE FROM photo_index WHERE album_id = ? AND last_scanned_at < ?')
    .run(albumId, scannedAt);
}

function updatePhotoIndexThumbnail(filePath: string, thumbnailPath: string, thumbnailSize: number): void {
  const database = tryGetPhotoIndexDb('thumbnail update');
  if (!database) {
    return;
  }
  ensurePhotoIndexSchema(database);
  database
    .prepare(`
      UPDATE photo_index
      SET thumbnail_path = ?, thumbnail_size = ?
      WHERE file_path_key = ?
    `)
    .run(thumbnailPath, thumbnailSize, photoIndexKey(filePath));
}

function getCachedVisualHashes(filePaths: string[]): Map<string, string> {
  if (filePaths.length === 0) {
    return new Map();
  }

  const database = tryGetPhotoIndexDb('visual hash read');
  if (!database) {
    return new Map();
  }
  ensurePhotoIndexSchema(database);
  const statement = database.prepare(`
    SELECT file_path, file_path_key, visual_hash, file_size, mtime_ms
    FROM photo_index
    WHERE file_path_key = ? AND visual_hash LIKE 'v2:%'
    ORDER BY last_scanned_at DESC
  `);
  const hashes = new Map<string, string>();
  for (const filePath of filePaths) {
    const rows = statement.all(photoIndexKey(filePath)) as Array<
      Pick<PhotoIndexRow, 'file_path' | 'file_path_key' | 'visual_hash' | 'file_size' | 'mtime_ms'>
    >;
    try {
      const stats = fs.statSync(filePath);
      const row = rows.find((candidate) =>
        stats.size === candidate.file_size && Math.abs(stats.mtimeMs - candidate.mtime_ms) < 1,
      );
      if (row?.visual_hash?.startsWith('v2:')) {
        hashes.set(filePath, row.visual_hash);
      }
    } catch {
      // Ignore vanished files; caller records them as hash failures if needed.
    }
  }
  return hashes;
}

function updatePhotoIndexVisualHash(filePath: string, hash: string): void {
  const database = tryGetPhotoIndexDb('visual hash update');
  if (!database) {
    return;
  }
  ensurePhotoIndexSchema(database);
  database
    .prepare('UPDATE photo_index SET visual_hash = ? WHERE file_path_key = ?')
    .run(hash, photoIndexKey(filePath));
}

function getCachedContentHashes(filePaths: string[]): Map<string, string> {
  if (filePaths.length === 0) {
    return new Map();
  }

  const database = tryGetPhotoIndexDb('content hash read');
  if (!database) {
    return new Map();
  }
  ensurePhotoIndexSchema(database);
  const statement = database.prepare(`
    SELECT file_path, file_path_key, content_hash, file_size, mtime_ms
    FROM photo_index
    WHERE file_path_key = ? AND content_hash IS NOT NULL AND content_hash <> ''
    ORDER BY last_scanned_at DESC
  `);
  const hashes = new Map<string, string>();
  for (const filePath of filePaths) {
    const rows = statement.all(photoIndexKey(filePath)) as Array<
      Pick<PhotoIndexRow, 'file_path' | 'file_path_key' | 'content_hash' | 'file_size' | 'mtime_ms'>
    >;
    try {
      const stats = fs.statSync(filePath);
      const row = rows.find((candidate) =>
        stats.size === candidate.file_size && Math.abs(stats.mtimeMs - candidate.mtime_ms) < 1,
      );
      if (row?.content_hash) {
        hashes.set(filePath, row.content_hash);
      }
    } catch {
      // Vanished files are reported by the caller.
    }
  }
  return hashes;
}

function updatePhotoIndexContentHash(filePath: string, hash: string): void {
  const database = tryGetPhotoIndexDb('content hash update');
  if (!database) {
    return;
  }
  ensurePhotoIndexSchema(database);
  database
    .prepare('UPDATE photo_index SET content_hash = ? WHERE file_path_key = ?')
    .run(hash, photoIndexKey(filePath));
}

function pumpThumbnailTaskQueue(): void {
  while (
    activeThumbnailTasks < THUMBNAIL_MAX_CONCURRENT_TASKS
    && thumbnailTaskQueue.length > 0
  ) {
    const nextTask = thumbnailTaskQueue.shift();
    if (!nextTask) {
      return;
    }

    activeThumbnailTasks += 1;
    void nextTask.run()
      .then(nextTask.resolve, nextTask.reject)
      .finally(() => {
        activeThumbnailTasks -= 1;
        pumpThumbnailTaskQueue();
      });
  }
}

function enqueueThumbnailTask<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    thumbnailTaskQueue.push({
      run: async () => run(),
      resolve: (value) => resolve(value as T),
      reject,
    });
    pumpThumbnailTaskQueue();
  });
}

function normalizeNativePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  return process.platform === 'win32'
    ? resolvedPath.replace(/\//g, path.sep)
    : resolvedPath;
}

function toThumbnailFallbackUri(filePath: string): string | null {
  if (!filePath) {
    return null;
  }

  if (filePath.startsWith('local-file:///')) {
    return filePath;
  }

  if (filePath.startsWith('local-photo:///')) {
    return `local-file:///${filePath.slice('local-photo:///'.length)}`;
  }

  try {
    return toLocalFileUri(filePath);
  } catch {
    return null;
  }
}

async function getThumbnailCachePath(
  filePath: string,
  size: number,
  variant = 'thumbnail',
): Promise<string> {
  const normalizedPath = normalizeNativePath(filePath);
  const fileStats = await fs.promises.stat(normalizedPath);
  const cacheKey = createHash('sha1')
    .update(
      JSON.stringify({
        normalizedPath,
        mtimeMs: fileStats.mtimeMs,
        size: fileStats.size,
        thumbnailSize: size,
        variant,
      }),
    )
    .digest('hex');

  return path.join(getThumbnailRoot(), `${cacheKey}.jpg`);
}

async function ensureVisionPreview(filePath: string, maxDimension: number): Promise<string> {
  const normalizedPath = normalizeNativePath(filePath);
  const cachePath = await getThumbnailCachePath(normalizedPath, maxDimension, 'vision-preview-v1');
  try {
    const cacheStats = await fs.promises.stat(cachePath);
    if (cacheStats.size > 0) {
      return cachePath;
    }
  } catch {
    // Cache miss - generate below.
  }

  const inFlight = thumbnailJobs.get(cachePath);
  if (inFlight) {
    return inFlight;
  }

  const nextJob = enqueueThumbnailTask(async () => {
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    const sharp = loadSharpModule();
    let outputBuffer: Buffer;
    if (sharp) {
      outputBuffer = await sharp(normalizedPath)
        .rotate()
        .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 86 })
        .toBuffer();
    } else {
      const { createCanvas, loadImage } = loadCanvasModule();
      const image = await loadCanvasImage(loadImage, normalizedPath);
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = createCanvas(width, height);
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      outputBuffer = canvas.toBuffer('image/jpeg', { quality: 0.86 });
    }
    if (outputBuffer.length === 0) {
      throw new Error('Vision preview encoder returned an empty image.');
    }
    await fs.promises.writeFile(cachePath, outputBuffer);
    return cachePath;
  });
  thumbnailJobs.set(cachePath, nextJob);
  try {
    return await nextJob;
  } finally {
    thumbnailJobs.delete(cachePath);
  }
}

async function getVisionPreviewPayload(
  filePath: string,
  maxDimension: number,
): Promise<{
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
  cachePath: string;
}> {
  const normalizedPath = normalizeNativePath(filePath);
  const ext = path.extname(normalizedPath).toLowerCase();
  const sourceStats = await fs.promises.stat(normalizedPath);
  if (
    sourceStats.size <= MAX_VISION_PASSTHROUGH_BYTES
    && ['.png', '.webp'].includes(ext)
  ) {
    const dimensions = await getImageDimensions(normalizedPath, ext);
    if (Math.max(dimensions.width, dimensions.height) <= maxDimension) {
      return {
        data: await fs.promises.readFile(normalizedPath),
        mimeType: ext === '.png' ? 'image/png' : 'image/webp',
        width: dimensions.width,
        height: dimensions.height,
        cachePath: normalizedPath,
      };
    }
  }

  const previewPath = await ensureVisionPreview(normalizedPath, maxDimension);
  const dimensions = await getImageDimensions(previewPath, '.jpg');
  return {
    data: await fs.promises.readFile(previewPath),
    mimeType: 'image/jpeg',
    width: dimensions.width,
    height: dimensions.height,
    cachePath: previewPath,
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Task cancelled.');
  }
}

async function computeVisualHashForFile(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const normalizedPath = normalizeNativePath(filePath);
  const { createCanvas, loadImage } = loadCanvasModule();
  const image = await loadCanvasImage(loadImage, normalizedPath);
  throwIfAborted(signal);

  if (
    !image
    || !Number.isFinite(image.width)
    || !Number.isFinite(image.height)
    || image.width <= 0
    || image.height <= 0
  ) {
    throw new Error(`Cannot compute visual hash for invalid image: ${normalizedPath}`);
  }

  const canvas = createCanvas(VISUAL_HASH_SIZE, VISUAL_HASH_SIZE);
  try {
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, VISUAL_HASH_SIZE, VISUAL_HASH_SIZE);
    throwIfAborted(signal);
    const data = context.getImageData(0, 0, VISUAL_HASH_SIZE, VISUAL_HASH_SIZE).data;
    return computeVisualHashSignature(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      VISUAL_HASH_SIZE,
      VISUAL_HASH_SIZE,
    );
  } finally {
    const releasableCanvas = canvas as typeof canvas & { width: number; height: number };
    releasableCanvas.width = 0;
    releasableCanvas.height = 0;
    try {
      (image as typeof image & { src: Buffer }).src = Buffer.alloc(0);
    } catch {
      // Some Canvas backends expose a read-only image source.
    }
  }
}

const VISUAL_HASH_WORKER_BATCH_SIZE = 32;

type VisualHashWorkerMessage =
  | { type: 'result'; filePath: string; hash: string }
  | { type: 'result'; filePath: string; error: string }
  | { type: 'done' };

function runVisualHashWorkerBatch(
  filePaths: string[],
  signal: AbortSignal,
  onResult: (message: Exclude<VisualHashWorkerMessage, { type: 'done' }>) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = fork(path.join(__dirname, 'visualHashWorker.js'), [], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let settled = false;
    const completedPaths = new Set<string>();
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => {
      worker.kill();
      finish(new Error('Task cancelled.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) {
        const remainingPaths = filePaths.filter((filePath) => !completedPaths.has(filePath));
        finish(new RecoverableBatchError(
          `Visual hash worker exited before returning results (code ${code ?? 'unknown'}).`,
          remainingPaths,
        ));
      }
    });
    worker.on('message', (message: VisualHashWorkerMessage) => {
      if (message.type === 'done') {
        finish(null);
        return;
      }
      if (message.filePath !== '__worker') {
        completedPaths.add(message.filePath);
      }
      onResult(message);
    });
    worker.send({ filePaths });
  });
}

async function computeVisualHashesInWorker(
  filePaths: string[],
  signal: AbortSignal,
): Promise<{ hashes: Record<string, string>; errors: Record<string, string> }> {
  const hashes: Record<string, string> = {};
  const errors: Record<string, string> = {};

  await runCrashIsolatedBatches(
    filePaths,
    VISUAL_HASH_WORKER_BATCH_SIZE,
    async (batch) => {
      throwIfAborted(signal);
      await runVisualHashWorkerBatch(batch, signal, (message) => {
        if ('hash' in message) {
          hashes[message.filePath] = message.hash;
          updatePhotoIndexVisualHash(message.filePath, message.hash);
        } else if (message.filePath !== '__worker') {
          errors[message.filePath] = message.error;
        }
      });
    },
    (filePath, error) => {
      errors[filePath] = error.message;
      logger.warn('visualHash', 'isolated image after native worker crash', {
        file: path.basename(filePath),
        error: error.message,
      });
    },
  );

  return { hashes, errors };
}

async function computeContentHashForFile(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const hash = createHash('sha256');
  const stream = fs.createReadStream(normalizeNativePath(filePath));

  return await new Promise<string>((resolve, reject) => {
    const abort = () => stream.destroy(new Error('Task cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    stream.on('data', (chunk) => {
      if (signal?.aborted) {
        abort();
        return;
      }
      hash.update(chunk);
    });
    stream.on('error', (err) => {
      signal?.removeEventListener('abort', abort);
      reject(err);
    });
    stream.on('end', () => {
      signal?.removeEventListener('abort', abort);
      resolve(hash.digest('hex'));
    });
  });
}

async function ensureThumbnail(filePath: string, size: number, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const normalizedPath = normalizeNativePath(filePath);
  const cachePath = await getThumbnailCachePath(normalizedPath, size);
  const ext = path.extname(normalizedPath).toLowerCase();

  throwIfAborted(signal);
  try {
    const cacheStats = await fs.promises.stat(cachePath);
    if (cacheStats.size > 0) {
      return cachePath;
    }
  } catch {
    // Cache miss - generate below.
  }

  const inFlight = thumbnailJobs.get(cachePath);
  if (inFlight) {
    return inFlight;
  }

  const nextJob = enqueueThumbnailTask(async () => {
    throwIfAborted(signal);
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });

    try {
      const sharp = loadSharpModule();
      if (sharp) {
        logger.debug('thumbnail', 'thumbnail step start', {
          filePath: normalizedPath,
          ext,
          step: 'sharp.jpeg',
        });
        let outputBuffer: Buffer;
        try {
          throwIfAborted(signal);
          const sharpInput = process.platform === 'win32'
            ? await fs.promises.readFile(normalizedPath)
            : normalizedPath;
          outputBuffer = await sharp(sharpInput)
            .rotate()
            .resize(size, size, { fit: 'cover', position: 'centre' })
            .jpeg({ quality: 82 })
            .toBuffer();
        } catch (err) {
          throw new Error(`Thumbnail sharp.jpeg step failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        throwIfAborted(signal);
        logger.debug('thumbnail', 'thumbnail step success', {
          filePath: normalizedPath,
          ext,
          outputBufferLength: outputBuffer.length,
          step: 'sharp.jpeg',
        });
        if (!outputBuffer || outputBuffer.length === 0) {
          throw new Error(`Thumbnail sharp encode failed: ${normalizedPath}`);
        }
        throwIfAborted(signal);
        await fs.promises.writeFile(cachePath, outputBuffer);
        return cachePath;
      }

      const { createCanvas, loadImage } = loadCanvasModule();

      logger.debug('thumbnail', 'thumbnail step start', {
        filePath: normalizedPath,
        ext,
        step: 'loadImage',
      });
      let image: { width: number; height: number };
      try {
        throwIfAborted(signal);
        image = await loadCanvasImage(loadImage, normalizedPath);
      } catch (err) {
        throw new Error(`Thumbnail loadImage step failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      throwIfAborted(signal);
      logger.debug('thumbnail', 'thumbnail step success', {
        filePath: normalizedPath,
        ext,
        imageHeight: image?.height,
        imageWidth: image?.width,
        step: 'loadImage',
      });

      if (
        !image
        || !Number.isFinite(image.width)
        || !Number.isFinite(image.height)
        || image.width <= 0
        || image.height <= 0
      ) {
        throw new Error(`Thumbnail loadImage returned invalid image dimensions: ${normalizedPath}`);
      }

      logger.debug('thumbnail', 'thumbnail step start', {
        filePath: normalizedPath,
        ext,
        imageHeight: image.height,
        imageWidth: image.width,
        step: 'createCanvas',
      });
      let canvas: ReturnType<typeof createCanvas>;
      let context: ReturnType<ReturnType<typeof createCanvas>['getContext']>;
      try {
        canvas = createCanvas(size, size);
        context = canvas.getContext('2d');
      } catch (err) {
        throw new Error(`Thumbnail createCanvas step failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      logger.debug('thumbnail', 'thumbnail step success', {
        filePath: normalizedPath,
        ext,
        imageHeight: image.height,
        imageWidth: image.width,
        step: 'createCanvas',
      });

      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const offsetX = (size - width) / 2;
      const offsetY = (size - height) / 2;

      logger.debug('thumbnail', 'thumbnail step start', {
        filePath: normalizedPath,
        ext,
        imageHeight: image.height,
        imageWidth: image.width,
        step: 'drawImage',
      });
      try {
        throwIfAborted(signal);
        context.drawImage(image, offsetX, offsetY, width, height);
      } catch (err) {
        throw new Error(`Thumbnail drawImage step failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      throwIfAborted(signal);
      logger.debug('thumbnail', 'thumbnail step success', {
        filePath: normalizedPath,
        ext,
        imageHeight: image.height,
        imageWidth: image.width,
        step: 'drawImage',
      });

      logger.debug('thumbnail', 'thumbnail step start', {
        filePath: normalizedPath,
        ext,
        imageHeight: image.height,
        imageWidth: image.width,
        step: 'toBuffer',
      });
      let outputBuffer: Buffer;
      try {
        outputBuffer = canvas.toBuffer('image/jpeg', { quality: 0.82 });
      } catch (err) {
        throw new Error(`Thumbnail toBuffer step failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      throwIfAborted(signal);
      logger.debug('thumbnail', 'thumbnail step success', {
        filePath: normalizedPath,
        ext,
        imageHeight: image.height,
        imageWidth: image.width,
        outputBufferLength: outputBuffer?.length,
        step: 'toBuffer',
      });
      if (!outputBuffer || outputBuffer.length === 0) {
        throw new Error(`Thumbnail encode failed: ${normalizedPath}`);
      }

      throwIfAborted(signal);
      await fs.promises.writeFile(cachePath, outputBuffer);
      return cachePath;
    } catch (err) {
      logger.warn('thumbnail', 'thumbnail generation step failed', {
        filePath: normalizedPath,
        ext,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });

  thumbnailJobs.set(cachePath, nextJob);

  try {
    return await nextJob;
  } finally {
    thumbnailJobs.delete(cachePath);
  }
}

export function setupIpcHandlers(): void {
  logger.info('ipc', 'setupIpcHandlers() called');

  safeHandle('tasks:getCheckpoint', (_event, checkpointKey: string) => {
    const key = assertCheckpointKey(checkpointKey);
    const database = getDb();
    ensureTaskCheckpointSchema(database);
    const row = database.prepare(
      'SELECT payload FROM task_checkpoints WHERE checkpoint_key = ?',
    ).get(key) as { payload: string } | undefined;
    return row?.payload ?? null;
  });

  safeHandle('tasks:saveCheckpoint', (_event, checkpointKey: string, checkpointPayload: string) => {
    const key = assertCheckpointKey(checkpointKey);
    const payload = assertCheckpointPayload(checkpointPayload);
    const database = getDb();
    ensureTaskCheckpointSchema(database);
    database.prepare(`
      INSERT INTO task_checkpoints (checkpoint_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(checkpoint_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(key, payload, Date.now());
    return { saved: true };
  });

  safeHandle('tasks:deleteCheckpoint', (_event, checkpointKey: string) => {
    const key = assertCheckpointKey(checkpointKey);
    const database = getDb();
    ensureTaskCheckpointSchema(database);
    const result = database.prepare(
      'DELETE FROM task_checkpoints WHERE checkpoint_key = ?',
    ).run(key);
    return { deleted: result.changes > 0 };
  });
  addAllowedLocalFileRoot(getThumbnailRoot());
  addAllowedLocalFileRoot(getAppOutputRoot());

  // ----- File System -----

  safeHandle('fs:readDirectory', async (_event, dirPath: string) => {
    const allowedDir = assertPathAllowed(assertString(dirPath, 'dirPath'), 'readDirectory');
    const entries = await fs.promises.readdir(allowedDir, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      path: path.join(allowedDir, entry.name),
    }));
  });

  safeHandle(
    'fs:readImageAsBase64',
    async (_event, filePath: string) => {
      const { filePath: allowedPath } = await assertReadableImageFile(filePath, 'readImageAsBase64', MAX_BASE64_IMAGE_BYTES);
      const data = await fs.promises.readFile(allowedPath);
      const ext = path.extname(allowedPath).toLowerCase().slice(1);
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        heic: 'image/heic',
        heif: 'image/heif',
      };
      const mimeType = mimeMap[ext] ?? 'image/jpeg';
      return { base64: data.toString('base64'), mimeType };
    },
  );

  safeHandle(
    'fs:readImagePreviewAsBase64',
    async (_event, filePath: string, maxDimension = 1536) => {
      const { filePath: allowedPath } = await assertReadableImageFile(
        filePath,
        'readImagePreviewAsBase64',
        MAX_VISION_SOURCE_IMAGE_BYTES,
      );
      const normalizedMaxDimension = Math.max(512, Math.min(2048, Math.round(maxDimension) || 1536));
      const preview = await getVisionPreviewPayload(allowedPath, normalizedMaxDimension);
      return { base64: preview.data.toString('base64'), mimeType: preview.mimeType };
    },
  );

  safeHandle(
    'fs:getThumbnail',
    async (_event, filePath: string, size = 200) => {
      try {
        const allowedPath = assertImagePath(filePath, 'getThumbnail');
        const normalizedSize = Math.max(64, Math.min(512, Math.round(size) || 200));
        const thumbnailPath = await ensureThumbnail(allowedPath, normalizedSize);
        updatePhotoIndexThumbnail(allowedPath, thumbnailPath, normalizedSize);
        return { uri: toLocalFileUri(thumbnailPath), reason: null };
      } catch (err) {
        logger.warn('thumbnail', 'thumbnail generation failed', {
          filePath,
          error: err instanceof Error ? err.message : String(err),
        });
        return { uri: toThumbnailFallbackUri(assertString(filePath, 'filePath')), reason: 'thumbnail_failed' };
      }
    },
  );

  safeHandle(
    'fs:computeContentHashes',
    async (_event, filePaths: string[]) => {
      const nativePaths = assertStringArray(filePaths, 'filePaths')
        .slice(0, MAX_VISUAL_HASH_PHOTOS)
        .map((filePath) => assertImagePath(filePath, 'computeContentHashes'));
      const errors: Record<string, string> = {};
      const readablePaths = nativePaths.filter((filePath) => {
        try {
          return fs.statSync(filePath).isFile();
        } catch (err) {
          errors[filePath] = err instanceof Error ? err.message : String(err);
          return false;
        }
      });
      const cachedHashes = getCachedContentHashes(readablePaths);
      const hashes: Record<string, string> = Object.fromEntries(cachedHashes);
      const pathsToHash = readablePaths.filter((filePath) => !cachedHashes.has(filePath));

      await runExclusiveHeavyTask(
        'content-hash',
        'content-hash',
        30 * 60 * 1000,
        async (signal) => {
          for (const filePath of pathsToHash) {
            try {
              const hash = await computeContentHashForFile(filePath, signal);
              hashes[filePath] = hash;
              updatePhotoIndexContentHash(filePath, hash);
            } catch (err) {
              errors[filePath] = err instanceof Error ? err.message : String(err);
            }
            throwIfAborted(signal);
          }
        },
      );

      return {
        hashes,
        errors,
        truncated: filePaths.length > MAX_VISUAL_HASH_PHOTOS,
      };
    },
  );

  safeHandle(
    'fs:computeVisualHashes',
    async (_event, filePaths: string[]) => {
      const nativePaths = assertStringArray(filePaths, 'filePaths')
        .slice(0, MAX_VISUAL_HASH_PHOTOS)
        .map((filePath) => assertImagePath(filePath, 'computeVisualHashes'));
      const errors: Record<string, string> = {};
      const readablePaths = nativePaths.filter((filePath) => {
        try {
          return fs.statSync(filePath).isFile();
        } catch (err) {
          errors[filePath] = err instanceof Error ? err.message : String(err);
          return false;
        }
      });
      const cachedHashes = getCachedVisualHashes(readablePaths);
      const hashes: Record<string, string> = Object.fromEntries(cachedHashes);
      const pathsToHash = readablePaths.filter((filePath) => !cachedHashes.has(filePath));

      await runExclusiveHeavyTask(
        'visual-hash',
        'visual-hash',
        30 * 60 * 1000,
        async (signal) => {
          const workerResult = await computeVisualHashesInWorker(pathsToHash, signal);
          Object.assign(errors, workerResult.errors);
          for (const [filePath, hash] of Object.entries(workerResult.hashes)) {
            hashes[filePath] = hash;
            updatePhotoIndexVisualHash(filePath, hash);
          }
          throwIfAborted(signal);
        },
      );

      return {
        hashes,
        errors,
        truncated: filePaths.length > MAX_VISUAL_HASH_PHOTOS,
      };
    },
  );

  safeHandle('fs:cancelVisualHashes', async () => {
    const contentCancelled = cancelExclusiveHeavyTask('content-hash');
    const visualCancelled = cancelExclusiveHeavyTask('visual-hash');
    return { cancelled: contentCancelled || visualCancelled };
  });

  safeHandle('fs:moveToTrash', async (_event, filePath: string) => {
    // Normalise to native separators (renderer passes forward-slash paths on Windows)
    const nativePath = assertImagePath(filePath, 'moveToTrash');
    try {
      // Use system trash (Recycle Bin on Windows, Trash on macOS/Linux)
      await shell.trashItem(nativePath);
      return { success: true };
    } catch {
      // Fallback: move to a .photo-manager-trash folder inside the album directory
      // so the file stays close to its source and is recoverable.
      let dest: string | null = null;
      try {
        const albumDir = path.dirname(nativePath);
        const trashDir = path.join(albumDir, '.photo-manager-trash');
        await fs.promises.mkdir(trashDir, { recursive: true });
        const timestamp = Date.now();
        dest = path.join(trashDir, `${timestamp}_${path.basename(nativePath)}`);
        await fs.promises.copyFile(nativePath, dest);
        await fs.promises.unlink(nativePath);
        return { success: true, location: dest };
      } catch (err2) {
        if (dest) {
          await fs.promises.unlink(dest).catch(() => undefined);
        }
        logger.error('fs', 'moveToTrash failed', err2);
        return { success: false, error: err2 instanceof Error ? err2.message : String(err2) };
      }
    }
  });

  safeHandle('fs:getFileStats', async (_event, filePath: string) => {
    const allowedPath = assertPathAllowed(assertString(filePath, 'filePath'), 'getFileStats');
    const stats = await fs.promises.stat(allowedPath);
    return {
      size: stats.size,
      mtime: stats.mtime.getTime(),
      ctime: stats.ctime.getTime(),
    };
  });

  safeHandle('fs:deleteTrashExpired', async (_event, olderThanMs: number) => {
    if (!Number.isFinite(olderThanMs) || olderThanMs < 0 || olderThanMs > 365 * 24 * 60 * 60 * 1000) {
      throw new Error('Invalid trash retention window.');
    }
    try {
      const trashDir = path.join(app.getPath('userData'), 'trash');
      const entries = await fs.promises.readdir(trashDir);
      const now = Date.now();
      let deleted = 0;
      for (const entry of entries) {
        const entryPath = path.join(trashDir, entry);
        const stats = await fs.promises.stat(entryPath);
        if (now - stats.mtime.getTime() > olderThanMs) {
          await fs.promises.unlink(entryPath);
          deleted++;
        }
      }
      return { deleted };
    } catch {
      return { deleted: 0 };
    }
  });

  // ----- SQLite Database -----

  safeHandle(
    'db:execute',
    (_event, sql: string, params: unknown[] = []) => {
      try {
        const database = getDb();
        const stmt = database.prepare(validateSql(sql, 'write'));
        const result = stmt.run(...assertParamsArray(params));
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      } catch (err) {
        throw new Error(`DB execute error: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  safeHandle(
    'db:query',
    (_event, sql: string, params: unknown[] = []) => {
      try {
        const database = getDb();
        const stmt = database.prepare(validateSql(sql, 'read'));
        return stmt.all(...assertParamsArray(params));
      } catch (err) {
        throw new Error(`DB query error: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  safeHandle(
    'db:queryOne',
    (_event, sql: string, params: unknown[] = []) => {
      try {
        const database = getDb();
        const stmt = database.prepare(validateSql(sql, 'read'));
        return stmt.get(...assertParamsArray(params)) ?? null;
      } catch (err) {
        throw new Error(`DB queryOne error: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  safeHandle(
    'db:transaction',
    (_event, statements: Array<{ sql: string; params?: unknown[] }>) => {
      if (!Array.isArray(statements) || statements.length > 50) {
        throw new Error('Transaction must contain at most 50 statements.');
      }
      const validatedStatements = statements.map((statement) => ({
        sql: validateSql(statement.sql, 'write'),
        params: assertParamsArray(statement.params),
      }));
      const database = getDb();
      const txn = database.transaction(() => {
        for (const { sql, params } of validatedStatements) {
          database.prepare(sql).run(...params);
        }
      });
      try {
        txn();
        return { success: true };
      } catch (err) {
        throw new Error(`DB transaction error: ${err instanceof Error ? err.message : err}`);
      }
    },
  );

  // ----- Settings / Credential Store -----

  const SERVICE_NAME = 'photo-manager';
  const fallbackCredentialPath = () => path.join(app.getPath('userData'), 'settings.json');
  const credentialKey = (provider: string) => `apikey_${provider}`;

  async function readFallbackCredentialFile(): Promise<Record<string, string>> {
    try {
      return JSON.parse(
        await fs.promises.readFile(fallbackCredentialPath(), 'utf-8'),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async function writeFallbackCredentialFile(data: Record<string, string>): Promise<void> {
    await fs.promises.writeFile(fallbackCredentialPath(), JSON.stringify(data, null, 2));
  }

  function encryptFallbackApiKey(apiKey: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron secure credential storage is not available.');
    }
    return `safeStorage:${safeStorage.encryptString(apiKey).toString('base64')}`;
  }

  function decryptFallbackApiKey(value: string): string {
    if (!value.startsWith('safeStorage:')) {
      throw new Error('Saved API key must be re-entered because it was stored by an older insecure format.');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Electron secure credential storage is not available.');
    }
    const encrypted = Buffer.from(value.slice('safeStorage:'.length), 'base64');
    return safeStorage.decryptString(encrypted);
  }

  async function migrateLegacyPlaintextFallbackCredentials(): Promise<void> {
    const data = await readFallbackCredentialFile();
    let changed = false;
    let legacyCount = 0;

    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('apikey_') || typeof value !== 'string' || value.startsWith('safeStorage:')) {
        continue;
      }
      legacyCount += 1;
      if (!safeStorage.isEncryptionAvailable()) {
        delete data[key];
        changed = true;
        continue;
      }
      data[key] = encryptFallbackApiKey(value);
      changed = true;
    }

    if (changed) {
      await writeFallbackCredentialFile(data);
      logger.warn('native', 'legacy plaintext API key entries migrated or removed', { count: legacyCount });
    }
  }

  void migrateLegacyPlaintextFallbackCredentials().catch((err) => {
    logger.error('native', 'legacy API key migration failed', err);
  });

  async function readStoredApiKey(provider: LLMProvider): Promise<string | null> {
    if (
      process.env.NODE_ENV === 'development'
      && process.env.ALBUMDONE_TEST_DISABLE_STORED_KEYS === '1'
    ) {
      return null;
    }
    if (keytar) {
      return raceWithTimeout(
        keytar.getPassword(SERVICE_NAME, provider),
        CREDENTIAL_OPERATION_TIMEOUT_MS,
        'Secure credential store timed out while reading the API key.',
      );
    }
    const data = await readFallbackCredentialFile();
    const key = credentialKey(provider);
    const stored = data[key];
    if (!stored) {
      return null;
    }
    if (!stored.startsWith('safeStorage:')) {
      delete data[key];
      await writeFallbackCredentialFile(data);
      logger.warn('native', 'removed legacy plaintext API key entry', { provider });
      return null;
    }
    return decryptFallbackApiKey(stored);
  }

  function maskApiKey(apiKey: string | null): string | undefined {
    const trimmed = apiKey?.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.length <= 8) {
      return '••••';
    }
    return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
  }

  async function getApiKeyStatus(provider: LLMProvider): Promise<{
    provider: LLMProvider;
    hasApiKey: boolean;
    maskedKey?: string;
  }> {
    const apiKey = await readStoredApiKey(provider);
    const maskedKey = maskApiKey(apiKey);
    return {
      provider,
      hasApiKey: Boolean(apiKey?.trim()),
      ...(maskedKey ? { maskedKey } : {}),
    };
  }

  function createMainProviderConfig(input: {
    provider: LLMProvider;
    apiKey: string;
    baseUrl?: string | undefined;
    model: string;
    supportsVision: boolean;
    mode: ProviderMode;
  }): ProviderConfig {
    return {
      provider: input.provider,
      apiKey: input.apiKey,
      model: input.model,
      supportsVision: input.supportsVision,
      mode: input.mode,
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    };
  }

  safeHandle('settings:getApiKeyStatus', async (_event, provider: string) => {
    return getApiKeyStatus(assertLLMProvider(provider));
  });

  safeHandle('settings:getApiKey', async (_event, provider: string) => {
    return getApiKeyStatus(assertLLMProvider(provider));
  });

  safeHandle(
    'settings:setApiKey',
    async (_event, provider: string, apiKey: string) => {
      const safeProvider = assertLLMProvider(provider);
      if (typeof apiKey !== 'string' || apiKey.length > 10000) {
        throw new Error('Invalid API key.');
      }
      if (keytar) {
        await raceWithTimeout(
          keytar.setPassword(SERVICE_NAME, safeProvider, apiKey),
          CREDENTIAL_OPERATION_TIMEOUT_MS,
          'Secure credential store timed out while saving the API key.',
        );
        return;
      }
      const data = await readFallbackCredentialFile();
      data[credentialKey(safeProvider)] = encryptFallbackApiKey(apiKey);
      await writeFallbackCredentialFile(data);
    },
  );

  safeHandle('settings:deleteApiKey', async (_event, provider: string) => {
    const safeProvider = assertLLMProvider(provider);
    if (keytar) {
      await raceWithTimeout(
        keytar.deletePassword(SERVICE_NAME, safeProvider),
        CREDENTIAL_OPERATION_TIMEOUT_MS,
        'Secure credential store timed out while deleting the API key.',
      );
      return;
    }
    const data = await readFallbackCredentialFile();
    delete data[credentialKey(safeProvider)];
    await writeFallbackCredentialFile(data);
  });

  // ----- Network / LAN Server -----

  safeHandle('network:getLocalIp', () => {
    return getLocalIp();
  });

  safeHandle('network:startLanServer', async () => {
    const ip = getLocalIp();
    const session = await startLanServer();
    return { ip, port: session.port, url: session.url, token: session.token };
  });

  safeHandle('network:stopLanServer', async () => {
    await stopLanServer();
    return { success: true };
  });

  safeHandle('network:getLanServerUrl', () => {
    return getLanServerUrl();
  });

  // ----- Photo Loading -----

  safeHandle(
    'fs:getPhotos',
    async (
      _event,
      folderPath: string,
      options?: { mode?: 'fast' | 'full'; scanId?: string; streamResults?: boolean },
    ) => {
      const mode = options?.mode === 'fast' ? 'fast' : 'full';
      const scanId = options?.scanId;
      if (scanId && !validScanIdPattern.test(scanId)) {
        throw new Error('scanId is invalid.');
      }
      const controller = new AbortController();
      if (scanId) {
        photoScanControllers.get(scanId)?.abort();
        photoScanControllers.set(scanId, controller);
      }
      let scan: PhotoScanResult;
      try {
        scan = await scanPhotoFolder(folderPath, {
          includeDimensions: mode !== 'fast',
          batchSize: 50,
          shouldCancel: () => controller.signal.aborted,
          onBatch: (photos, scanned) => {
            if (scanId && !_event.sender.isDestroyed()) {
              _event.sender.send('fs:scanProgress', { scanId, photos, scanned, phase: 'scanning' });
            }
          },
          onCachedBatch: (photos) => {
            if (scanId && !_event.sender.isDestroyed()) {
              _event.sender.send('fs:scanProgress', {
                scanId,
                photos,
                scanned: photos.length,
                phase: 'cached',
              });
            }
          },
        });
      } finally {
        if (scanId && photoScanControllers.get(scanId) === controller) {
          photoScanControllers.delete(scanId);
        }
      }

      const extCounts: Record<string, number> = {};
      for (const photo of scan.photos) {
        const ext = photo.extension ?? path.extname(photo.filename).toLowerCase();
        extCounts[ext] = (extCounts[ext] ?? 0) + 1;
      }

      logger.info('fs', 'getPhotos scan complete', {
        mode,
        photos: scan.photos.length,
        extensions: extCounts,
        dimensionsFailed: scan.failedDimensions.length,
        failedDirs: scan.failedDirs.slice(0, 5),
        failedDirCount: scan.failedDirs.length,
        truncated: scan.truncated,
        maxScanPhotos: MAX_SCAN_PHOTOS,
        timings: scan.timings,
      });

      if (scanId && options?.streamResults) {
        if (!_event.sender.isDestroyed()) {
          _event.sender.send('fs:scanProgress', {
            scanId,
            photos: [],
            scanned: scan.photos.length,
            phase: 'complete',
          });
        }
        return { streamed: true as const, count: scan.photos.length };
      }
      return scan.photos;
    },
  );

  safeHandle('fs:cancelScan', (_event, scanId: string) => {
    if (!validScanIdPattern.test(assertString(scanId, 'scanId'))) {
      throw new Error('scanId is invalid.');
    }
    const controller = photoScanControllers.get(scanId);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  });

  // Returns a data URI (data:image/jpeg;base64,...) for the given photo ID.
  // Photo ID is the base64url encoding of the native file path (set in fs:getPhotos).
  safeHandle('fs:getPhotoBase64', async (_event, photoId: string) => {
    // Decode the ID back to a native file path
    const decodedPath = Buffer.from(assertString(photoId, 'photoId'), 'base64url').toString('utf-8');
    const { filePath } = await assertReadableImageFile(decodedPath, 'getPhotoBase64', MAX_BASE64_IMAGE_BYTES);
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
      heic: 'image/heic', heif: 'image/heif',
    };
    const mime = mimeMap[ext] ?? 'image/jpeg';
    return `data:${mime};base64,${data.toString('base64')}`;
  });

  // ----- Dialog / Folder Picker -----

  safeHandle('dialog:selectFolder', async (_event) => {
    const win = BrowserWindow.getFocusedWindow();
    const locale = normalizeDesktopLocale(await getPreferredLocale());
    const titleByLocale = {
      en: 'Select Photo Folder',
      'zh-Hans': '选择照片文件夹',
      'zh-Hant': '選擇照片資料夾',
    };
    const result = await dialog.showOpenDialog(win ?? new BrowserWindow({ show: false }), {
      properties: ['openDirectory'],
      title: titleByLocale[locale],
    });
    const selectedPath = result.canceled ? null : (result.filePaths[0] ?? null);
    if (selectedPath) {
      addAllowedLocalFileRoot(selectedPath);
    }
    return selectedPath;
  });

  safeHandle('fs:countPhotos', async (_event, dirPath: string) => {
    const scan = await scanPhotoFolder(dirPath, { includeDimensions: false });
    return scan.photos.length;
  });

  safeHandle('fs:getAlbumStats', async (_event, dirPath: string) => {
    const scan = await scanPhotoFolder(dirPath, { includeDimensions: false });
    return {
      photoCount: scan.photos.length,
      totalBytes: scan.photos.reduce((total, photo) => total + photo.fileSize, 0),
    };
  });

  // Delete an array of file paths by moving them to the system trash.
  // Verifies each file no longer exists after deletion.
  // Returns successful paths so the renderer only removes photos that were
  // actually moved away from the source folder.
  safeHandle('fs:deleteFiles', async (_event, filePaths: string[]) => {
    let successCount = 0;
    const errors: string[] = [];
    const deletedPaths: string[] = [];
    const fallbackTrashPaths: string[] = [];
    const nativePaths = assertStringArray(filePaths, 'filePaths')
      .map((filePath) => assertImagePath(filePath, 'deleteFiles'));
    for (const [index, nativePath] of nativePaths.entries()) {
      if (!fs.existsSync(nativePath)) {
        successCount++;
        deletedPaths.push(nativePath);
        continue;
      }
      try {
        await shell.trashItem(nativePath);
        // Verify the file is gone
        try {
          await fs.promises.access(nativePath);
          // access() succeeded → file still exists
          errors.push(`File still exists after deletion: ${nativePath}`);
        } catch {
          // access() threw → file is gone ✓
          successCount++;
          deletedPaths.push(nativePath);
        }
      } catch (err) {
        // Fallback: move to .photo-manager-trash beside the album folder
        let dest: string | null = null;
        try {
          const albumDir = path.dirname(nativePath);
          const trashDir = path.join(albumDir, '.photo-manager-trash');
          await fs.promises.mkdir(trashDir, { recursive: true });
          dest = path.join(trashDir, `${Date.now()}_${index}_${path.basename(nativePath)}`);
          await fs.promises.copyFile(nativePath, dest);
          await fs.promises.unlink(nativePath);
          successCount++;
          deletedPaths.push(nativePath);
          fallbackTrashPaths.push(dest);
        } catch (err2) {
          if (dest) {
            await fs.promises.unlink(dest).catch(() => undefined);
          }
          logger.error('fs', 'deleteFiles fallback failed', err2);
          errors.push(
            `Failed to delete ${nativePath}: ${err2 instanceof Error ? err2.message : String(err2)}`,
          );
        }
      }
    }
    return { successCount, errors, deletedPaths, fallbackTrashPaths };
  });

  // Returns pinned/recent folders stored in a simple JSON file
  const recentFoldersPath = () => path.join(app.getPath('userData'), 'recent-folders.json');

  type RecentFolder = {
    id: string;
    title: string;
    photoCount: number;
    totalBytes?: number;
  };

  async function loadRecentFolders(): Promise<RecentFolder[]> {
    try {
      const raw = await fs.promises.readFile(recentFoldersPath(), 'utf-8');
      const folders = JSON.parse(raw) as RecentFolder[];
      for (const folder of folders) {
        if (typeof folder.id === 'string' && folder.id.trim()) {
          addAllowedLocalFileRoot(folder.id);
        }
      }
      return folders;
    } catch {
      return [];
    }
  }

  safeHandle('fs:getAlbums', async () => {
    return loadRecentFolders();
  });

  safeHandle(
    'fs:saveAlbum',
    async (_event, folderPath: string, photoCount: number, totalBytes?: number) => {
      const resolvedFolder = toNativePath(assertString(folderPath, 'folderPath'));
      const stats = await fs.promises.stat(resolvedFolder);
      if (!stats.isDirectory()) {
        throw new Error('Album path must be a folder.');
      }
      const allowedFolder = addAllowedLocalFileRoot(resolvedFolder);
      if (!Number.isFinite(photoCount) || photoCount < 0 || photoCount > MAX_SCAN_PHOTOS) {
        throw new Error('Invalid photo count.');
      }
      if (totalBytes !== undefined && (!Number.isFinite(totalBytes) || totalBytes < 0)) {
        throw new Error('Invalid album byte size.');
      }
      const albums = await loadRecentFolders();
      const title = path.basename(allowedFolder);
      const existing = albums.findIndex((a) => a.id === allowedFolder);
      const existingTotalBytes = existing >= 0 ? albums[existing]?.totalBytes : undefined;
      const nextAlbum: RecentFolder = {
        id: allowedFolder,
        title,
        photoCount,
        ...(totalBytes !== undefined
          ? { totalBytes }
          : existingTotalBytes !== undefined
            ? { totalBytes: existingTotalBytes }
            : {}),
      };
      if (existing >= 0) {
        albums[existing] = nextAlbum;
      } else {
        albums.unshift(nextAlbum);
      }
      // Keep last 20
      const trimmed = albums.slice(0, 20);
      await fs.promises.writeFile(recentFoldersPath(), JSON.stringify(trimmed, null, 2));
      return trimmed;
    },
  );

  // ----- Screenshot Archive -----
  // Saves an LLM instruction result paired with a photo into the local SQLite DB.
  safeHandle(
    'app:saveToArchive',
    async (_event, photoId: string, content: string, instruction: string) => {
      try {
        const safePhotoId = assertString(photoId, 'photoId');
        const safeContent = assertString(content, 'content').slice(0, 200000);
        const safeInstruction = assertString(instruction, 'instruction').slice(0, 10000);
        const database = getDb();
        database
          .prepare(
            `CREATE TABLE IF NOT EXISTS screenshot_archive (
               id TEXT PRIMARY KEY,
               photoId TEXT NOT NULL,
               content TEXT NOT NULL,
               instruction TEXT NOT NULL,
               createdAt INTEGER NOT NULL
             )`,
          )
          .run();
        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        database
          .prepare(
            'INSERT INTO screenshot_archive (id, photoId, content, instruction, createdAt) VALUES (?, ?, ?, ?, ?)',
          )
          .run(id, safePhotoId, safeContent, safeInstruction, Date.now());
        return { success: true, id };
      } catch (err) {
        logger.error('ipc', 'saveToArchive error', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ----- App Info -----

  safeHandle('app:getVersion', () => {
    return app.getVersion();
  });

  safeHandle('app:getLocale', async () => {
    return (await getPreferredLocale()) ?? 'en';
  });

  safeHandle('app:getPath', (_event, name: string) => {
    const validPaths = ['userData', 'temp', 'downloads', 'desktop', 'documents', 'pictures'];
    if (validPaths.includes(name)) {
      return app.getPath(name as Parameters<typeof app.getPath>[0]);
    }
    throw new Error(`Invalid path name: ${name}`);
  });

  safeHandle('app:openPath', async (_event, targetPath: string) => {
    const allowedPath = assertPathAllowed(assertString(targetPath, 'targetPath'), 'openPath');
    const errorMessage = await shell.openPath(allowedPath);
    if (errorMessage) {
      return { success: false, error: errorMessage };
    }
    return { success: true };
  });

  registerYearInReviewIpc({
    safeHandle: (channel, handler) => {
      safeHandle(channel, (event, ...args) => handler(event, ...args));
    },
    maxScanPhotos: MAX_SCAN_PHOTOS,
    assertImagePath,
    assertString,
    toLocalFileUri,
    getOutputRoot: getAppOutputRoot,
    getPreferredLocale,
    generateYearInReview,
  });

  // ----- LLM IPC bridge (avoids CORS in renderer) -----

  safeHandle(
    'llm:testConnection',
    async (
      _event,
      params: {
        provider: string;
        baseUrl?: string;
        model: string;
        supportsVision?: boolean;
        mode?: ProviderMode;
        apiKey?: string;
      },
    ) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid LLM request params.');
      }
      const provider = assertLLMProvider(params.provider);
      const model = assertString(params.model, 'model');
      const baseUrl = assertSafeEndpointUrl(params.baseUrl);
      const mode = assertProviderMode(params.mode);
      const temporaryApiKey = typeof params.apiKey === 'string' ? params.apiKey.trim() : '';
      const storedApiKey = temporaryApiKey || await readStoredApiKey(provider);
      if (!storedApiKey?.trim()) {
        throw new Error('API key is not configured. Complete setup in Settings first.');
      }
      const supportsVision = params.supportsVision ?? (
        mode === 'proxy' ? true : modelSupportsVision(provider, model, baseUrl)
      );
      const client = new LLMClient(createMainProviderConfig({
        provider,
        apiKey: storedApiKey,
        baseUrl,
        model,
        supportsVision,
        mode,
      }));
      return sanitizeIpcPayload(await raceWithTimeout(
        client.testConnection(),
        TEST_CONNECTION_TIMEOUT_MS,
        'API connection test exceeded 25 seconds.',
      ));
    },
  );

  safeHandle(
    'llm:chat',
    async (
      _event,
      params: {
        provider: string;
        baseUrl?: string;
        model: string;
        supportsVision?: boolean;
        mode?: ProviderMode;
        messages: LLMMessage[];
        options?: { temperature?: number; maxTokens?: number };
      },
    ) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid LLM request params.');
      }
      const provider = assertLLMProvider(params.provider);
      const model = assertString(params.model, 'model');
      const baseUrl = assertSafeEndpointUrl(params.baseUrl);
      const mode = assertProviderMode(params.mode);
      const apiKey = await readStoredApiKey(provider);
      if (!apiKey?.trim()) {
        throw new Error('API key is not configured. Complete setup in Settings first.');
      }
      const client = new LLMClient(createMainProviderConfig({
        provider,
        apiKey,
        baseUrl,
        model,
        supportsVision: params.supportsVision ?? modelSupportsVision(provider, model, baseUrl),
        mode,
      }));
      return sanitizeIpcPayload(await client.chat(assertLlmMessages(params.messages), params.options ?? {}));
    },
  );

  safeHandle(
    'llm:chatWithImage',
    async (
      _event,
      params: {
        provider: string;
        baseUrl?: string;
        model: string;
        supportsVision?: boolean;
        mode?: ProviderMode;
        prompt: string;
        imageBase64: string;
        mimeType: string;
        options?: { temperature?: number; maxTokens?: number };
      },
    ) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid LLM image request params.');
      }
      const provider = assertLLMProvider(params.provider);
      const model = assertString(params.model, 'model');
      const baseUrl = assertSafeEndpointUrl(params.baseUrl);
      const mode = assertProviderMode(params.mode);
      const prompt = assertString(params.prompt, 'prompt');
      const imageBase64 = assertString(params.imageBase64, 'imageBase64');
      const mimeType = assertString(params.mimeType, 'mimeType');
      if (Buffer.byteLength(imageBase64, 'utf-8') > MAX_LLM_BODY_BYTES) {
        throw new Error('LLM image payload is too large.');
      }
      const apiKey = await readStoredApiKey(provider);
      if (!apiKey?.trim()) {
        throw new Error('API key is not configured. Complete setup in Settings first.');
      }
      const client = new LLMClient(createMainProviderConfig({
        provider,
        apiKey,
        baseUrl,
        model,
        supportsVision: params.supportsVision ?? true,
        mode,
      }));
      return sanitizeIpcPayload(await client.chatWithImage(prompt, imageBase64, mimeType, params.options ?? {}));
    },
  );

  safeHandle(
    'screenshot:executeInstruction',
    async (
      _event,
      params: {
        provider: string;
        baseUrl?: string;
        model: string;
        supportsVision?: boolean;
        mode?: ProviderMode;
        instruction: string;
        imageBase64: string;
        mimeType: string;
        languageCode?: string;
        requestId: string;
      },
    ) => {
      if (!params || typeof params !== 'object') {
        throw new Error('Invalid screenshot instruction params.');
      }
      const provider = assertLLMProvider(params.provider);
      const model = assertString(params.model, 'model');
      const baseUrl = assertSafeEndpointUrl(params.baseUrl);
      const mode = assertProviderMode(params.mode);
      const instruction = assertString(params.instruction, 'instruction');
      const imageBase64 = assertString(params.imageBase64, 'imageBase64');
      const mimeType = assertString(params.mimeType, 'mimeType');
      const requestId = assertString(params.requestId, 'requestId');
      if (!validScanIdPattern.test(requestId)) {
        throw new Error('Invalid screenshot request ID.');
      }
      if (screenshotInstructionControllers.has(requestId)) {
        throw new Error('Screenshot request ID is already active.');
      }
      if (Buffer.byteLength(imageBase64, 'utf-8') > MAX_LLM_BODY_BYTES) {
        throw new Error('Screenshot payload is too large.');
      }
      const apiKey = await readStoredApiKey(provider);
      if (!apiKey?.trim()) {
        throw new Error('API key is not configured. Complete setup in Settings first.');
      }
      const client = new LLMClient(createMainProviderConfig({
        provider,
        apiKey,
        baseUrl,
        model,
        supportsVision: params.supportsVision ?? true,
        mode,
      }));
      const controller = new AbortController();
      screenshotInstructionControllers.set(requestId, controller);
      try {
        const content = await executeInstruction(
          imageBase64,
          mimeType,
          instruction,
          client,
          typeof params.languageCode === 'string' ? params.languageCode : undefined,
          { signal: controller.signal, timeoutMs: 60000 },
        );
        return sanitizeIpcPayload({ content });
      } finally {
        screenshotInstructionControllers.delete(requestId);
      }
    },
  );

  safeHandle('screenshot:cancelInstruction', (_event, requestId: string) => {
    const normalizedRequestId = assertString(requestId, 'requestId');
    if (!validScanIdPattern.test(normalizedRequestId)) {
      throw new Error('Invalid screenshot request ID.');
    }
    const controller = screenshotInstructionControllers.get(normalizedRequestId);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  });

  // ----- OCR (Tesseract in Node.js main process — correct file path, no WASM/CSP issues) -----

  safeHandle(
    'ocr:extractText',
    async (_event, filePath: string, lang: string = 'chi_sim+eng') => {
      const { filePath: allowedPath } = await assertReadableImageFile(filePath, 'ocr', MAX_BASE64_IMAGE_BYTES);
      const requestedLangs = assertString(lang, 'lang')
        .split('+')
        .map((value) => value.trim())
        .filter((value): value is string => value.length > 0);
      if (
        requestedLangs.length === 0
        || requestedLangs.some((code) => !['chi_sim', 'eng'].includes(code))
      ) {
        throw new Error('Unsupported OCR language.');
      }

      return runExclusiveHeavyTask(
        `ocr:${allowedPath}:${requestedLangs.join('+')}`,
        'ocr',
        120000,
        async () => {
          const tesseract = await import('tesseract.js');
          const tesseractPackageDir = path.dirname(require.resolve('tesseract.js/package.json'));
          const tesseractCorePackageDir = path.dirname(require.resolve('tesseract.js-core/package.json'));
          const workerPath = path.join(tesseractPackageDir, 'src', 'worker-script', 'node', 'index.js');
          const corePath = tesseractCorePackageDir;
          const langPathCandidates = [
            path.resolve(app.getAppPath()),
            path.resolve(app.getAppPath(), '..'),
            path.resolve(process.cwd()),
            path.resolve(process.cwd(), 'packages', 'desktop'),
          ];
          const langPath = langPathCandidates.find((candidate) =>
            requestedLangs.every((code) => fs.existsSync(path.join(candidate, `${code}.traineddata`))),
          );
          if (!langPath) {
            logger.error('ocr', 'OCR language data missing', { requestedLangs, langPathCandidates });
            throw new Error(
              `OCR local language data not found for [${requestedLangs.join(', ')}]. Checked: ${langPathCandidates.join(', ')}`,
            );
          }
          const worker = await tesseract.createWorker(requestedLangs.join('+'), undefined, {
            workerPath,
            corePath,
            langPath,
            gzip: false,
          });
          try {
            const { data: { text } } = await worker.recognize(allowedPath);
            return { text: text.trim() };
          } finally {
            await worker.terminate();
          }
        },
      );
    },
  );

}
