import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'webview-src',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'webview'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Single-file output keeps CSP nonce wiring simple
        entryFileNames: 'index.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        manualChunks: undefined,
      },
    },
  },
});
