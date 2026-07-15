import { app, BrowserWindow, ipcMain, shell, nativeTheme, protocol, clipboard, nativeImage, Menu } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { runPhotoFolderSmoke, setupIpcHandlers } from './ipc';
import { stopLanServer } from './lanServer';
import { installMainProcessLogGuards, logger } from './logger';
import { addAllowedLocalFileRoot, assertAllowedLocalFilePath } from './localFileAccess';
import { DESKTOP_PORTS } from './ports';

const isDev = process.env.NODE_ENV === 'development';
const RENDERER_DEV_URL = `http://localhost:${DESKTOP_PORTS.renderer}`;

if (!app.isPackaged && process.env.ALBUMDONE_TEST_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.ALBUMDONE_TEST_USER_DATA));
}

let mainWindow: BrowserWindow | null = null;

installMainProcessLogGuards();

function configureApplicationMenu(): void {
  Menu.setApplicationMenu(null);
}

function resolveMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.jfif': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };

  return mimeTypes[extension] ?? 'application/octet-stream';
}

function resolveProtocolPath(requestUrl: string): string {
  const parsed = new URL(requestUrl);
  let pathPart = decodeURIComponent(parsed.pathname);

  if (process.platform === 'win32') {
    if (/^\/[a-zA-Z]\//.test(pathPart)) {
      pathPart = `${pathPart[1]}:${pathPart.slice(2)}`;
    } else if (/^\/[a-zA-Z]:\//.test(pathPart)) {
      pathPart = pathPart.slice(1);
    }
  }

  const absolutePath = path.isAbsolute(pathPart) ? pathPart : path.resolve(pathPart);
  return process.platform === 'win32'
    ? absolutePath.replace(/\//g, path.sep)
    : absolutePath;
}

function createWindow(): void {
  const developmentIconPath = path.join(
    __dirname,
    process.platform === 'win32' ? '../../build/icon.ico' : '../../build/icon.png',
  );
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1A1A1A',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    show: isDev,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
    ...(!app.isPackaged && process.platform !== 'darwin' && { icon: developmentIconPath }),
  });
  mainWindow.setMenuBarVisibility(false);

  // Apply dark theme at OS level
  nativeTheme.themeSource = 'dark';

  // Load the renderer
  if (isDev) {
    void mainWindow.loadURL(RENDERER_DEV_URL);
    if (process.env.ALBUM_DONE_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, '../renderer/index.html'),
    );
  }

  // Show window once content is ready (production only; dev shows immediately)
  if (!isDev) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });
    // Fallback: show after 5 s even if ready-to-show never fires
    setTimeout(() => mainWindow?.show(), 5000);
  } else {
    mainWindow.maximize();
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!isDev) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = input.key.toLowerCase();
      const isDevToolsShortcut =
        input.key === 'F12'
        || (input.control && input.shift && (key === 'i' || key === 'j' || key === 'c'));
      if (isDevToolsShortcut) {
        event.preventDefault();
      }
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register custom protocol so renderer can load local images via local-file:///path.
// bypassCSP:true ensures images aren't blocked by security policies.
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, standard: false, bypassCSP: true, supportFetchAPI: true, corsEnabled: true } },
]);

// App lifecycle
app.whenReady().then(async () => {
  configureApplicationMenu();

  const testPhotoRoot = process.env.ALBUMDONE_TEST_PHOTO_ROOT;
  if (!app.isPackaged && testPhotoRoot) {
    const allowedTestRoot = addAllowedLocalFileRoot(testPhotoRoot);
    logger.info('main', 'Authorized development test photo root', allowedTestRoot);
  }

  const handleLocalRequest = async (request: Request) => {
    try {
      const absolutePath = assertAllowedLocalFilePath(
        resolveProtocolPath(request.url),
        'local-file protocol',
      );
      const stats = await fs.promises.stat(absolutePath);

      if (!stats.isFile()) {
        return new Response('Not Found', { status: 404 });
      }

      const stream = Readable.toWeb(fs.createReadStream(absolutePath)) as unknown as BodyInit;
      const cacheControl = absolutePath.includes('photo-manager-thumbs')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=120';

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': resolveMimeType(absolutePath),
          'Content-Length': String(stats.size),
          'Cache-Control': cacheControl,
          'Last-Modified': stats.mtime.toUTCString(),
        },
      });
    } catch (err) {
      logger.error('protocol', 'Failed to resolve path', err);
      return new Response('Path resolution error', { status: 500 });
    }
  };

  protocol.handle('local-file', handleLocalRequest);

  // IPC: Copy image to clipboard from DataURL
  ipcMain.on('image:copy-to-clipboard', (_event, dataUrl: string) => {
    try {
      const image = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(image);
    } catch (err) {
      logger.error('ipc', 'Failed to copy image to clipboard', err);
    }
  });

  try {
    setupIpcHandlers();
  } catch (err) {
    logger.error('main', 'setupIpcHandlers threw', err);
  }

  if (process.env.ALBUMDONE_SMOKE_PHOTO_DIR) {
    try {
      const result = await runPhotoFolderSmoke(
        process.env.ALBUMDONE_SMOKE_PHOTO_DIR,
        process.env.ALBUMDONE_SMOKE_FULL_WORKFLOW === '1',
        process.env.ALBUMDONE_SMOKE_REVIEW_MODE === 'calendar' ? 'calendar' : 'rolling',
        Number(process.env.ALBUMDONE_SMOKE_HASH_LIMIT ?? 4),
      );
      const serialized = JSON.stringify({ ok: true, result });
      logger.info('smoke', 'photo folder smoke passed', serialized);
      console.log(serialized);
      app.quit();
      return;
    } catch (err) {
      logger.error('smoke', 'photo folder smoke failed', err);
      console.error(JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }));
      app.exit(1);
      return;
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopLanServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopLanServer();
});

// Security: prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isDev || !url.startsWith(RENDERER_DEV_URL)) {
      event.preventDefault();
    }
  });
});

export { mainWindow };
