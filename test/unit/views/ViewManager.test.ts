import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ViewManager } from '../../../src/views/ViewManager';
import type { SessionInfo } from '../../../src/types/session';

function makeWebview() {
  return { postMessage: vi.fn(() => Promise.resolve(true)) };
}

const fakeSessions: SessionInfo[] = [
  { id: 's1', title: 'Chat', state: 'idle', updatedAt: '2024-01-01T00:00:00Z', hidden: false },
];

describe('ViewManager', () => {
  let sessionManager: { listSessions: ReturnType<typeof vi.fn> };
  let manager: ViewManager;

  beforeEach(() => {
    sessionManager = { listSessions: vi.fn(() => fakeSessions) };
    manager = new ViewManager(sessionManager as never);
  });

  describe('register / unregister / has / size', () => {
    it('has() returns false before registering', () => {
      const wv = makeWebview();
      expect(manager.has(wv)).toBe(false);
    });

    it('has() returns true after registering', () => {
      const wv = makeWebview();
      manager.register(wv);
      expect(manager.has(wv)).toBe(true);
    });

    it('has() returns false after unregistering', () => {
      const wv = makeWebview();
      manager.register(wv);
      manager.unregister(wv);
      expect(manager.has(wv)).toBe(false);
    });

    it('size reflects the number of registered webviews', () => {
      expect(manager.size).toBe(0);
      const wv1 = makeWebview();
      const wv2 = makeWebview();
      manager.register(wv1);
      manager.register(wv2);
      expect(manager.size).toBe(2);
      manager.unregister(wv1);
      expect(manager.size).toBe(1);
    });

    it('unregister is a no-op for an unknown webview', () => {
      expect(() => manager.unregister(makeWebview())).not.toThrow();
    });
  });

  describe('broadcastMessage()', () => {
    it('sends the message to all registered webviews', () => {
      const wv1 = makeWebview();
      const wv2 = makeWebview();
      manager.register(wv1);
      manager.register(wv2);

      manager.broadcastMessage({ type: 'open_diff_response' });

      expect(wv1.postMessage).toHaveBeenCalledWith({ type: 'open_diff_response' });
      expect(wv2.postMessage).toHaveBeenCalledWith({ type: 'open_diff_response' });
    });

    it('does not send to unregistered webviews', () => {
      const wv1 = makeWebview();
      const wv2 = makeWebview();
      manager.register(wv1);
      manager.register(wv2);
      manager.unregister(wv2);

      manager.broadcastMessage({ type: 'open_diff_response' });

      expect(wv1.postMessage).toHaveBeenCalled();
      expect(wv2.postMessage).not.toHaveBeenCalled();
    });

    it('is a no-op when no webviews are registered', () => {
      expect(() => manager.broadcastMessage({ type: 'open_diff_response' })).not.toThrow();
    });
  });

  describe('broadcastSessionStates()', () => {
    it('posts an update_state message to all webviews', () => {
      const wv = makeWebview();
      manager.register(wv);
      manager.broadcastSessionStates();

      expect(wv.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update_state', sessions: fakeSessions }),
      );
    });

    it('includes default permissionMode and thinkingLevel', () => {
      const wv = makeWebview();
      manager.register(wv);
      manager.broadcastSessionStates();

      const msg = wv.postMessage.mock.calls[0]?.[0];
      expect(msg).toMatchObject({
        defaultPermissionMode: 'default',
        thinkingLevel: 'medium',
        activeSessionId: undefined,
      });
    });

    it('reflects setActiveSession()', () => {
      const wv = makeWebview();
      manager.register(wv);
      manager.setActiveSession('s1');
      manager.broadcastSessionStates();

      const msg = wv.postMessage.mock.calls[0]?.[0];
      expect(msg).toMatchObject({ activeSessionId: 's1' });
    });

    it('reflects setPermissionMode()', () => {
      const wv = makeWebview();
      manager.register(wv);
      manager.setPermissionMode('acceptEdits');
      manager.broadcastSessionStates();

      const msg = wv.postMessage.mock.calls[0]?.[0];
      expect(msg).toMatchObject({ defaultPermissionMode: 'acceptEdits' });
    });

    it('reflects setThinkingLevel()', () => {
      const wv = makeWebview();
      manager.register(wv);
      manager.setThinkingLevel('max');
      manager.broadcastSessionStates();

      const msg = wv.postMessage.mock.calls[0]?.[0];
      expect(msg).toMatchObject({ thinkingLevel: 'max' });
    });
  });
});
