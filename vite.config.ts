import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: 'webview-src',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'webview'),
    emptyOutDir: true,
    // Bundle all CSS into one stylesheet so HtmlBuilder's single
    // <link href=".../webview/index.css"> picks it up (no per-chunk CSS).
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Single-file output keeps CSP nonce wiring simple
        entryFileNames: 'index.js',
        chunkFileNames: '[name].js',
        // Force the emitted stylesheet to index.css regardless of entry name.
        assetFileNames: (asset) => {
          const names = [asset.name, ...(asset.names ?? [])].filter(Boolean) as string[];
          return names.some((n) => n.endsWith('.css')) ? 'index.css' : '[name][extname]';
        },
        manualChunks: undefined,
      },
    },
  },
});
