import { describe, it, expect, vi } from 'vitest';
import { createIpcTestHarness, createMockServices } from '../../helpers/ipcTestHarness';
import { MessageBroker } from '../../../src/ipc/MessageBroker';
import { HANDOFF_SYSTEM_PROMPT } from '../../../src/relay/handoffPrompt';

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

function makeBrokerWithServices() {
  const h = createIpcTestHarness();
  const services = createMockServices();
  const broker = new MessageBroker(
    h.processManager,
    h.sessionManager,
    h.diffManager,
    h.viewManager,
    h.channelRouter,
    h.webview,
    h.logger,
    services,
  );
  return { h, broker, services };
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

    it('marks the session as error if the spawn fails', async () => {
      const { h } = makebroker();
      h.processManager.spawnClaude.mockRejectedValueOnce(new Error('binary download failed'));
      h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
      // The catch runs on a microtask after dispatch returns.
      await vi.waitFor(() =>
        expect(h.sessionManager.updateSession).toHaveBeenCalledWith('ch-1', 'error'),
      );
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
    it('forwards the user text to the process via sendUserMessage', () => {
      const { h } = makebroker();
      h.dispatch({ type: 'control_request', channelId: 'ch-1', requestId: 'req-1', text: 'hello' });
      expect(h.processManager.sendUserMessage).toHaveBeenCalledWith('ch-1', 'hello');
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

  describe('get_auth_status', () => {
    it('posts get_auth_status_response from authManager', async () => {
      const { h, services } = makeBrokerWithServices();
      services.authManager.getAuthStatusResponse.mockReturnValue({
        type: 'get_auth_status_response',
        authenticated: true,
      });
      h.dispatch({ type: 'get_auth_status' });
      await vi.waitFor(() =>
        expect(h.postedMessages).toContainEqual({
          type: 'get_auth_status_response',
          authenticated: true,
        }),
      );
    });

    it('falls back to unauthenticated when no authManager provided', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'get_auth_status' });
      await vi.waitFor(() =>
        expect(h.postedMessages).toContainEqual({
          type: 'get_auth_status_response',
          authenticated: false,
        }),
      );
    });
  });

  describe('create_worktree', () => {
    it('calls worktreeManager.createWorktree and posts response', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'create_worktree', branchName: 'feat/test', cwd: '/repo' });
      await vi.waitFor(() => expect(services.worktreeManager.createWorktree).toHaveBeenCalledWith('feat/test', '/repo'));
      expect(h.postedMessages).toContainEqual({ type: 'create_worktree_response', success: true, worktreePath: '/tmp/branch' });
    });

    it('does nothing when no worktreeManager provided', () => {
      const { h } = makebroker();
      expect(() => h.dispatch({ type: 'create_worktree', branchName: 'feat/test', cwd: '/repo' })).not.toThrow();
    });
  });

  describe('check_git_status', () => {
    it('calls worktreeManager.checkGitStatus and posts response', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'check_git_status', cwd: '/repo' });
      await vi.waitFor(() => expect(services.worktreeManager.checkGitStatus).toHaveBeenCalledWith('/repo'));
      expect(h.postedMessages).toContainEqual(expect.objectContaining({ type: 'check_git_status_response', clean: true }));
    });
  });

  describe('checkout_branch', () => {
    it('calls worktreeManager.checkoutBranch and posts response', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'checkout_branch', branchName: 'main', cwd: '/repo' });
      await vi.waitFor(() => expect(services.worktreeManager.checkoutBranch).toHaveBeenCalledWith('main', '/repo'));
      expect(h.postedMessages).toContainEqual({ type: 'checkout_branch_response', success: true });
    });
  });

  describe('get_current_selection', () => {
    it('posts get_current_selection_response from atMentionHandler', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'get_current_selection' });
      await vi.waitFor(() => expect(services.atMentionHandler.getCurrentSelection).toHaveBeenCalled());
      expect(h.postedMessages).toContainEqual(
        expect.objectContaining({ type: 'get_current_selection_response', text: 'selected text' }),
      );
    });

    it('falls back to empty text when no atMentionHandler provided', async () => {
      const { h } = makebroker();
      h.dispatch({ type: 'get_current_selection' });
      await vi.waitFor(() =>
        expect(h.postedMessages).toContainEqual({ type: 'get_current_selection_response', text: '' }),
      );
    });
  });

  describe('list_files_request', () => {
    it('calls fileListProvider.listFiles and posts list_files_response', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'list_files_request', query: 'foo', cwd: '/repo' });
      await vi.waitFor(() => expect(services.fileListProvider.listFiles).toHaveBeenCalledWith('foo', '/repo'));
      expect(h.postedMessages).toContainEqual({ type: 'list_files_response', files: ['src/foo.ts', 'src/bar.ts'] });
    });

    it('does nothing when no fileListProvider provided', () => {
      const { h } = makebroker();
      expect(() => h.dispatch({ type: 'list_files_request', query: 'foo' })).not.toThrow();
    });
  });

  describe('VS Code native operations', () => {
    it('open_url calls vscode.openUrl', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'open_url', url: 'https://example.com' });
      await vi.waitFor(() => expect(services.vscode.openUrl).toHaveBeenCalledWith('https://example.com'));
    });

    it('open_file calls vscode.openFile with path and optional line', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'open_file', filePath: '/src/foo.ts', line: 42 });
      await vi.waitFor(() => expect(services.vscode.openFile).toHaveBeenCalledWith('/src/foo.ts', 42));
    });

    it('open_folder calls vscode.openFolder', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'open_folder', folderPath: '/projects/myapp' });
      await vi.waitFor(() => expect(services.vscode.openFolder).toHaveBeenCalledWith('/projects/myapp'));
    });

    it('open_folder_in_new_window calls vscode.openFolder with newWindow=true', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'open_folder_in_new_window', folderPath: '/projects/myapp' });
      await vi.waitFor(() => expect(services.vscode.openFolder).toHaveBeenCalledWith('/projects/myapp', true));
    });

    it('new_conversation_tab calls vscode.openNewConversationTab', async () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'new_conversation_tab' });
      await vi.waitFor(() => expect(services.vscode.openNewConversationTab).toHaveBeenCalled());
    });
  });

  describe('login', () => {
    it('opens the claude terminal via terminalLauncher', () => {
      const { h, services } = makeBrokerWithServices();
      h.dispatch({ type: 'login' });
      expect(services.terminalLauncher.openClaudeTerminal).toHaveBeenCalledOnce();
    });
  });
});

function makeBrokerWithRelay() {
  const h = createIpcTestHarness();
  const sessionRelayManager = {
    registerLaunch: vi.fn(),
    unregisterChannel: vi.fn(),
    onContextUsage: vi.fn(),
    handleStreamEvent: vi.fn(),
    getThreshold: vi.fn(() => 70),
    setThreshold: vi.fn(),
  };
  const broker = new MessageBroker(
    h.processManager,
    h.sessionManager,
    h.diffManager,
    h.viewManager,
    h.channelRouter,
    h.webview,
    h.logger,
    { sessionRelayManager },
  );
  return { h, broker, sessionRelayManager };
}

describe('SessionRelayManager wiring', () => {
  it('launch_claude registers the launch with SessionRelayManager', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'launch_claude', channelId: 'ch-1', cwd: '/work', permissionMode: 'acceptEdits' });
    expect(sessionRelayManager.registerLaunch).toHaveBeenCalledWith(
      'ch-1',
      expect.objectContaining({ permissionMode: 'acceptEdits' }),
      '/work',
    );
  });

  it('close_channel unregisters the channel from SessionRelayManager', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'close_channel', channelId: 'ch-1' });
    expect(sessionRelayManager.unregisterChannel).toHaveBeenCalledWith('ch-1');
  });

  it('a result event is forwarded to SessionRelayManager.handleStreamEvent', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
    const routed = h.channelRouter.register.mock.calls[0][1] as (event: unknown) => void;

    routed({ type: 'result', subtype: 'success', result: 'x' });

    expect(sessionRelayManager.handleStreamEvent).toHaveBeenCalledWith('ch-1', {
      type: 'result', subtype: 'success', result: 'x',
    });
  });

  it('get_context_usage refresh forwards usage to SessionRelayManager.onContextUsage', async () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    // A real get_context_usage round-trip requires the channel's control_response
    // to come back through the same channelRouter handler handleLaunchClaude
    // registers — so launch first to capture that handler.
    h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
    const routed = h.channelRouter.register.mock.calls[0][1] as (event: unknown) => void;

    h.dispatch({ type: 'get_context_usage', channelId: 'ch-1' });

    // ControlRequestManager wrote the control_request to processManager.writeToChannel;
    // pull the request_id it generated so the response we feed back matches it.
    const writeCall = h.processManager.writeToChannel.mock.calls.find(
      ([, data]) => (data as { request?: { subtype?: string } }).request?.subtype === 'get_context_usage',
    );
    expect(writeCall).toBeDefined();
    const requestId = (writeCall![1] as { request_id: string }).request_id;

    routed({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { maxTokens: 100_000, totalTokens: 80_000, percentage: 80, categories: [] },
      },
    });

    await vi.waitFor(() =>
      expect(sessionRelayManager.onContextUsage).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ percentage: 80 }),
      ),
    );
  });

  it('get_relay_threshold posts the current threshold', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    h.dispatch({ type: 'get_relay_threshold', channelId: 'ch-1' });
    expect(sessionRelayManager.getThreshold).toHaveBeenCalledWith('ch-1');
    expect(h.postedMessages).toContainEqual({ type: 'relay_threshold', channelId: 'ch-1', threshold: 70 });
  });

  it('set_relay_threshold updates and echoes back the new threshold', () => {
    const { h, sessionRelayManager } = makeBrokerWithRelay();
    sessionRelayManager.getThreshold.mockReturnValue(55);
    h.dispatch({ type: 'set_relay_threshold', threshold: 55, channelId: 'ch-1' });
    expect(sessionRelayManager.setThreshold).toHaveBeenCalledWith(55, 'ch-1');
    expect(h.postedMessages).toContainEqual({ type: 'relay_threshold', channelId: 'ch-1', threshold: 55 });
  });

  it('falls back to a real SessionRelayManager when none is injected', () => {
    const { h } = makebroker();
    expect(() => h.dispatch({ type: 'get_relay_threshold' })).not.toThrow();
    expect(h.postedMessages).toContainEqual({ type: 'relay_threshold', channelId: undefined, threshold: 70 });
  });
});
