import { app } from 'electron';
import { execFile } from 'child_process';

export type DesktopLocale = 'en' | 'zh-Hans' | 'zh-Hant';

let cachedDisplayLocale: string | null | undefined;

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve('');
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function parsePreferredUiLanguages(output: string): string | null {
  const match = output.match(/PreferredUILanguages\s+REG_MULTI_SZ\s+([^\r\n]+)/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1].split(/\0|\s+/).find(Boolean) ?? null;
}

async function readWindowsDisplayLocale(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }

  const uiCulture = await execFileText('powershell.exe', [
    '-NoProfile',
    '-Command',
    '(Get-UICulture).IetfLanguageTag',
  ]);
  if (uiCulture.trim()) {
    return uiCulture.trim();
  }

  const registryOutput = await execFileText('reg.exe', [
    'query',
    'HKCU\\Control Panel\\Desktop',
    '/v',
    'PreferredUILanguages',
  ]);
  const preferredUiLanguage = parsePreferredUiLanguages(registryOutput);
  if (preferredUiLanguage) {
    return preferredUiLanguage;
  }
  return null;
}

export async function readSystemDisplayLocale(): Promise<string | null> {
  if (cachedDisplayLocale !== undefined) {
    return cachedDisplayLocale;
  }

  const windowsDisplayLocale = await readWindowsDisplayLocale();
  if (windowsDisplayLocale) {
    cachedDisplayLocale = windowsDisplayLocale;
    return cachedDisplayLocale;
  }

  const preferredLanguages = typeof app.getPreferredSystemLanguages === 'function'
    ? app.getPreferredSystemLanguages()
    : [];
  const electronLocale = preferredLanguages[0] ?? app.getLocale() ?? null;
  if (electronLocale) {
    cachedDisplayLocale = electronLocale;
    return cachedDisplayLocale;
  }

  cachedDisplayLocale = null;
  return cachedDisplayLocale;
}

export function normalizeDesktopLocale(locale: string | null | undefined): DesktopLocale {
  const normalized = (locale ?? '').replace(/_/g, '-').toLowerCase();
  if (
    normalized.startsWith('zh-tw')
    || normalized.startsWith('zh-hk')
    || normalized.startsWith('zh-mo')
    || normalized.startsWith('zh-hant')
  ) {
    return 'zh-Hant';
  }
  if (
    normalized === 'zh'
    || normalized.startsWith('zh-cn')
    || normalized.startsWith('zh-sg')
    || normalized.startsWith('zh-hans')
  ) {
    return 'zh-Hans';
  }
  return 'en';
}
