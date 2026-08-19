import { describe, it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelRouter } from '../../../src/process/ChannelRouter';
import { ClaudeProcessManager } from '../../../src/process/ClaudeProcessManager';
import { ControlRequestManager, type ControlResponseEvent } from '../../../src/process/ControlRequest';
import { SessionRelayManager } from '../../../src/relay/SessionRelayManager';
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
    // Declared outside the try block so `finally` below (which asserts on
    // the settled rejection reason) can still see them.
    let controlSendRejection: unknown;
    let controlSendPromise: Promise<void> | undefined;
    try {
      relay.registerLaunch('ch', {}, '/work');

      // Drive the real fixture into "needs approval" mid-turn: it emits a
      // control_request (subtype 'can_use_tool') instead of the usual
      // assistant/result pair for this turn. This narratively illustrates "a
      // tool call is blocked pending approval" and exercises the fixture's
      // control_request support, but it is NOT what makes hasPending('ch')
      // true below — the router only ever forwards control_response messages
      // into the ControlRequestManager (see the router.register callback
      // above), never incoming control_requests, so this emission is only
      // pushed into `events` for observation.
      pm.sendUserMessage('ch', 'NEEDS_APPROVAL');
      await waitFor(() => events.some((e) => e.type === 'control_request'));

      // This is what actually drives hasPending('ch') to true, independent
      // of the control_request emitted above: a separate host-initiated
      // control request against the SAME real ControlRequestManager instance
      // the relay checks. fake-claude.mjs deliberately never answers
      // control_request lines (see its header comment), so this stays
      // pending for the rest of the test — proving hasPending() reflects a
      // genuine unresolved round-trip with the real child process, not a
      // mock. A future maintainer should not assume resolving/answering the
      // fixture's own control_request above is what's needed to un-defer the
      // relay — it isn't; this call is.
      // Capture the rejection reason instead of swallowing it outright: an
      // UNEXPECTED rejection (a real bug elsewhere) must still fail this
      // test, not pass vacuously. The only EXPECTED rejection is the one
      // `control.dispose()` produces in this test's own `finally` block
      // below (ControlRequest.ts's `dispose()` rejects every still-pending
      // request with `new Error('control channel disposed')`), which is
      // asserted on explicitly there.
      controlSendPromise = control.send('ch', 'get_context_usage').catch((err: unknown) => {
        controlSendRejection = err;
      });
      expect(control.hasPending('ch')).toBe(true);

      const sendSpy = vi.spyOn(pm, 'sendUserMessage');
      relay.onContextUsage('ch', usage(90)); // above the default 70% threshold

      // Give the defer path a tick to prove nothing async sneaks a handoff
      // through afterward.
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The spy is installed after the NEEDS_APPROVAL fixture turn, so
      // asserting it was never called at all is strictly stronger than (and
      // equally true as) checking it wasn't called with the handoff prompt
      // specifically.
      expect(sendSpy).not.toHaveBeenCalled();
      expect(relay.isRelaying('ch')).toBe(false);
      expect(relayLogger.error).not.toHaveBeenCalled();
      expect(control.hasPending('ch')).toBe(true); // still unresolved — never fabricated a response
    } finally {
      // pm.closeChannel('ch') runs first, before control.dispose() and the
      // assertions below, and unconditionally — this test spawns a REAL
      // child process (fake-claude.mjs). If dispose() or either expect()
      // below throws (exactly the failure mode this block exists to catch
      // — an unexpected rejection reason), the process must still be torn
      // down; running closeChannel() after any of those would leak that
      // real spawned child on any such failure and risk a hung vitest
      // worker.
      pm.closeChannel('ch');
      control.dispose();
      // `dispose()` above rejects the pending control_send synchronously;
      // await its (already-swallowed-into-a-variable) settlement so the
      // assertion below observes the final reason. Only skipped if the
      // `try` block threw before `control.send()` even ran.
      if (controlSendPromise) {
        await controlSendPromise;
        expect(controlSendRejection).toBeInstanceOf(Error);
        expect((controlSendRejection as Error).message).toBe('control channel disposed');
      }
    }
  }, 15000);
});
