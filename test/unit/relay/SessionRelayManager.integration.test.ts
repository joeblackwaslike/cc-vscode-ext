import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import { ControlRequestManager, type ControlResponseEvent } from '../../../src/process/ControlRequest';
import { SessionRelayManager } from '../../../src/relay/SessionRelayManager';
import { HANDOFF_SYSTEM_PROMPT } from '../../../src/relay/handoffPrompt';
import type { ClaudeStreamEvent } from '../../../src/types/process';

// End-to-end coverage for SessionRelayManager's "defer while a control
// request is pending" rule — unit-level coverage with a fake control manager
// lives at test/unit/relay/SessionRelayManager.test.ts:68-75. This proves the
// same behavior against a REAL spawned fake-claude.mjs process and a REAL
// ControlRequestManager, matching claude-roundtrip.test.ts's
// spawning/teardown/polling conventions exactly.

const FAKE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../process/fixtures/fake-claude.mjs',
);
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

function usage(percentage: number) {
  return { categories: [], totalTokens: percentage * 1000, maxTokens: 100_000, percentage };
}

async function setup() {
  const router = new ChannelRouter();
  const events: ClaudeStreamEvent[] = [];
  const pm = new ClaudeProcessManager(() => Promise.resolve('/ext/claude'), router, logger, spawnFake);
  const control = new ControlRequestManager((channelId, data) => pm.writeToChannel(channelId, data));
  const broadcastMessage = vi.fn();
  const relayLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const relay = new SessionRelayManager(pm, control, { broadcastMessage }, relayLogger);

  // Mirrors MessageBroker's real router wiring: control_response lines settle
  // the ControlRequestManager and are never treated as conversation events;
  // result events are forwarded to the relay so it can complete a handoff.
  router.register('ch', (event) => {
    const typed = event as ClaudeStreamEvent;
    events.push(typed);
    if (typed.type === 'control_response') {
      control.handleResponse(event as ControlResponseEvent);
      return;
    }
    if (typed.type === 'result') {
      relay.handleStreamEvent('ch', typed);
    }
  });

  await pm.spawnClaude('ch', {});
  await waitFor(() => events.some((e) => e.type === 'system'));

  return { pm, control, relay, events, broadcastMessage, relayLogger };
}

describe('SessionRelayManager defers while a control request is pending (real spawned process)', () => {
  it('does not send the handoff prompt while a real ControlRequestManager reports hasPending() for the channel', async () => {
    const { pm, control, relay, events, relayLogger } = await setup();
    try {
      relay.registerLaunch('ch', {}, '/work');

      // Drive the real fixture into "needs approval" mid-turn: it emits a
      // control_request (subtype 'can_use_tool') instead of the usual
      // assistant/result pair for this turn.
      pm.sendUserMessage('ch', 'NEEDS_APPROVAL');
      await waitFor(() => events.some((e) => e.type === 'control_request'));

      // Open the host-side control request this signals against the SAME
      // real ControlRequestManager instance the relay checks. fake-claude.mjs
      // deliberately never answers control_request lines (see its header
      // comment), so this stays pending for the rest of the test — proving
      // hasPending() reflects a genuine unresolved round-trip with the real
      // child process, not a mock.
      void control.send('ch', 'get_context_usage').catch(() => {});
      expect(control.hasPending('ch')).toBe(true);

      const sendSpy = vi.spyOn(pm, 'sendUserMessage');
      relay.onContextUsage('ch', usage(90)); // above the default 70% threshold

      // Give the defer path a tick to prove nothing async sneaks a handoff
      // through afterward.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sendSpy).not.toHaveBeenCalledWith('ch', HANDOFF_SYSTEM_PROMPT);
      expect(relay.isRelaying('ch')).toBe(false);
      expect(relayLogger.error).not.toHaveBeenCalled();
      expect(control.hasPending('ch')).toBe(true); // still unresolved — never fabricated a response
    } finally {
      control.dispose();
      pm.closeChannel('ch');
    }
  }, 15000);
});
