import { describe, it, expect, vi } from 'vitest';
import { ControlRequestManager, type ControlResponseEvent } from '../../../src/process/ControlRequest';

function makeManager() {
  const writes: Array<{ channelId: string; data: unknown }> = [];
  let n = 0;
  const mgr = new ControlRequestManager(
    (channelId, data) => writes.push({ channelId, data }),
    () => `req_${++n}`,
    50,
  );
  return { mgr, writes };
}

describe('ControlRequestManager', () => {
  it('writes a control_request with the subtype + payload and a request_id', () => {
    const { mgr, writes } = makeManager();
    mgr.send('ch1', 'set_model', { model: 'sonnet' }).catch(() => {}); // never resolved here
    expect(writes[0]).toEqual({
      channelId: 'ch1',
      data: { type: 'control_request', request_id: 'req_1', request: { subtype: 'set_model', model: 'sonnet' } },
    });
    mgr.dispose(); // settle the pending promise so it can't leak as an unhandled rejection
  });

  it('resolves with the response payload on a matching success', async () => {
    const { mgr } = makeManager();
    const p = mgr.send('ch1', 'get_context_usage');
    const handled = mgr.handleResponse({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req_1', response: { totalTokens: 42 } },
    } as ControlResponseEvent);
    expect(handled).toBe(true);
    await expect(p).resolves.toEqual({ totalTokens: 42 });
  });

  it('rejects on an error response', async () => {
    const { mgr } = makeManager();
    const p = mgr.send('ch1', 'set_model', { model: 'x' });
    mgr.handleResponse({
      type: 'control_response',
      response: { subtype: 'error', request_id: 'req_1', error: 'nope' },
    } as ControlResponseEvent);
    await expect(p).rejects.toThrow('nope');
  });

  it('ignores responses for unknown request_ids', () => {
    const { mgr } = makeManager();
    expect(
      mgr.handleResponse({ type: 'control_response', response: { subtype: 'success', request_id: 'other' } } as ControlResponseEvent),
    ).toBe(false);
  });

  it('times out a request that never gets a response', async () => {
    vi.useFakeTimers();
    const { mgr } = makeManager();
    const p = mgr.send('ch1', 'interrupt');
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });
});
