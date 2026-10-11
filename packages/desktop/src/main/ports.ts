function readEnvNumber(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

export const DESKTOP_PORTS = {
  renderer: readEnvNumber('ALBUMDONE_DESKTOP_RENDERER_PORT', 5173),
  lanServer: readEnvNumber('ALBUMDONE_LAN_SERVER_PORT', 7842),
} as const;
