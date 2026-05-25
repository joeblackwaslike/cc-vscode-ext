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

  const mockSpawn = vi.fn(() => proc);
  return { mockProcess: proc, mockSpawn };
});

vi.mock('../../../src/utils/platform', () => ({
  resolveBinaryPath: vi.fn(() => '/usr/local/bin/claude'),
}));

vi.mock('../../../src/process/ProcessArgs', () => ({
  buildArgs: vi.fn(() => [
    '--output-format', 'stream-json',
    '--verbose',
    '--input-format', 'stream-json',
  ]),
}));

import { resolveBinaryPath } from '../../../src/utils/platform';
import { buildArgs } from '../../../src/process/ProcessArgs';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// Replay proc.on listeners registered in the current test for a given event.
// vi.clearAllMocks() wipes mock.calls between tests so there is no cross-test bleed.
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

function makeManager() {
  const router = new ChannelRouter();
  const manager = new ClaudeProcessManager('/ext', router, mockLogger, mockSpawn as never);
  return { manager, router };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ClaudeProcessManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.stdin.writable = true;
  });

  it('spawnClaude() calls spawn with the resolved binary and built args', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});

    expect(resolveBinaryPath).toHaveBeenCalledWith('/ext', undefined);
    expect(buildArgs).toHaveBeenCalledWith({});
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      ['--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
  });

  it('spawnClaude() passes wrapper to resolveBinaryPath', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', { wrapper: '/custom/bin' });
    expect(resolveBinaryPath).toHaveBeenCalledWith('/ext', '/custom/bin');
  });

  it('spawnClaude() marks the channel as active', () => {
    const { manager } = makeManager();
    expect(manager.hasChannel('ch-1')).toBe(false);
    manager.spawnClaude('ch-1', {});
    expect(manager.hasChannel('ch-1')).toBe(true);
  });

  it('spawnClaude() throws if channelId is already active', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    expect(() => manager.spawnClaude('ch-1', {})).toThrow(/"ch-1"/);
  });

  it('stdout NDJSON data is parsed and routed to the router', () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);

    manager.spawnClaude('ch-1', {});
    triggerStdoutData(Buffer.from(JSON.stringify({ type: 'text', content: 'hi' }) + '\n'));

    expect(handler).toHaveBeenCalledWith({ type: 'text', content: 'hi' });
  });

  it('multiple NDJSON lines in one chunk are all routed', () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);

    manager.spawnClaude('ch-1', {});
    triggerStdoutData(Buffer.from('{"type":"a"}\n{"type":"b"}\n{"type":"c"}\n'));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenNthCalledWith(1, { type: 'a' });
    expect(handler).toHaveBeenNthCalledWith(2, { type: 'b' });
    expect(handler).toHaveBeenNthCalledWith(3, { type: 'c' });
  });

  it('malformed JSON on stdout calls logger.warn', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    triggerStdoutData(Buffer.from('not-json\n'));
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('ch-1'));
  });

  it('writeToChannel() writes JSON+newline to stdin', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    manager.writeToChannel('ch-1', { type: 'ping' });
    expect(mockProcess.stdin.write).toHaveBeenCalledWith('{"type":"ping"}\n');
  });

  it('writeToChannel() is a no-op for inactive channels', () => {
    const { manager } = makeManager();
    expect(() => manager.writeToChannel('nope', {})).not.toThrow();
    expect(mockProcess.stdin.write).not.toHaveBeenCalled();
  });

  it('writeToChannel() is a no-op when stdin is not writable', () => {
    const { manager } = makeManager();
    mockProcess.stdin.writable = false;
    manager.spawnClaude('ch-1', {});
    manager.writeToChannel('ch-1', { type: 'ping' });
    expect(mockProcess.stdin.write).not.toHaveBeenCalled();
  });

  it('interruptClaude() sends SIGINT to the process', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    manager.interruptClaude('ch-1');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('interruptClaude() is a no-op for inactive channels', () => {
    const { manager } = makeManager();
    expect(() => manager.interruptClaude('nope')).not.toThrow();
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('closeChannel() kills the process and removes the channel', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    manager.closeChannel('ch-1');
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(manager.hasChannel('ch-1')).toBe(false);
  });

  it('closeChannel() unregisters from the router', () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);
    manager.spawnClaude('ch-1', {});
    manager.closeChannel('ch-1');
    router.route('ch-1', { type: 'late' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('closeChannel() is a no-op for inactive channels', () => {
    const { manager } = makeManager();
    expect(() => manager.closeChannel('nope')).not.toThrow();
    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it("process 'close' event removes the channel and logs", () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    expect(manager.hasChannel('ch-1')).toBe(true);

    triggerProcessEvent('close', 0);

    expect(manager.hasChannel('ch-1')).toBe(false);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('ch-1'));
  });

  it("process 'close' event unregisters from the router", () => {
    const { manager, router } = makeManager();
    const handler = vi.fn();
    router.register('ch-1', handler);
    manager.spawnClaude('ch-1', {});

    triggerProcessEvent('close', 1);
    router.route('ch-1', { type: 'late' });

    expect(handler).not.toHaveBeenCalled();
  });

  it("process 'error' event removes the channel and logs error", () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});

    triggerProcessEvent('error', new Error('ENOENT'));

    expect(manager.hasChannel('ch-1')).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('ch-1'),
      expect.any(Error),
    );
  });

  it('dispose() kills all active processes', () => {
    const { manager } = makeManager();
    manager.spawnClaude('ch-1', {});
    manager.dispose();
    expect(mockProcess.kill).toHaveBeenCalled();
    expect(manager.hasChannel('ch-1')).toBe(false);
  });

  it('dispose() is safe when no channels are active', () => {
    const { manager } = makeManager();
    expect(() => manager.dispose()).not.toThrow();
  });
});
