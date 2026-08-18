import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockProcess, mockSpawn } = vi.hoisted(() => {
  const proc = {
    pid: 12345,
    stdin: {
      write: vi.fn(() => true),
      end: vi.fn(),
      writable: true,
    },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn(),
  };

  // Each call returns a *new* wrapper object (matching real child_process.spawn(),
  // which never returns the same instance twice), but every wrapper shares the
  // same nested spies (on, stdout.on, kill, stdin.write) via shallow copy, so
  // existing tests that assert against `mockProcess.<spy>` keep working. This
  // is required for object-identity-sensitive assertions (e.g. swapChannel's
  // old-vs-new process identity check) to be meaningful under the mock.
  const mockSpawn = vi.fn(() => ({ ...proc }));
  return { mockProcess: proc, mockSpawn };
});

vi.mock('../../../src/process/ProcessArgs', () => ({
  buildArgs: vi.fn(() => [
    '--output-format', 'stream-json',
    '--verbose',
    '--input-format', 'stream-json',
  ]),
}));

import { buildArgs } from '../../../src/process/ProcessArgs';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function triggerProcessEvent(event: string, ...args: unknown[]): void {
  for (const call of mockProcess.on.mock.calls as [string, (...a: unknown[]) => void][]) {
    if (call[0] === event) call[1](...args);
  }
}

function triggerStdoutData(chunk: Buffer): void {
  for (const call of mockProcess.stdout.on.mock.calls as [string, (...a: unknown[]) => void][]) {
    if (call[0] === 'data') call[1](chunk);
  }
}

// The binary is provided by an async provider (downloaded + cached at runtime).
function makeManager(binary = '/usr/local/bin/claude') {
  const router = new ChannelRouter();
  const provider = vi.fn(() => Promise.resolve(binary));
  const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
  return { manager, router, provider };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ClaudeProcessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.stdin.writable = true;
  });

  it('spawnClaude() spawns with the provider binary and built args', async () => {
    const { manager, provider } = makeManager();
    await manager.spawnClaude('ch-1', {});

    expect(provider).toHaveBeenCalled();
    expect(buildArgs).toHaveBeenCalledWith({});
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
  });

  it('spawnClaude() uses a per-launch wrapper override instead of the provider', async () => {
    const { manager, provider } = makeManager();
    await manager.spawnClaude('ch-1', { wrapper: '/custom/bin' });
    expect(provider).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith('/custom/bin', expect.anything(), expect.anything());
  });

  it('spawnClaude() marks the channel as active', async () => {
    const { manager } = makeManager();
    expect(manager.hasChannel('ch-1')).toBe(false);
    await manager.spawnClaude('ch-1', {});
    expect(manager.hasChannel('ch-1')).toBe(true);
  });

  it('spawnClaude() rejects if channelId is already active', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    await expect(manager.spawnClaude('ch-1', {})).rejects.toThrow(/"ch-1"/);
  });

  it('stdout NDJSON data is parsed and routed to the router', async () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);

    await manager.spawnClaude('ch-1', {});
    triggerStdoutData(Buffer.from(JSON.stringify({ type: 'text', content: 'hi' }) + '\n'));

    expect(handler).toHaveBeenCalledWith({ type: 'text', content: 'hi' });
  });

  it('multiple NDJSON lines in one chunk are all routed', async () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);

    await manager.spawnClaude('ch-1', {});
    triggerStdoutData(Buffer.from('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n'));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, { type: 'a' });
    expect(handler).toHaveBeenNthCalledWith(2, { type: 'b' });
    expect(handler).toHaveBeenNthCalledWith(3, { type: 'c' });
  });

  it('malformed JSON on stdout calls logger.warn', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    triggerStdoutData(Buffer.from('not-json\n'));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('ch-1'));
  });

  it('writeToChannel() writes JSON+newline to stdin', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    manager.writeToChannel('ch-1', { type: 'ping' });
    expect(mockProcess.stdin.write).toHaveBeenCalledWith('{"type":"ping"}\n');
  });

  // Contract guard: the CLI's stream-json input rejects a bare-string message
  // ("Expected message role 'user', got 'undefined'") and produces no response.
  // The user turn MUST be wrapped as { role, content }. Verified empirically
  // against claude 2.1.168.
  it('sendUserMessage() writes the SDK user envelope (role + content)', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    manager.sendUserMessage('ch-1', 'hi there');
    expect(mockProcess.stdin.write).toHaveBeenCalledWith(
      '{"type":"user","message":{"role":"user","content":"hi there"}}\n',
    );
  });

  it('writeToChannel() is a no-op for inactive channels', () => {
    const { manager } = makeManager();
    expect(() => manager.writeToChannel('nope', {})).not.toThrow();
    expect(mockProcess.stdin.write).not.toHaveBeenCalled();
  });

  it('writeToChannel() is a no-op when stdin is not writable', async () => {
    const { manager } = makeManager();
    mockProcess.stdin.writable = false;
    await manager.spawnClaude('ch-1', {});
    manager.writeToChannel('ch-1', { type: 'ping' });
    expect(mockProcess.stdin.write).not.toHaveBeenCalled();
  });

  it('interruptClaude() sends SIGINT to the process', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    manager.interruptClaude('ch-1');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('interruptClaude() is a no-op for inactive channels', () => {
    const { manager } = makeManager();
    expect(() => manager.interruptClaude('nope')).not.toThrow();
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('closeChannel() kills the process and removes the channel', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    manager.closeChannel('ch-1');
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(manager.hasChannel('ch-1')).toBe(false);
  });

  it('closeChannel() unregisters from the router', async () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);
    await manager.spawnClaude('ch-1', {});
    manager.closeChannel('ch-1');
    router.route('ch-1', { type: 'late' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('closeChannel() is a no-op for inactive channels', () => {
    const { manager } = makeManager();
    expect(() => manager.closeChannel('nope')).not.toThrow();
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it("process 'close' event removes the channel and logs", async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    expect(manager.hasChannel('ch-1')).toBe(true);

    triggerProcessEvent('close', 0);

    expect(manager.hasChannel('ch-1')).toBe(false);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('ch-1'));
  });

  it("process 'close' event unregisters from the router", async () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);
    await manager.spawnClaude('ch-1', {});

    triggerProcessEvent('close', 1);
    router.route('ch-1', { type: 'late' });

    expect(handler).not.toHaveBeenCalled();
  });

  it("process 'error' event removes the channel and logs error", async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});

    triggerProcessEvent('error', new Error('ENOENT'));

    expect(manager.hasChannel('ch-1')).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('ch-1'),
      expect.any(Error),
    );
  });

  it('a stale close handler from a replaced process does not delete the current entry', async () => {
    const { manager, router } = makeManager();
    await manager.spawnClaude('ch-1', {});
    // Simulate an external replace of the map entry for ch-1 (what swapChannel
    // will do in Task 3) without going through manager's own APIs, so this test
    // exercises only the identity check in isolation.
    const currentHandlers = mockProcess.on.mock.calls.slice(); // capture ch-1's own handlers
    const replacement = { ...mockProcess, kill: vi.fn() };
    (manager as unknown as { processes: Map<string, unknown> }).processes.set('ch-1', replacement);

    for (const call of currentHandlers as [string, (...a: unknown[]) => void][]) {
      if (call[0] === 'close') call[1](0); // fire ch-1's now-stale close handler
    }

    expect(manager.hasChannel('ch-1')).toBe(true);
    const handler = vi.fn();
    router.register('ch-1', handler);
    router.route('ch-1', { type: 'still-here' });
    expect(handler).toHaveBeenCalledWith({ type: 'still-here' });
  });

  it('dispose() kills all active processes', async () => {
    const { manager } = makeManager();
    await manager.spawnClaude('ch-1', {});
    manager.dispose();
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(manager.hasChannel('ch-1')).toBe(false);
  });

  it('dispose() is safe when no channels are active', () => {
    const { manager } = makeManager();
    expect(() => manager.dispose()).not.toThrow();
  });

  describe('swapChannel()', () => {
    it('spawns a new process and keeps the channel active under the same id', async () => {
      const { manager } = makeManager();
      await manager.spawnClaude('ch-1', {});
      expect(manager.hasChannel('ch-1')).toBe(true);

      await manager.swapChannel('ch-1', {});

      expect(manager.hasChannel('ch-1')).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('kills the old process', async () => {
      const { manager } = makeManager();
      await manager.spawnClaude('ch-1', {});
      const oldKill = mockProcess.kill;

      await manager.swapChannel('ch-1', {});

      expect(oldKill).toHaveBeenCalled();
    });

    it('routes stdout from the new process through the same router registration', async () => {
      const { manager, router } = makeManager();
      const handler = vi.fn();
      router.register('ch-1', handler);
      await manager.spawnClaude('ch-1', {});

      await manager.swapChannel('ch-1', {});
      triggerStdoutData(Buffer.from(JSON.stringify({ type: 'from-new-proc' }) + '\n'));

      expect(handler).toHaveBeenCalledWith({ type: 'from-new-proc' });
    });

    it("the old process's own close/error handlers do not tear down the new entry", async () => {
      const { manager, router } = makeManager();
      const handler = vi.fn();
      router.register('ch-1', handler);
      await manager.spawnClaude('ch-1', {});
      const oldHandlerCalls = mockProcess.on.mock.calls.slice();

      await manager.swapChannel('ch-1', {});
      // Fire the *old* process's close handler, simulating it finishing shutdown
      // asynchronously after the swap already completed.
      for (const call of oldHandlerCalls as [string, (...a: unknown[]) => void][]) {
        if (call[0] === 'close') call[1](0);
      }

      expect(manager.hasChannel('ch-1')).toBe(true);
      router.route('ch-1', { type: 'still-routed' });
      expect(handler).toHaveBeenCalledWith({ type: 'still-routed' });
    });

    it('spawns with a fresh binary/args for the new process using the given options', async () => {
      const { manager } = makeManager();
      await manager.spawnClaude('ch-1', { resume: 'old-sess' });

      await manager.swapChannel('ch-1', { permissionMode: 'acceptEdits' }, '/workspace');

      expect(buildArgs).toHaveBeenLastCalledWith({ permissionMode: 'acceptEdits' });
      expect(mockSpawn).toHaveBeenLastCalledWith(
        '/usr/local/bin/claude',
        expect.anything(),
        expect.objectContaining({ cwd: '/workspace' }),
      );
    });

    it('works when there is no existing process for the channel (cold swap)', async () => {
      const { manager } = makeManager();
      await manager.swapChannel('ch-1', {});
      expect(manager.hasChannel('ch-1')).toBe(true);
    });
  });
});
