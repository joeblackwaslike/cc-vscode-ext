import { describe, it, expect, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
vi.mock('vscode', () => ({
  RelativePattern: vi.fn(),
  Uri: { file: vi.fn((path: string) => ({ fsPath: path })) },
  workspace: {
    createFileSystemWatcher: vi.fn(() => ({
      onDidCreate: vi.fn(),
      onDidChange: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import { PermissionRequests } from '../../../src/process/PermissionRequests';
import { MessageBroker } from '../../../src/ipc/MessageBroker';
import { createIpcTestHarness } from '../../helpers/ipcTestHarness';

// A conversation blocked on a permission prompt is the worst case for an orphaned
// channel: the real CLI would wait for an answer forever. This drives a REAL spawned
// fake-claude process through the REAL ClaudeProcessManager, ChannelRouter, broker and
// PermissionRequests, then proves that re-mounting or disposing the owning webview
// kills the process and drops the prompt.

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../process/fixtures/fake-claude.mjs'
);

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

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

async function setupBlockedConversation() {
  const children: ChildProcess[] = [];
  const spawnFake = ((_cmd: string, _args: string[], opts: object) => {
    const child = spawn(process.execPath, [FAKE], opts);
    children.push(child);
    return child;
  }) as never;
  const logger = { info() {}, warn() {}, error() {} };
  const router = new ChannelRouter();
  const pm = new ClaudeProcessManager(() => Promise.resolve('/ext/claude'), router, logger, spawnFake);
  const h = createIpcTestHarness();
  const permissionRequests = new PermissionRequests({
    write: (c, d) => pm.writeToChannel(c, d),
    broadcast: (m) => h.viewManager.broadcastMessage(m),
  });
  const broker = new MessageBroker(
    pm,
    h.sessionManager,
    h.diffManager,
    h.viewManager,
    router,
    h.webview,
    h.logger,
    { permissionRequests }
  );

  h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
  await waitFor(() => pm.hasChannel('ch-1'));
  pm.sendUserMessage('ch-1', 'NEEDS_APPROVAL');
  await waitFor(() => permissionRequests.pendingFor('ch-1').length === 1);
  return { h, pm, broker, permissionRequests, child: children[0]! };
}

describe('webview ownership of launched channels (real process)', () => {
  it('a re-mounted webview kills the CLI its previous incarnation left blocked on a prompt', async () => {
    const { h, pm, permissionRequests, child } = await setupBlockedConversation();
    expect(hasExited(child)).toBe(false);

    h.dispatch({ type: 'get_auth_status' });

    await waitFor(() => hasExited(child));
    expect(pm.hasChannel('ch-1')).toBe(false);
    expect(permissionRequests.pendingFor('ch-1')).toEqual([]);
  });

  it('disposing the broker (webview closed) kills the CLI blocked on a prompt', async () => {
    const { pm, broker, permissionRequests, child } = await setupBlockedConversation();

    broker.dispose();

    await waitFor(() => hasExited(child));
    expect(pm.hasChannel('ch-1')).toBe(false);
    expect(permissionRequests.pendingFor('ch-1')).toEqual([]);
  });
});
