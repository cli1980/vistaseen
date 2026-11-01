import { defineConfig } from 'vite';

export default defineConfig({
  // Prebundle the worker's runtime before first upload, avoiding a late reload
  // that would otherwise discard the in-memory photo when inference starts.
  optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-runtime', 'exifr', '@huggingface/transformers'] },
  // User photos and generated artifacts are not source code. Windows may lock
  // these files while copying/exporting; watching them can crash the server.
  server: {
    watch: { ignored: ['**/samples/**', '**/.tmp/**', '**/*.{jpg,jpeg,png,webp,heic,heif,npy}'] },
  },
});
