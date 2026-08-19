import { describe, it, expect, vi } from 'vitest';
import { SessionRelayManager } from '../../../src/relay/SessionRelayManager';
import { HANDOFF_SYSTEM_PROMPT } from '../../../src/relay/handoffPrompt';

function makeFakes() {
  const sendUserMessage = vi.fn();
  const swapChannel = vi.fn(() => Promise.resolve());
  const hasPending = vi.fn(() => false);
  const broadcastMessage = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const processManager = { sendUserMessage, swapChannel };
  const control = { hasPending };
  const viewManager = { broadcastMessage };

  const relay = new SessionRelayManager(processManager, control, viewManager, logger);
  return { relay, processManager, control, viewManager, logger, sendUserMessage, swapChannel, hasPending, broadcastMessage };
}

function usage(percentage: number) {
  return { categories: [], totalTokens: percentage * 1000, maxTokens: 100_000, percentage };
}

describe('SessionRelayManager', () => {
  describe('threshold', () => {
    it('defaults to 70', () => {
      const { relay } = makeFakes();
      expect(relay.getThreshold()).toBe(70);
    });

    it('setThreshold() with no channelId changes the global default', () => {
      const { relay } = makeFakes();
      relay.setThreshold(50);
      expect(relay.getThreshold()).toBe(50);
      expect(relay.getThreshold('ch-1')).toBe(50);
    });

    it('setThreshold() with a channelId overrides only that channel', () => {
      const { relay } = makeFakes();
      relay.setThreshold(40, 'ch-1');
      expect(relay.getThreshold('ch-1')).toBe(40);
      expect(relay.getThreshold('ch-2')).toBe(70);
      expect(relay.getThreshold()).toBe(70);
    });
  });

  describe('onContextUsage() triggering', () => {
    it('does not relay below threshold', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(69));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('starts a relay at/above threshold', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(70));
      expect(sendUserMessage).toHaveBeenCalledWith('ch-1', HANDOFF_SYSTEM_PROMPT);
    });

    it('does not relay a channel that was never registered via registerLaunch', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.onContextUsage('unknown-ch', usage(99));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('defers when a control request is pending for that channel', () => {
      const { relay, sendUserMessage, hasPending } = makeFakes();
      hasPending.mockReturnValue(true);
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(90));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('is re-entrancy safe: a second onContextUsage call mid-relay is a no-op', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(90)); // starts relay, sendUserMessage called once, then awaits capture
      relay.onContextUsage('ch-1', usage(91)); // fires while still awaiting — must not re-enter
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('full relay sequence', () => {
    it('captures the handoff text, swaps with resume stripped, and reseeds the new process', async () => {
      const { relay, processManager, sendUserMessage, swapChannel, broadcastMessage } = makeFakes();
      relay.registerLaunch('ch-1', { resume: 'old-sess', permissionMode: 'acceptEdits' }, '/work');

      relay.onContextUsage('ch-1', usage(80));
      expect(sendUserMessage).toHaveBeenNthCalledWith(1, 'ch-1', HANDOFF_SYSTEM_PROMPT);

      // Old process answers the handoff prompt.
      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'HANDOFF SUMMARY', session_id: 'old-sess-id',
      });
      await vi.waitFor(() => expect(swapChannel).toHaveBeenCalled());

      expect(swapChannel).toHaveBeenCalledWith(
        'ch-1',
        { permissionMode: 'acceptEdits', resume: undefined },
        '/work',
      );

      await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(2));
      expect(sendUserMessage).toHaveBeenNthCalledWith(2, 'ch-1', 'HANDOFF SUMMARY');

      // New process answers the reseed turn.
      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'ack', session_id: 'new-sess-id',
      });

      await vi.waitFor(() =>
        expect(broadcastMessage).toHaveBeenCalledWith({
          type: 'relay_started',
          channelId: 'ch-1',
          fromSessionId: 'old-sess-id',
          toSessionId: 'new-sess-id',
        }),
      );

      expect(processManager.swapChannel).toHaveBeenCalledTimes(1);
    });

    it('gives up (no swap) if the handoff turn errors instead of succeeding', async () => {
      const { relay, swapChannel, logger } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));

      relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'error', is_error: true });

      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
      expect(swapChannel).not.toHaveBeenCalled();
    });

    it('handleStreamEvent() for a channel with no pending capture is a no-op', () => {
      const { relay } = makeFakes();
      expect(() =>
        relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'success', result: 'x' }),
      ).not.toThrow();
    });

    it('a relay is retryable after a failed attempt (relaying flag is released)', async () => {
      const { relay, sendUserMessage, logger } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));
      relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'error' });
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

      relay.onContextUsage('ch-1', usage(80));
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateLaunchOptions()', () => {
    it('a later relay respawns with the updated options, not the original launch snapshot', async () => {
      const { relay, processManager } = makeFakes();
      relay.registerLaunch('ch-1', { permissionMode: 'bypassPermissions' }, '/work');

      // Live control changed permission mode on the running process after launch
      // (e.g. via set_permission_mode) — the relay snapshot must track it.
      relay.updateLaunchOptions('ch-1', { permissionMode: 'default' });

      relay.onContextUsage('ch-1', usage(80));
      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'HANDOFF', session_id: 'old-sess',
      });
      await vi.waitFor(() => expect(processManager.swapChannel).toHaveBeenCalled());

      expect(processManager.swapChannel).toHaveBeenCalledWith(
        'ch-1',
        { permissionMode: 'default', resume: undefined },
        '/work',
      );
    });

    it('is a no-op for a channel with no registered launch', () => {
      const { relay } = makeFakes();
      expect(() => relay.updateLaunchOptions('unknown-ch', { permissionMode: 'default' })).not.toThrow();
    });
  });

  describe('unregisterChannel()', () => {
    it('clears launch info so a later onContextUsage cannot relay it', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.unregisterChannel('ch-1');
      relay.onContextUsage('ch-1', usage(99));
      expect(sendUserMessage).not.toHaveBeenCalled();
    });

    it('clears a per-channel threshold override', () => {
      const { relay } = makeFakes();
      relay.setThreshold(10, 'ch-1');
      relay.unregisterChannel('ch-1');
      expect(relay.getThreshold('ch-1')).toBe(70);
    });

    it('clears any queued messages for a closed channel so they are never flushed', async () => {
      const { relay, sendUserMessage, logger } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));
      expect(relay.enqueueIfRelaying('ch-1', 'will be discarded')).toBe(true);

      relay.unregisterChannel('ch-1');

      // The pending handoff capture is rejected by unregisterChannel, so relay()
      // fails and its finally block runs — but the queue must already be gone.
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
      expect(sendUserMessage).toHaveBeenCalledTimes(1); // only the original handoff prompt
    });
  });

  describe('enqueueIfRelaying() / mid-relay message queueing (Bug 1)', () => {
    it('returns false and does not queue when no relay is in progress', () => {
      const { relay } = makeFakes();
      expect(relay.enqueueIfRelaying('ch-1', 'hello')).toBe(false);
    });

    it('queues a real user message while a relay is in progress instead of sending it immediately', () => {
      const { relay, sendUserMessage } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));
      expect(sendUserMessage).toHaveBeenCalledTimes(1); // just the handoff prompt

      expect(relay.enqueueIfRelaying('ch-1', 'real user message')).toBe(true);
      expect(sendUserMessage).toHaveBeenCalledTimes(1); // still not sent
    });

    it('flushes a queued message to the fresh process once the relay finishes successfully', async () => {
      const { relay, sendUserMessage, swapChannel } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));
      expect(relay.enqueueIfRelaying('ch-1', 'real user message')).toBe(true);

      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'HANDOFF', session_id: 'old-sess',
      });
      await vi.waitFor(() => expect(swapChannel).toHaveBeenCalled());
      await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(2));
      expect(sendUserMessage).toHaveBeenNthCalledWith(2, 'ch-1', 'HANDOFF');

      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'ack', session_id: 'new-sess',
      });

      await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(3));
      expect(sendUserMessage).toHaveBeenNthCalledWith(3, 'ch-1', 'real user message');
    });

    it('flushes a queued message to the original process if the relay fails', async () => {
      const { relay, sendUserMessage, logger } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));
      expect(relay.enqueueIfRelaying('ch-1', 'queued during failure')).toBe(true);

      relay.handleStreamEvent('ch-1', { type: 'result', subtype: 'error' });
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

      await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(2));
      expect(sendUserMessage).toHaveBeenNthCalledWith(2, 'ch-1', 'queued during failure');
    });
  });

  describe('captureNextResult() timeout', () => {
    it('times out a relay turn that never emits a result event', async () => {
      vi.useFakeTimers();
      try {
        const { relay, sendUserMessage, logger } = makeFakes();
        relay.registerLaunch('ch-1', {}, '/work');
        relay.onContextUsage('ch-1', usage(80));
        expect(sendUserMessage).toHaveBeenCalledWith('ch-1', HANDOFF_SYSTEM_PROMPT);

        // The handoff turn never emits a result event, so the capture promise
        // will timeout after DEFAULT_TIMEOUT_MS (180 seconds — an LLM
        // generation turn, not a CLI control-protocol RPC; see the constant's
        // doc comment in SessionRelayManager.ts). Advance timers to exceed
        // that timeout.
        await vi.advanceTimersByTimeAsync(181_000);

        // The timeout should reject the capture, causing relay() to catch the
        // error and log it.
        await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());

        // After the relay fails due to timeout, the relaying flag should be
        // released so future relay attempts are possible.
        expect(relay.isRelaying('ch-1')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the timeout if a result arrives before expiry', async () => {
      vi.useFakeTimers();
      try {
        const { relay, swapChannel, sendUserMessage, broadcastMessage } = makeFakes();
        relay.registerLaunch('ch-1', {}, '/work');
        relay.onContextUsage('ch-1', usage(80));

        // Advance time partway, but not past the timeout.
        await vi.advanceTimersByTimeAsync(5_000);

        // Result arrives before timeout.
        relay.handleStreamEvent('ch-1', {
          type: 'result', subtype: 'success', result: 'HANDOFF', session_id: 'old-sess',
        });

        // The promise should resolve immediately and the relay should proceed to
        // swapChannel. If the timeout wasn't cleared, it would fire later and
        // interfere with the relay flow. By checking that swapChannel was called
        // (which means the relay reached that point), we verify the timeout was
        // properly cleared and didn't interfere.
        await vi.waitFor(() => expect(swapChannel).toHaveBeenCalled());
        await vi.waitFor(() => expect(sendUserMessage).toHaveBeenCalledTimes(2));

        // Now advance to t=182_000: past t=180_000, where the ORIGINAL
        // handoff timer would have fired had `clearTimeout(pending.timer)`
        // in handleStreamEvent() been dropped (it started at t=0, deadline
        // DEFAULT_TIMEOUT_MS=180_000) — but comfortably short of t=185_000,
        // the reseed capture's own legitimate deadline (its timer started at
        // t=5_000, when swapChannel resolved and the reseed capture was
        // registered), so this advance doesn't trip a real timeout of its
        // own. If that clearTimeout call were ever removed, the stale
        // handoff timer would fire here and — without the identity check
        // added in captureNextResult()'s timer callback (fix for the
        // "timer callback deletes the map entry without an identity check"
        // finding) — would delete the *reseed* capture's map entry, causing
        // the reseed result fed below to hit handleStreamEvent()'s "no
        // pending capture" no-op path instead of completing the relay.
        await vi.advanceTimersByTimeAsync(177_000);

        // Reseed turn's result arrives; the relay should still complete
        // normally, proving the stale first-turn timer never interfered.
        relay.handleStreamEvent('ch-1', {
          type: 'result', subtype: 'success', result: 'ack', session_id: 'new-sess',
        });

        await vi.waitFor(() =>
          expect(broadcastMessage).toHaveBeenCalledWith({
            type: 'relay_started',
            channelId: 'ch-1',
            fromSessionId: 'old-sess',
            toSessionId: 'new-sess',
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('a stale timer for an already-replaced capture never touches the newer capture, but still settles its OWN promise rather than hanging forever', async () => {
      vi.useFakeTimers();
      try {
        const { relay } = makeFakes();

        interface PendingCapture {
          resolve: (result: { text: string; sessionId: string | undefined }) => void;
          reject: (err: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
        const internals = relay as unknown as {
          captureNextResult(channelId: string): Promise<{ text: string; sessionId: string | undefined }>;
          pendingCaptures: Map<string, PendingCapture>;
        };

        // Register a real capture (and its real timer) directly, bypassing
        // relay()'s own flow so this test targets only captureNextResult()'s
        // timer callback in isolation.
        const staleCapture = internals.captureNextResult('ch-1');
        let staleSettled: 'pending' | 'rejected' = 'pending';
        let staleRejection: unknown;
        staleCapture.catch((err: unknown) => {
          staleSettled = 'rejected';
          staleRejection = err;
        });

        // Simulate a newer capture (e.g. the reseed turn's) having replaced
        // the map entry for the same channelId while the original timer is
        // still outstanding — the exact race the identity check guards
        // against.
        const freshResolve = vi.fn();
        const freshReject = vi.fn();
        const freshTimer = setTimeout(() => {}, 999_999);
        internals.pendingCaptures.set('ch-1', { resolve: freshResolve, reject: freshReject, timer: freshTimer });

        // Advance past the ORIGINAL (now-stale) timer's deadline.
        await vi.advanceTimersByTimeAsync(181_000);
        await Promise.resolve(); // flush the stale promise's catch() microtask

        // The stale timer must not touch the newer capture's map entry, or
        // call either of its functions, at all.
        expect(freshReject).not.toHaveBeenCalled();
        expect(freshResolve).not.toHaveBeenCalled();
        expect(internals.pendingCaptures.get('ch-1')).toEqual({
          resolve: freshResolve,
          reject: freshReject,
          timer: freshTimer,
        });

        // ...but it MUST still settle its OWN (stale) promise instead of
        // leaving it permanently pending. Each captureNextResult() call
        // owns its own resolve/reject pair via closure, so calling this
        // timer's reject() can only ever settle the promise created by
        // THIS call — never the fresh capture's — regardless of what's
        // currently in the map. This is the assertion that actually
        // distinguishes this test from the old code shape: a prior version
        // of this fix guarded reject() itself behind the same identity
        // check as the map delete, which left a superseded capture's
        // promise permanently unsettled — a latent infinite hang for
        // relay(), which awaits every captureNextResult() call. If reject()
        // were ever guarded that way again, staleSettled would stay
        // 'pending' here and this assertion would fail.
        expect(staleSettled).toBe('rejected');
        expect(staleRejection).toBeInstanceOf(Error);
        expect((staleRejection as Error).message).toBe('relay turn on channel "ch-1" timed out');

        clearTimeout(freshTimer);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('relay() liveness checks between capture points (Bug 2)', () => {
    it('aborts cleanly, without calling swapChannel, if the channel is closed right after the handoff response resolves', async () => {
      const { relay, sendUserMessage, swapChannel } = makeFakes();
      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));

      // Resolve the handoff capture, then close the channel in the same
      // synchronous tick — before relay()'s `await handoffCapture` continuation
      // (a microtask) gets a chance to run its liveness check.
      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'HANDOFF', session_id: 'old-sess',
      });
      relay.unregisterChannel('ch-1');

      // Flush all pending microtasks/macrotasks so relay()'s continuation runs.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(swapChannel).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1); // only the original handoff prompt
    });

    it('aborts cleanly, without sending the reseed turn, if the channel is closed right after swapChannel resolves', async () => {
      const sendUserMessage = vi.fn();
      const hasPending = vi.fn(() => false);
      const broadcastMessage = vi.fn();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      let resolveSwap: () => void = () => {};
      const swapChannel = vi.fn(() => new Promise<void>((resolve) => { resolveSwap = resolve; }));
      const processManager = { sendUserMessage, swapChannel };
      const control = { hasPending };
      const viewManager = { broadcastMessage };
      const relay = new SessionRelayManager(processManager, control, viewManager, logger);

      relay.registerLaunch('ch-1', {}, '/work');
      relay.onContextUsage('ch-1', usage(80));

      relay.handleStreamEvent('ch-1', {
        type: 'result', subtype: 'success', result: 'HANDOFF', session_id: 'old-sess',
      });
      await vi.waitFor(() => expect(swapChannel).toHaveBeenCalled());

      // Resolve swapChannel, then close the channel in the same synchronous
      // tick — before relay()'s `await swapChannel(...)` continuation (a
      // microtask) gets a chance to register the reseed capture.
      resolveSwap();
      relay.unregisterChannel('ch-1');

      await new Promise((resolve) => setTimeout(resolve, 0));

      // Only the handoff prompt was ever sent — the reseed turn
      // (sendUserMessage(channelId, handoff.text)) must never fire.
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(broadcastMessage).not.toHaveBeenCalled();
    });
  });
});
