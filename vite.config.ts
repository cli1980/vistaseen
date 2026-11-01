import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let licensePath: string;
let noticePath: string;

export default defineConfig({
  plugins: [{
    name: 'deployment-legal-notices',
    configResolved(config) {
      licensePath = resolve(config.root, 'LICENSE');
      noticePath = resolve(config.root, 'NOTICE');
    },
    configureServer(server) {
      server.middlewares.use('/LICENSE.txt', (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(readFileSync(licensePath, 'utf8'));
      });
      server.middlewares.use('/NOTICE.txt', (_request, response) => {
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.end(readFileSync(noticePath, 'utf8'));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: readFileSync(licensePath, 'utf8') });
      this.emitFile({ type: 'asset', fileName: 'NOTICE.txt', source: readFileSync(noticePath, 'utf8') });
    },
  }],
  // Prebundle the worker's runtime before first upload, avoiding a late reload
  // that would otherwise discard the in-memory photo when inference starts.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'exifr', '@huggingface/transformers'] },
  // User photos and generated artifacts are not source code. Windows may lock
  // these files while copying/exporting; watching them can crash the server.
  server: {
    watch: { ignored: ['**/samples/**', '**/.tmp/**', '**/*.{jpg,jpeg,png,webp,heic,heif,npy}'] },
  },
});
