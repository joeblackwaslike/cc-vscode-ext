import { describe, it, expect, vi } from 'vitest';
import { createIpcTestHarness } from '../../helpers/ipcTestHarness';
import { MessageBroker } from '../../../src/ipc/MessageBroker';

function makebroker() {
  const h = createIpcTestHarness();
  const broker = new MessageBroker(
    h.processManager,
    h.sessionManager,
    h.diffManager,
    h.viewManager,
    h.channelRouter,
    h.webview,
    h.logger,
  );
  return { h, broker };
}

describe('MessageBroker', () => {
  describe('initialization', () => {
    it('registers a message handler with the webview on construction', () => {
      const { h } = makebroker();
      expect(h.webview.onDidReceiveMessage).toHaveBeenCalledOnce();
    });
  });

  describe('launch_claude', () => {
    it('spawns a claude process with channelId and options', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
      expect(h.processManager.spawnClaude).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({}),
        undefined,
      );
    });

    it('passes resume, permissionMode, and cwd to spawnClaude', () => {
      const { h } = makebroker();
      h.dispatch({
        type: 'launch_claude',
        channelId: 'ch-1',
        resume: 'sess-abc',
        permissionMode: 'acceptEdits',
        cwd: '/workspace',
      });
      expect(h.processManager.spawnClaude).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ resume: 'sess-abc', permissionMode: 'acceptEdits' }),
        '/workspace',
      );
    });

    it('updates session state to running', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
      expect(h.sessionManager.updateSession).toHaveBeenCalledWith('ch-1', 'running');
    });

    it('broadcasts session states', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
      expect(h.viewManager.broadcastSessionStates).toHaveBeenCalled();
    });
  });

  describe('close_channel', () => {
    it('closes the process channel', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'close_channel', channelId: 'ch-1' });
      expect(h.processManager.closeChannel).toHaveBeenCalledWith('ch-1');
    });

    it('updates session state to idle', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'close_channel', channelId: 'ch-1' });
      expect(h.sessionManager.updateSession).toHaveBeenCalledWith('ch-1', 'idle');
    });

    it('broadcasts session states', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'close_channel', channelId: 'ch-1' });
      expect(h.viewManager.broadcastSessionStates).toHaveBeenCalled();
    });
  });

  describe('interrupt_claude', () => {
    it('calls interruptClaude on the process manager', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'interrupt_claude', channelId: 'ch-1' });
      expect(h.processManager.interruptClaude).toHaveBeenCalledWith('ch-1');
    });
  });

  describe('control_request', () => {
    it('writes data to the channel stdin', () => {
      const { h } = makebroker();
      const data = { type: 'user_message', text: 'hello' };
      h.dispatch({ type: 'control_request', channelId: 'ch-1', requestId: 'req-1', data });
      expect(h.processManager.writeToChannel).toHaveBeenCalledWith('ch-1', data);
    });
  });

  describe('list_sessions_request', () => {
    it('posts a list_sessions_response with sessions', () => {
      const { h } = makebroker();
      const fakeSessions = [{ id: 's1', title: 'Test', state: 'idle', hidden: false }];
      h.sessionManager.listSessions.mockReturnValue(fakeSessions);

      h.dispatch({ type: 'list_sessions_request' });

      expect(h.postedMessages).toContainEqual({
        type: 'list_sessions_response',
        sessions: fakeSessions,
      });
    });

    it('passes includeHidden to listSessions', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'list_sessions_request', includeHidden: true });
      expect(h.sessionManager.listSessions).toHaveBeenCalledWith(true);
    });
  });

  describe('get_session_request', () => {
    it('posts a get_session_response with the session', () => {
      const { h } = makebroker();
      const session = { id: 's1', title: 'Chat', state: 'idle', hidden: false };
      h.sessionManager.getSession.mockReturnValue(session);

      h.dispatch({ type: 'get_session_request', sessionId: 's1' });

      expect(h.postedMessages).toContainEqual({
        type: 'get_session_response',
        session,
      });
    });

    it('posts null session for unknown id', () => {
      const { h } = makebroker();
      h.sessionManager.getSession.mockReturnValue(null);

      h.dispatch({ type: 'get_session_request', sessionId: 'unknown' });

      expect(h.postedMessages).toContainEqual({
        type: 'get_session_response',
        session: null,
      });
    });
  });

  describe('delete_session', () => {
    it('calls deleteSession and broadcasts', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'delete_session', sessionId: 's1' });
      await vi.waitFor(() => expect(h.sessionManager.deleteSession).toHaveBeenCalledWith('s1'));
      expect(h.viewManager.broadcastSessionStates).toHaveBeenCalled();
    });

    it('posts delete_session_response', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'delete_session', sessionId: 's1' });
      await vi.waitFor(() =>
        expect(h.postedMessages).toContainEqual({ type: 'delete_session_response', success: true }),
      );
    });
  });

  describe('rename_session', () => {
    it('calls renameSession and broadcasts', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'rename_session', sessionId: 's1', title: 'New Name' });
      await vi.waitFor(() =>
        expect(h.sessionManager.renameSession).toHaveBeenCalledWith('s1', 'New Name'),
      );
      expect(h.viewManager.broadcastSessionStates).toHaveBeenCalled();
    });

    it('posts rename_session_response', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'rename_session', sessionId: 's1', title: 'New Name' });
      await vi.waitFor(() =>
        expect(h.postedMessages).toContainEqual({ type: 'rename_session_response' }),
      );
    });
  });

  describe('update_session_state', () => {
    it('calls updateSession with state and title', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'update_session_state', sessionId: 's1', state: 'running', title: 'My Chat' });
      await vi.waitFor(() =>
        expect(h.sessionManager.updateSession).toHaveBeenCalledWith('s1', 'running', 'My Chat'),
      );
    });

    it('broadcasts session states after update', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'update_session_state', sessionId: 's1', state: 'idle' });
      await vi.waitFor(() => expect(h.viewManager.broadcastSessionStates).toHaveBeenCalled());
    });
  });

  describe('open_diff', () => {
    it('calls diffManager.openDiff and posts open_diff_response', async () => {
      const { h } = makebroker();
      const msg = {
        type: 'open_diff' as const,
        channelId: 'ch-1',
        filePath: 'src/index.ts',
        oldContent: 'old',
        newContent: 'new',
      };
      h.dispatch(msg);
      await vi.waitFor(() => expect(h.diffManager.openDiff).toHaveBeenCalledWith(msg));
      expect(h.postedMessages).toContainEqual({ type: 'open_diff_response' });
    });
  });

  describe('unknown message types', () => {
    it('logs unhandled type and does not throw', () => {
      const { h } = makebroker();
      expect(() => h.dispatch({ type: 'get_claude_state' })).not.toThrow();
    });
  });
});
