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
  });
});
