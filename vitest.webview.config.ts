import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Webview (React) tests run in jsdom; the extension-host suite stays in node
// (vitest.config.ts). Kept as a separate config so the two environments don't
// collide and each can be run independently.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./webview-src/test-setup.ts'],
    include: ['webview-src/**/*.test.{ts,tsx}'],
  },
});
