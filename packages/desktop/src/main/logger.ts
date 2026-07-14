import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
let streamGuardsInstalled = false;

export function installMainProcessLogGuards(): void {
  if (streamGuardsInstalled) {
    return;
  }
  streamGuardsInstalled = true;

  const ignoreBrokenPipe = (err: NodeJS.ErrnoException) => {
    if (err?.code === 'EPIPE') {
      return;
    }
  };

  process.stdout?.on('error', ignoreBrokenPipe);
  process.stderr?.on('error', ignoreBrokenPipe);
}

function getLogDir(): string {
  try {
    return path.join(app.getPath('userData'), 'logs');
  } catch {
    return path.join(process.cwd(), 'logs');
  }
}

function getLogPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(getLogDir(), `photo-manager-${date}.log`);
}

function rotateIfNeeded(logPath: string): void {
  try {
    const stats = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
    if (!stats || stats.size < MAX_LOG_BYTES) {
      return;
    }

    const rotatedPath = `${logPath}.1`;
    if (fs.existsSync(rotatedPath)) {
      fs.unlinkSync(rotatedPath);
    }
    fs.renameSync(logPath, rotatedPath);
  } catch {
    // Logging must never break app startup or user actions.
  }
}

export function serializeError(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ''}`;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function writeLog(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  const line = [
    new Date().toISOString(),
    level.toUpperCase(),
    `[${scope}]`,
    message,
    meta === undefined ? '' : typeof meta === 'string' ? meta : serializeError(meta),
  ].filter(Boolean).join(' ');

  try {
    const logDir = getLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = getLogPath();
    rotateIfNeeded(logPath);
    fs.appendFileSync(logPath, `${line}\n`, 'utf-8');
  } catch {
    // Best-effort file logging only.
  }

  if (process.env.PHOTO_MANAGER_CONSOLE_LOGS === '1') {
    try {
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    } catch {
      // Broken stdout/stderr pipes must not crash the Electron main process.
    }
  }
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) => writeLog('info', scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => writeLog('warn', scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => writeLog('error', scope, message, meta),
  debug: (scope: string, message: string, meta?: unknown) => {
    if (process.env.PHOTO_MANAGER_DEBUG_LOGS === '1') {
      writeLog('debug', scope, message, meta);
    }
  },
  getLogPath,
};
