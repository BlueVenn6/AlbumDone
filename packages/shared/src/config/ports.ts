function readEnvNumber(key: string, fallback: number): number {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  const value = maybeProcess.process?.env?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const APP_PORTS = {
  desktopRenderer: readEnvNumber('ALBUMDONE_DESKTOP_RENDERER_PORT', 5173),
  mobileWeb: readEnvNumber('ALBUMDONE_MOBILE_WEB_PORT', 5183),
  mobileWebPreview: readEnvNumber('ALBUMDONE_MOBILE_WEB_PREVIEW_PORT', 5184),
  lanServer: readEnvNumber('ALBUMDONE_LAN_SERVER_PORT', 7842),
  localOpenAICompatible: readEnvNumber('ALBUMDONE_LOCAL_OPENAI_COMPATIBLE_PORT', 11434),
} as const;

export const APP_ENV_KEYS = {
  desktopRendererPort: 'ALBUMDONE_DESKTOP_RENDERER_PORT',
  mobileWebPort: 'ALBUMDONE_MOBILE_WEB_PORT',
  mobileWebPreviewPort: 'ALBUMDONE_MOBILE_WEB_PREVIEW_PORT',
  lanServerPort: 'ALBUMDONE_LAN_SERVER_PORT',
  localOpenAICompatiblePort: 'ALBUMDONE_LOCAL_OPENAI_COMPATIBLE_PORT',
  mobileApiBaseUrl: 'ALBUMDONE_MOBILE_API_BASE_URL',
} as const;
