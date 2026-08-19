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
  //
  // Caveat: because those nested spies are shared, `triggerStdoutData()` /
  // `triggerProcessEvent()` replay to EVERY listener registered by EVERY
  // process spawned so far in a test — once a test does more than one spawn
  // (e.g. spawnClaude then swapChannel), that fires both the old and the new
  // process's handlers. A test asserting something is wired to the *new*
  // process specifically must target `mockProcess.stdout.on.mock.calls.at(-1)`
  // (the most-recently-registered listener) rather than replaying broadly, or
  // it will stay green even if the new process's own wiring is broken.
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
      // Target only the most-recently-registered stdout listener (the new
      // process's own). triggerStdoutData() would replay to BOTH the old and
      // new process's listeners here (they share the mock's stdout.on spy),
      // which would leave this test green even if _launchProcess never wired
      // up the new process's stdout at all.
      const newestStdoutOn = mockProcess.stdout.on.mock.calls.at(-1) as [
        string,
        (chunk: Buffer) => void,
      ];
      newestStdoutOn[1](Buffer.from(JSON.stringify({ type: 'from-new-proc' }) + '\n'));

      expect(handler).toHaveBeenCalledWith({ type: 'from-new-proc' });
    });

    it("drops stale stdout output from a superseded process instead of routing it", async () => {
      const { manager, router } = makeManager();
      const handler = vi.fn();
      router.register('ch-1', handler);
      await manager.spawnClaude('ch-1', {});
      // Capture the OLD process's own stdout 'data' listener before the swap
      // registers the new process. Using .at(-1) here (rather than the shared
      // triggerStdoutData() helper, which replays to every listener from every
      // process spawned so far) is required to invoke specifically the
      // pre-swap listener and prove it — and only it — is now inert.
      const oldStdoutOn = mockProcess.stdout.on.mock.calls.at(-1) as [
        string,
        (chunk: Buffer) => void,
      ];

      await manager.swapChannel('ch-1', {});
      const newStdoutOn = mockProcess.stdout.on.mock.calls.at(-1) as [
        string,
        (chunk: Buffer) => void,
      ];

      // The old process's buffered stdout flushes after the swap has already
      // registered the new process for 'ch-1'. Without the identity check,
      // this would be routed indistinguishably from real new-process output.
      oldStdoutOn[1](Buffer.from(JSON.stringify({ type: 'stale-from-old-proc' }) + '\n'));
      expect(handler).not.toHaveBeenCalledWith({ type: 'stale-from-old-proc' });

      // The new process's own stdout must still route normally.
      newStdoutOn[1](Buffer.from(JSON.stringify({ type: 'fresh-from-new-proc' }) + '\n'));
      expect(handler).toHaveBeenCalledWith({ type: 'fresh-from-new-proc' });
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

    it('a close/error event on the OLD process during the swap-in-flight window does not unregister the router', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      // The provider auto-resolves on the FIRST call (the initial
      // spawnClaude) but returns a controllable, not-yet-resolved promise on
      // the SECOND call (the swap's own binary resolution) — real behavior,
      // per spawnClaude's doc comment: the binary can be a real download on
      // first use. This lets the test fire the old process's close handler
      // while swapChannel is still awaiting, before this.processes.set() has
      // run for the new process.
      let callCount = 0;
      let resolveSwapBinary: (binary: string) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((resolve) => {
          resolveSwapBinary = resolve;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});
      const oldHandlerCalls = mockProcess.on.mock.calls.slice();

      const swapPromise = manager.swapChannel('ch-1', {});

      // Fire the OLD process's close handler *during* the await window —
      // the map still points at the old process at this instant, since
      // swapChannel hasn't resolved the new binary yet.
      for (const call of oldHandlerCalls as [string, (...a: unknown[]) => void][]) {
        if (call[0] === 'close') call[1](0);
      }

      // Without the `swapping` guard, _cleanupIfCurrent would see the old
      // process as still "current" (this.processes hasn't flipped yet) and
      // call router.unregister('ch-1') right here, with nothing left to ever
      // re-register it.
      expect(manager.hasChannel('ch-1')).toBe(true);
      router.route('ch-1', { type: 'mid-swap' });
      expect(handler).toHaveBeenCalledWith({ type: 'mid-swap' });

      resolveSwapBinary('/usr/local/bin/claude');
      await swapPromise;

      expect(manager.hasChannel('ch-1')).toBe(true);
      const newestStdoutOn = mockProcess.stdout.on.mock.calls.at(-1) as [
        string,
        (chunk: Buffer) => void,
      ];
      newestStdoutOn[1](Buffer.from(JSON.stringify({ type: 'after-swap' }) + '\n'));

      expect(handler).toHaveBeenCalledWith({ type: 'after-swap' });
    });

    it('closeChannel() requested during an in-flight swap is deferred, not dropped: the channel ends up closed once the swap lands', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      // Same controllable-binary-resolution technique as the close/error test
      // above: the swap's own binary resolution stays pending until we
      // explicitly resolve it, giving us a window to call closeChannel()
      // while `this.swapping.has('ch-1')` is still true.
      let callCount = 0;
      let resolveSwapBinary: (binary: string) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((resolve) => {
          resolveSwapBinary = resolve;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});

      const swapPromise = manager.swapChannel('ch-1', {});

      // The user explicitly closes the channel WHILE the swap is still
      // in-flight (before the new process has even been registered). Without
      // deferring, this would kill the still-registered old process but skip
      // cleanup (guarded by `swapping`), so the swap would go on to install
      // a fresh process anyway — resurrecting a channel the user just closed.
      manager.closeChannel('ch-1');
      expect(mockProcess.kill).not.toHaveBeenCalled();

      resolveSwapBinary('/usr/local/bin/claude');
      await swapPromise;

      // The channel must be gone, not resurrected with the freshly-swapped-in
      // process still registered and routable.
      expect(manager.hasChannel('ch-1')).toBe(false);
      router.route('ch-1', { type: 'after-deferred-close' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('closeChannel() requested during a swap whose launch fails kills and cleans up an otherwise-healthy old process (case 2 of the three-case contract)', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      let callCount = 0;
      let rejectSwapBinary: (err: Error) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((_resolve, reject) => {
          rejectSwapBinary = reject;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});

      const swapPromise = manager.swapChannel('ch-1', {});
      manager.closeChannel('ch-1');

      rejectSwapBinary(new Error('binary resolution failed'));
      await expect(swapPromise).rejects.toThrow('binary resolution failed');

      // oldProc is healthy throughout this test — its own close/error
      // handler is never fired (unlike the compound-failure test above,
      // which fires it to set up case 1). That makes the ONLY reason it
      // gets killed and cleaned up here the explicit closeChannel() call
      // made above while the swap was still in flight: case 2 of the
      // three-case contract documented on swapChannel() (a close was
      // requested during the swap window, so it's honored even though the
      // swap attempt itself failed). Assert `logger.info` was never called
      // with the "closed" message oldProc's own 'close' handler would log,
      // so the "healthy" precondition for case 2 is explicit here rather
      // than merely implied by the test never triggering that handler.
      expect(mockLogger.info).not.toHaveBeenCalled();
      expect(manager.hasChannel('ch-1')).toBe(false);
      expect(mockProcess.kill).toHaveBeenCalled();
      router.route('ch-1', { type: 'after-failed-swap' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('leaves a still-healthy old process running and routable when _launchProcess throws mid-swap', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      let callCount = 0;
      let rejectSwapBinary: (err: Error) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((_resolve, reject) => {
          rejectSwapBinary = reject;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});
      const oldProcKill = mockProcess.kill;

      const swapPromise = manager.swapChannel('ch-1', {});
      rejectSwapBinary(new Error('binary resolution failed'));

      // The error must still propagate to the caller.
      await expect(swapPromise).rejects.toThrow('binary resolution failed');

      // The old process never exited on its own — a failed swap attempt must
      // not kill a perfectly healthy session process. Only the swap attempt
      // failed; the session itself must remain usable.
      expect(oldProcKill).not.toHaveBeenCalled();

      // The channel must remain registered and routable to the healthy old
      // process, exactly as it was before the failed swap attempt.
      expect(manager.hasChannel('ch-1')).toBe(true);
      router.route('ch-1', { type: 'still-routed-after-failed-swap' });
      expect(handler).toHaveBeenCalledWith({ type: 'still-routed-after-failed-swap' });
    });

    it('cleans up the old process\'s stale registration when it already exited on its own before the subsequent launch also fails (compound failure)', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      let callCount = 0;
      let rejectSwapBinary: (err: Error) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((_resolve, reject) => {
          rejectSwapBinary = reject;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});
      const oldHandlerCalls = mockProcess.on.mock.calls.slice();
      const oldProcKill = mockProcess.kill;

      const swapPromise = manager.swapChannel('ch-1', {});

      // The old process exits on its own WHILE the swap is still in-flight
      // (binary resolution hasn't settled yet). The `swapping` guard
      // suppresses real cleanup at this point (see _cleanupIfCurrent's doc
      // comment) — this is the "compound failure" scenario
      // session-relay-design-gyf originally documented: nothing will ever
      // re-trigger cleanup for this stale entry once the swap also fails,
      // since close/error events don't refire.
      for (const call of oldHandlerCalls as [string, (...a: unknown[]) => void][]) {
        if (call[0] === 'close') call[1](0);
      }
      expect(manager.hasChannel('ch-1')).toBe(true); // cleanup was suppressed, not skipped

      rejectSwapBinary(new Error('binary resolution failed'));

      // The error must propagate to the caller (SessionRelayManager relies on
      // this to know the relay attempt failed) rather than being swallowed.
      await expect(swapPromise).rejects.toThrow('binary resolution failed');

      // The already-dead old process is not killed again — it already
      // exited on its own.
      expect(oldProcKill).not.toHaveBeenCalled();

      // But its now-stale bookkeeping (map entry + router registration) must
      // be torn down here, since nothing else will ever re-trigger cleanup
      // for it now that the launch has also failed.
      expect(manager.hasChannel('ch-1')).toBe(false);
      router.route('ch-1', { type: 'after-compound-failure' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('handles the fourth reachable combination: oldProc already exited on its own AND a close was explicitly requested, then the launch also fails', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      let callCount = 0;
      let rejectSwapBinary: (err: Error) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount === 1) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((_resolve, reject) => {
          rejectSwapBinary = reject;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});
      const oldHandlerCalls = mockProcess.on.mock.calls.slice();
      const oldProcKill = mockProcess.kill;

      const swapPromise = manager.swapChannel('ch-1', {});

      // oldProc exits on its own while the swap is still in flight — same
      // setup as the compound-failure test above, landing it in
      // exitedProcesses while the `swapping` guard suppresses real cleanup.
      for (const call of oldHandlerCalls as [string, (...a: unknown[]) => void][]) {
        if (call[0] === 'close') call[1](0);
      }
      expect(manager.hasChannel('ch-1')).toBe(true); // cleanup suppressed, not skipped

      // A close is ALSO explicitly requested for the channel while the swap
      // is still in flight — deferred (not acted on immediately) since
      // `swapping` is still held for this channelId.
      manager.closeChannel('ch-1');
      expect(oldProcKill).not.toHaveBeenCalled();

      rejectSwapBinary(new Error('binary resolution failed'));
      await expect(swapPromise).rejects.toThrow('binary resolution failed');

      // Both case 1 (already-exited) and case 2 (deferred close) apply to
      // the same oldProc here. The failure-path `if (!alreadyExited) {
      // oldProc.kill(); }` guard must not kill it redundantly — it's
      // already dead, so no kill call is needed or made, whether from
      // closeChannel()'s deferred request or from this failure-path
      // cleanup. Only the map/router cleanup needs to happen.
      expect(oldProcKill).not.toHaveBeenCalled();
      expect(manager.hasChannel('ch-1')).toBe(false);
      router.route('ch-1', { type: 'after-combined-failure' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('an overlapping second swapChannel() call is not left unprotected when the first call finishes first', async () => {
      const router = new ChannelRouter();
      const handler = vi.fn();
      router.register('ch-1', handler);

      // Three provider calls: (1) the initial spawnClaude, auto-resolved;
      // (2) the first swap ("call A"), auto-resolved so it completes while
      // (3) the second swap ("call B"), started immediately after A without
      // awaiting it, stays controllably pending — reproducing two genuinely
      // overlapping swapChannel() calls for the same channelId.
      let callCount = 0;
      let resolveB: (binary: string) => void = () => {};
      const provider = vi.fn(() => {
        callCount += 1;
        if (callCount <= 2) return Promise.resolve('/usr/local/bin/claude');
        return new Promise<string>((resolve) => {
          resolveB = resolve;
        });
      });

      const manager = new ClaudeProcessManager(provider, router, mockLogger, mockSpawn as never);
      await manager.spawnClaude('ch-1', {});

      const swapAPromise = manager.swapChannel('ch-1', {});
      const swapBPromise = manager.swapChannel('ch-1', {});

      // Let call A's auto-resolved provider promise settle and its `finally`
      // run, while call B is still awaiting its own (controllable) binary
      // resolution.
      await swapAPromise;

      // Fire a close/error event on the process call A just installed, while
      // call B is still mid-launch. Without the per-call token, call A's
      // `finally` would have unconditionally cleared the shared `swapping`
      // guard, so this would be treated as "no swap in flight" and would
      // unregister the router — with nothing left to ever re-register it
      // once call B lands.
      const procAOnCalls = mockProcess.on.mock.calls.slice();
      for (const call of procAOnCalls as [string, (...a: unknown[]) => void][]) {
        if (call[0] === 'close') call[1](0);
      }

      expect(manager.hasChannel('ch-1')).toBe(true);
      router.route('ch-1', { type: 'mid-second-swap' });
      expect(handler).toHaveBeenCalledWith({ type: 'mid-second-swap' });

      resolveB('/usr/local/bin/claude');
      await swapBPromise;

      // Call B's own completion must still tear the guard down normally.
      expect(manager.hasChannel('ch-1')).toBe(true);
      const newestStdoutOn = mockProcess.stdout.on.mock.calls.at(-1) as [
        string,
        (chunk: Buffer) => void,
      ];
      newestStdoutOn[1](Buffer.from(JSON.stringify({ type: 'after-second-swap' }) + '\n'));
      expect(handler).toHaveBeenCalledWith({ type: 'after-second-swap' });
    });
  });
});
