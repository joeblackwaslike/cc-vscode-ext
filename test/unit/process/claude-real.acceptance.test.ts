import { describe, it, expect } from 'vitest';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import type { ClaudeStreamEvent } from '../../../src/types/process';

// Real-binary smoke test: drives the production ClaudeProcessManager against an
// actually-installed, authenticated `claude` CLI (default spawn, real env — no
// headless VS Code shell-env confounder). Proves the host → CLI contract end to
// end. Skipped unless CLAUDE_ACCEPTANCE=1 (needs auth + network), so it never
// runs in normal CI.
const RUN = process.env.CLAUDE_ACCEPTANCE === '1';
// Default to PATH resolution (`claude`) so the gate works cross-platform; set
// CLAUDE_BIN to pin a specific binary.
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

function waitFor(predicate: () => boolean, timeoutMs = 40000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe.skipIf(!RUN)('real claude round-trip (CLAUDE_ACCEPTANCE)', () => {
  it('sendUserMessage() gets a real assistant response + result', async () => {
    const router = new ChannelRouter();
    const events: ClaudeStreamEvent[] = [];
    router.register('ch', (e) => events.push(e as ClaudeStreamEvent));
    const logger = { info() {}, warn() {}, error() {} };
    const pm = new ClaudeProcessManager(() => Promise.resolve(CLAUDE_BIN), router, logger);

    await pm.spawnClaude('ch', { wrapper: CLAUDE_BIN });
    try {
      await waitFor(() => events.some((e) => e.type === 'system'));
      pm.sendUserMessage('ch', 'reply with exactly the word OK and nothing else');
      await waitFor(() => events.some((e) => e.type === 'result'));

      const assistant = events.find((e) => e.type === 'assistant');
      expect(assistant, 'expected an assistant event from real claude').toBeDefined();
      expect(JSON.stringify(assistant)).toContain('OK');
    } finally {
      pm.closeChannel('ch');
    }
  }, 60000);
});
