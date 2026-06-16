import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// The real webview gets `acquireVsCodeApi` injected by VS Code. Under jsdom it
// doesn't exist, so stub it — postMessage/get/setState all become no-ops.
(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: () => {},
  getState: () => undefined,
  setState: () => {},
});

// jsdom doesn't implement scrollIntoView; ConversationView calls it on mount.
Element.prototype.scrollIntoView = () => {};

// Unmount React trees between tests so DOM queries don't leak across cases.
afterEach(() => {
  cleanup();
});
