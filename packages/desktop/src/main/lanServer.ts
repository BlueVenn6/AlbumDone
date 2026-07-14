import * as http from 'http';
import * as os from 'os';
import { randomBytes, timingSafeEqual } from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { logger } from './logger';
import { DESKTOP_PORTS } from './ports';

const LAN_PORT = DESKTOP_PORTS.lanServer;

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let currentPort: number | null = null;
let sessionToken: string | null = null;
const connectedClients = new Set<WebSocket>();

function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:token|access_token|api_key|key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Authorization\s*[:=]\s*)Bearer\s+[A-Za-z0-9._~+/=-]+/gi, '$1Bearer [REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

function getLanLogContext(port: number): { host: string; port: number; lanEnabled: boolean; url: string } {
  const host = getLocalIp();
  return {
    host,
    port,
    lanEnabled: true,
    url: redactSensitiveText(`http://${host}:${port}?token=${sessionToken ?? ''}`),
  };
}

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaces = interfaces[name];
    if (!ifaces) continue;
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

export function getLanServerUrl(): string | null {
  if (!currentPort || !sessionToken) return null;
  const ip = getLocalIp();
  return `http://${ip}:${currentPort}?token=${encodeURIComponent(sessionToken)}`;
}

export async function generateQRCode(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 256,
    margin: 2,
    color: { dark: '#FFFFFF', light: '#1A1A1A' },
  });
}

// Photo data source - populated from the renderer via IPC
let photoDataSource: {
  getPhotos: () => Promise<Array<{
    id: string;
    filename: string;
    uri: string;
    albumId: string;
    timestamp: number;
  }>>;
  getThumbnail: (id: string) => Promise<Buffer | null>;
  getFullImage: (id: string) => Promise<Buffer | null>;
} = {
  getPhotos: async () => [],
  getThumbnail: async () => null,
  getFullImage: async () => null,
};

export function setPhotoDataSource(
  source: typeof photoDataSource,
): void {
  photoDataSource = source;
}

// Broadcast a message to all connected WebSocket clients
export function broadcastToClients(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function createSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

function readTokenFromRequest(req: Request | http.IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }

  const headerToken = req.headers['x-photo-manager-token'];
  if (typeof headerToken === 'string') {
    return headerToken;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return url.searchParams.get('token');
}

function isValidToken(candidate: string | null): boolean {
  if (!sessionToken || !candidate) {
    return false;
  }

  const expected = Buffer.from(sessionToken);
  const actual = Buffer.from(candidate);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function requireLanAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isValidToken(readTokenFromRequest(req))) {
    res.status(401).json({ error: 'LAN session token required' });
    return;
  }
  next();
}

export async function startLanServer(): Promise<{ port: number; token: string; url: string }> {
  if (server) {
    const port = currentPort ?? LAN_PORT;
    const token = sessionToken ?? createSessionToken();
    sessionToken = token;
    return { port, token, url: getLanServerUrl() ?? `http://${getLocalIp()}:${port}?token=${token}` };
  }

  sessionToken = createSessionToken();
  const expressApp = express();
  expressApp.use(express.json());

  // CORS for local network
  expressApp.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Photo-Manager-Token');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
  });

  // Health check
  expressApp.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  expressApp.use(requireLanAuth);

  // Get all photos (metadata only)
  expressApp.get('/photos', async (_req, res) => {
    try {
      const photos = await photoDataSource.getPhotos();
      res.json({ photos, total: photos.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Get thumbnail
  expressApp.get('/photo/:id/thumbnail', async (req, res) => {
    try {
      const thumbnail = await photoDataSource.getThumbnail(req.params['id'] ?? '');
      if (!thumbnail) {
        return res.status(404).json({ error: 'Photo not found' });
      }
      res.set('Content-Type', 'image/jpeg');
      return res.send(thumbnail);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Get full resolution image
  expressApp.get('/photo/:id/full', async (req, res) => {
    try {
      const image = await photoDataSource.getFullImage(req.params['id'] ?? '');
      if (!image) {
        return res.status(404).json({ error: 'Photo not found' });
      }
      res.set('Content-Type', 'image/jpeg');
      return res.send(image);
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // QR code endpoint
  expressApp.get('/qr', async (_req, res) => {
    try {
      const url = getLanServerUrl();
      if (!url) {
        return res.status(503).json({ error: 'Server not started' });
      }
      const qrDataUrl = await generateQRCode(url);
      return res.json({ url, qrCode: qrDataUrl });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  server = http.createServer(expressApp);

  // WebSocket for real-time sync
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    if (!isValidToken(readTokenFromRequest(req))) {
      ws.close(1008, 'LAN session token required');
      return;
    }

    connectedClients.add(ws);
    logger.info('lan', 'LAN client connected', { total: connectedClients.size });

    // Send welcome message
    ws.send(JSON.stringify({
      event: 'connected',
      data: { serverVersion: '0.1.0', timestamp: Date.now() },
    }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { event: string; data: unknown };
        // Echo back for confirmation
        ws.send(JSON.stringify({ event: 'ack', data: { received: msg.event } }));
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      connectedClients.delete(ws);
      logger.info('lan', 'LAN client disconnected', { total: connectedClients.size });
    });

    ws.on('error', (err) => {
      logger.error('lan', 'WebSocket error', err);
      connectedClients.delete(ws);
    });
  });

  return new Promise((resolve, reject) => {
    server!.listen(LAN_PORT, '0.0.0.0', () => {
      currentPort = LAN_PORT;
      const ip = getLocalIp();
      logger.info('lan', 'LAN server started', getLanLogContext(LAN_PORT));
      resolve({ port: LAN_PORT, token: sessionToken!, url: `http://${ip}:${LAN_PORT}?token=${encodeURIComponent(sessionToken!)}` });
    });

    server!.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        const nextPort = LAN_PORT + 1;
        server!.listen(nextPort, '0.0.0.0', () => {
          currentPort = nextPort;
          logger.info('lan', 'LAN server started on fallback port', getLanLogContext(nextPort));
          resolve({
            port: nextPort,
            token: sessionToken!,
            url: `http://${getLocalIp()}:${nextPort}?token=${encodeURIComponent(sessionToken!)}`,
          });
        });
      } else {
        logger.error('lan', 'LAN server failed to start', err);
        reject(err);
      }
    });
  });
}

export async function stopLanServer(): Promise<void> {
  // Close all WebSocket connections
  for (const client of connectedClients) {
    client.terminate();
  }
  connectedClients.clear();

  return new Promise((resolve) => {
    if (wss) {
      wss.close(() => {
        wss = null;
      });
    }

    if (server) {
      server.close(() => {
        server = null;
        currentPort = null;
        sessionToken = null;
        logger.info('lan', 'LAN server stopped');
        resolve();
      });
    } else {
      sessionToken = null;
      resolve();
    }
  });
}
