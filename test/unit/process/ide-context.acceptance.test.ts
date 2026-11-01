import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('vscode', () => ({
  RelativePattern: vi.fn(),
  Uri: { file: vi.fn((path: string) => ({ fsPath: path })) },
  workspace: {
    createFileSystemWatcher: vi.fn(() => ({ onDidCreate: vi.fn(), onDidChange: vi.fn(), dispose: vi.fn() })),
  },
}));

import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import { MessageBroker } from '../../../src/ipc/MessageBroker';
import type { IdeContext } from '../../../src/shared/ideTags';
import { createIpcTestHarness } from '../../helpers/ipcTestHarness';

const RUN = process.env.CLAUDE_ACCEPTANCE === '1';
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const NO_TOOLS = ' Do not use any tools.';

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

async function askThroughBroker(text: string, context: IdeContext | undefined, cwd: string): Promise<string> {
  const router = new ChannelRouter();
  const logger = { info() {}, warn() {}, error() {} };
  const pm = new ClaudeProcessManager(() => Promise.resolve(CLAUDE_BIN), router, logger);
  const h = createIpcTestHarness();
  new MessageBroker(
    pm as never,
    h.sessionManager as never,
    h.diffManager as never,
    h.viewManager as never,
    router as never,
    h.webview as never,
    logger
  );
  let resultText = '';
  let done = false;
  router.register('ch', (raw) => {
    const e = raw as { type: string; result?: string };
    if (e.type === 'result') {
      resultText = e.result ?? '';
      done = true;
    }
  });
  await pm.spawnClaude('ch', { wrapper: CLAUDE_BIN, model: 'haiku' }, cwd);
  try {
    h.dispatch({ type: 'control_request', channelId: 'ch', requestId: 'r1', text, context });
    await waitFor(() => done, 90000);
    return resultText;
  } finally {
    pm.closeChannel('ch');
  }
}

describe.skipIf(!RUN)('ide context through the real MessageBroker and CLI (CLAUDE_ACCEPTANCE)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ide-context-'));
  const filePath = '/tmp/zz-ctx-probe.ts';

  afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('selection text reaches the model', async () => {
    const reply = await askThroughBroker(
      'Reply with only the name of the constant in the selection I made.' + NO_TOOLS,
      { filePath, selection: { startLine: 3, endLine: 5, text: 'const zzSecretMarker = 1' } },
      cwd
    );
    console.log('selection reply:', JSON.stringify(reply));
    expect(reply).toContain('zzSecretMarker');
  }, 120000);

  it('file-only context reaches the model', async () => {
    const reply = await askThroughBroker(
      'Reply with only the path of the file I have open.' + NO_TOOLS,
      { filePath },
      cwd
    );
    console.log('file reply:', JSON.stringify(reply));
    expect(reply).toContain('zz-ctx-probe.ts');
  }, 120000);

  it('withheld selection text is never visible to the model', async () => {
    const real = join(cwd, 'secret.ts');
    writeFileSync(real, 'const zzNeverSent = 1;\nconst b = 2;\nconst c = 3;\n');
    const reply = await askThroughBroker(
      'Reply with only the name of the constant in my selection, or NONE if you cannot see its text.' + NO_TOOLS,
      { filePath: real, selection: { startLine: 1, endLine: 1 } },
      cwd
    );
    console.log('withheld reply:', JSON.stringify(reply));
    expect(reply).not.toContain('zzNeverSent');
  }, 120000);
});
