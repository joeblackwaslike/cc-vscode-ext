import { describe, it, expect, vi } from 'vitest';
import { ChannelRouter } from '../../../src/process/ChannelRouter';

describe('ChannelRouter', () => {
  it('routes an event to the registered handler', () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.register('ch-1', handler);
    router.route('ch-1', { type: 'message' });
    expect(handler).toHaveBeenCalledWith({ type: 'message' });
  });

  it('routes events to the correct channel when multiple are registered', () => {
    const router = new ChannelRouter();
    const h1 = vi.fn();
    const h2 = vi.fn();
    router.register('ch-1', h1);
    router.register('ch-2', h2);
    router.route('ch-2', { type: 'b' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith({ type: 'b' });
  });

  it('silently drops events for unknown channels', () => {
    const router = new ChannelRouter();
    expect(() => router.route('unknown', {})).not.toThrow();
  });

  it('stops routing after unregister', () => {
    const router = new ChannelRouter();
    const handler = vi.fn();
    router.register('ch-1', handler);
    router.unregister('ch-1');
    router.route('ch-1', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('has() returns true for registered channels', () => {
    const router = new ChannelRouter();
    router.register('ch-1', vi.fn());
    expect(router.has('ch-1')).toBe(true);
    expect(router.has('ch-2')).toBe(false);
  });

  it('has() returns false after unregister', () => {
    const router = new ChannelRouter();
    router.register('ch-1', vi.fn());
    router.unregister('ch-1');
    expect(router.has('ch-1')).toBe(false);
  });
});
