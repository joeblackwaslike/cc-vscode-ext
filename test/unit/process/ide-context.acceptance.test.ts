import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';

const RUN = process.env.CLAUDE_ACCEPTANCE === '1';
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
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

describe.skipIf(!RUN)('array user content is accepted by the real CLI (CLAUDE_ACCEPTANCE)', () => {
  it('reads an ide_opened_file block sent as a second text block', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ide-context-'));
    const router = new ChannelRouter();
    const logger = { info() {}, warn() {}, error() {} };
    const pm = new ClaudeProcessManager(() => Promise.resolve(CLAUDE_BIN), router, logger);
    let resultText = '';
    let done = false;
    const events: unknown[] = [];
    router.register('ch', (raw) => {
      const e = raw as { type: string; result?: string; is_error?: boolean };
      events.push(e);
      if (e.type === 'result') {
        resultText = e.result ?? '';
        done = true;
      }
    });
    await pm.spawnClaude('ch', { wrapper: CLAUDE_BIN, model: 'haiku' }, cwd);
    try {
      pm.sendUserMessage('ch', [
        { type: 'text', text: 'Repeat back the file path you were told I opened, nothing else.' },
        { type: 'text', text: '<ide_opened_file>The user opened the file /tmp/zz-probe.ts in the IDE. This may or may not be related to the current task.</ide_opened_file>' },
      ]);
      await waitFor(() => done, 90000);
      console.log('ide-context result:', JSON.stringify(resultText));
      expect(resultText).toContain('zz-probe.ts');
    } finally {
      pm.closeChannel('ch');
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 120000);
});
