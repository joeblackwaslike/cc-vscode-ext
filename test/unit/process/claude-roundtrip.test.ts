import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import type { ClaudeStreamEvent } from '../../../src/types/process';

// End-to-end at the process layer: drive the REAL spawn → stdin → StreamJsonParser
// → ChannelRouter path against a fake claude that enforces the real stream-json
// input contract. This is the class of test that would have caught the "nothing
// happens on submit" bug — a webview unit test mocking postMessage cannot.

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const logger = { info() {}, warn() {}, error() {} };

// Ignore the resolved binary/args and run the fake claude via node.
const spawnFake = ((_cmd: string, _args: string[], opts: object) =>
  spawn(process.execPath, [FAKE], opts)) as never;

function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for condition'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

async function setup() {
  const router = new ChannelRouter();
  const events: ClaudeStreamEvent[] = [];
  router.register('ch', (e) => events.push(e as ClaudeStreamEvent));
  const pm = new ClaudeProcessManager(() => Promise.resolve('/ext/claude'), router, logger, spawnFake);
  await pm.spawnClaude('ch', {});
  return { pm, events };
}

describe('claude send round-trip (fake CLI enforcing the stream-json contract)', () => {
  it('sendUserMessage() yields an assistant response and a result', async () => {
    const { pm, events } = await setup();
    try {
      await waitFor(() => events.some((e) => e.type === 'system'));
      pm.sendUserMessage('ch', 'hello');
      await waitFor(() => events.some((e) => e.type === 'result'));

      const assistant = events.find((e) => e.type === 'assistant');
      expect(assistant).toBeDefined();
      expect(JSON.stringify(assistant)).toContain('pong:hello');
      expect(events.some((e) => e.type === 'error')).toBe(false);
    } finally {
      pm.closeChannel('ch');
    }
  });

  it('the old bare-string envelope is rejected — no assistant response (reproduces the bug)', async () => {
    const { pm, events } = await setup();
    try {
      await waitFor(() => events.some((e) => e.type === 'system'));
      // The exact shape the extension used to send.
      pm.writeToChannel('ch', { type: 'user', message: 'hello' });
      await waitFor(() => events.some((e) => e.type === 'error'));

      expect(events.some((e) => e.type === 'assistant')).toBe(false);
    } finally {
      pm.closeChannel('ch');
    }
  });
});
