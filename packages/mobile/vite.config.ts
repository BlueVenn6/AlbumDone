import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import { APP_PORTS } from '../shared/src/config/ports';
import { getMobileEndpointRisk } from './src/utils/mobileEndpointPolicy';

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const webRoot = path.resolve(projectRoot, 'web');

function webMock(moduleName: string): string {
  return path.resolve(webRoot, 'mocks', moduleName);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export default defineConfig({
  root: projectRoot,
  plugins: [
    react(),
    {
      name: 'mobile-web-preview-llm-proxy',
      configureServer(server) {
        server.middlewares.use('/__mobile_preview/llm', async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { error: 'Method not allowed.' });
            return;
          }

          try {
            const payload = JSON.parse(await readBody(req)) as {
              url?: string;
              method?: string;
              headers?: Record<string, string>;
              body?: string;
            };

            if (!payload.url || getMobileEndpointRisk(payload.url)?.level === 'blocked') {
              sendJson(res, 400, { error: 'Invalid upstream URL.' });
              return;
            }

            const requestInit: RequestInit = {
              method: payload.method ?? 'POST',
              headers: payload.headers ?? {},
              ...(payload.body ? { body: payload.body } : {}),
            };
            const upstream = await fetch(payload.url, requestInit);
            const responseBody = await upstream.text();

            res.statusCode = upstream.status;
            res.setHeader(
              'Content-Type',
              upstream.headers.get('content-type') ?? 'application/json',
            );
            res.end(responseBody);
          } catch {
            sendJson(res, 502, { error: 'Mobile web preview LLM proxy failed.' });
          }
        });
      },
    },
  ],
  define: {
    __DEV__: JSON.stringify(true),
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  resolve: {
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
    alias: {
      '@photo-manager/shared': path.resolve(workspaceRoot, 'packages/shared/src/index.ts'),
      '@photo-manager/shared/': `${path.resolve(workspaceRoot, 'packages/shared/src')}/`,
      'react-native': webMock('reactNative.ts'),
      '@react-native-camera-roll/camera-roll': webMock('cameraRoll.ts'),
      '@react-native-async-storage/async-storage': webMock('asyncStorage.ts'),
      '@react-navigation/native-stack': webMock('nativeStack.ts'),
      'react-native-gesture-handler': webMock('gestureHandler.tsx'),
      'react-native-image-picker': webMock('imagePicker.ts'),
      'react-native-keychain': webMock('keychain.ts'),
      'react-native-safe-area-context': webMock('safeAreaContext.tsx'),
      'react-native-screens': webMock('screens.tsx'),
      'react-native-tesseract-ocr': webMock('tesseractOcr.ts'),
      'react-native-view-shot': webMock('viewShot.tsx'),
    },
  },
  optimizeDeps: {
    include: [
      '@react-navigation/bottom-tabs',
      '@react-navigation/native',
      '@react-navigation/stack',
      'color',
      'react',
      'react-dom',
      'react-i18next',
      'react-native-web',
      'zustand',
    ],
    exclude: [
      '@react-native-async-storage/async-storage',
      '@react-native-camera-roll/camera-roll',
      '@react-navigation/native-stack',
      'react-native',
      'react-native-gesture-handler',
      'react-native-keychain',
      'react-native-safe-area-context',
      'react-native-screens',
      'react-native-view-shot',
    ],
  },
  server: {
    port: APP_PORTS.mobileWeb,
    strictPort: false,
  },
  preview: {
    port: APP_PORTS.mobileWebPreview,
    strictPort: false,
  },
});
