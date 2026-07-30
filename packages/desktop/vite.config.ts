import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { APP_PORTS } from '../shared/src/config/ports';

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@photo-manager/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: APP_PORTS.desktopRenderer,
  },
});
