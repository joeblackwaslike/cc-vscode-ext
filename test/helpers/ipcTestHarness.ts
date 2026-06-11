/**
 * IPC test harness for MessageBroker unit tests.
 *
 * Creates typed mock objects for all MessageBroker dependencies and a
 * `dispatch()` helper that simulates a webview posting a message to the host.
 *
 * Usage:
 *   const h = createIpcTestHarness();
 *   const broker = new MessageBroker(h.processManager, h.sessionManager, h.diffManager, h.viewManager, h.webview, h.logger);
 *   h.dispatch({ type: 'launch_claude', channelId: 'ch-1' });
 *   expect(h.processManager.spawnClaude).toHaveBeenCalled();
 *   expect(h.postedMessages).toContainEqual({ type: 'update_state', ... });
 */
import { vi } from 'vitest';
import type {
  IAuthManager,
  IAtMentionHandler,
  IFileListProvider,
  IVSCodeBridge,
  IWorktreeManager,
  MessageBrokerServices,
} from '../../src/ipc/MessageBroker';
import type { FromWebviewMessage, ToWebviewMessage } from '../../src/types/ipc';

// ─── Mock shapes ──────────────────────────────────────────────────────────────

export interface MockProcessManager {
  spawnClaude: ReturnType<typeof vi.fn>;
  writeToChannel: ReturnType<typeof vi.fn>;
  interruptClaude: ReturnType<typeof vi.fn>;
  closeChannel: ReturnType<typeof vi.fn>;
  hasChannel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

export interface MockSessionManager {
  updateSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  renameSession: ReturnType<typeof vi.fn>;
  getAllStates: ReturnType<typeof vi.fn>;
}

export interface MockDiffManager {
  openDiff: ReturnType<typeof vi.fn>;
  acceptDiff: ReturnType<typeof vi.fn>;
  rejectDiff: ReturnType<typeof vi.fn>;
  hasDiff: ReturnType<typeof vi.fn>;
}

export interface MockViewManager {
  broadcastMessage: ReturnType<typeof vi.fn>;
  broadcastSessionStates: ReturnType<typeof vi.fn>;
  postToSender: ReturnType<typeof vi.fn>;
}

export interface MockWebview {
  postMessage: ReturnType<typeof vi.fn>;
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
}

export interface MockAuthManager extends IAuthManager {
  ensureChecked: ReturnType<typeof vi.fn>;
  getAuthStatusResponse: ReturnType<typeof vi.fn>;
}

export interface MockWorktreeManager extends IWorktreeManager {
  createWorktree: ReturnType<typeof vi.fn>;
  checkGitStatus: ReturnType<typeof vi.fn>;
  checkoutBranch: ReturnType<typeof vi.fn>;
}

export interface MockAtMentionHandler extends IAtMentionHandler {
  getCurrentSelection: ReturnType<typeof vi.fn>;
}

export interface MockFileListProvider extends IFileListProvider {
  listFiles: ReturnType<typeof vi.fn>;
}

export interface MockVSCodeBridge extends IVSCodeBridge {
  openFile: ReturnType<typeof vi.fn>;
  openUrl: ReturnType<typeof vi.fn>;
  openFolder: ReturnType<typeof vi.fn>;
  openNewConversationTab: ReturnType<typeof vi.fn>;
}

export interface MockTerminalLauncher {
  openClaudeTerminal: ReturnType<typeof vi.fn>;
}

export interface MockMessageBrokerServices extends Required<MessageBrokerServices> {
  authManager: MockAuthManager;
  worktreeManager: MockWorktreeManager;
  atMentionHandler: MockAtMentionHandler;
  fileListProvider: MockFileListProvider;
  vscode: MockVSCodeBridge;
  terminalLauncher: MockTerminalLauncher;
}

export function createMockServices(): MockMessageBrokerServices {
  return {
    authManager: {
      ensureChecked: vi.fn(() => Promise.resolve()),
      getAuthStatusResponse: vi.fn(() => ({
        type: 'get_auth_status_response' as const,
        authenticated: false,
      })),
    },
    worktreeManager: {
      createWorktree: vi.fn(() =>
        Promise.resolve({ type: 'create_worktree_response' as const, success: true, worktreePath: '/tmp/branch' }),
      ),
      checkGitStatus: vi.fn(() =>
        Promise.resolve({ type: 'check_git_status_response' as const, clean: true, branch: 'main' }),
      ),
      checkoutBranch: vi.fn(() =>
        Promise.resolve({ type: 'checkout_branch_response' as const, success: true }),
      ),
    },
    atMentionHandler: {
      getCurrentSelection: vi.fn(() => ({
        type: 'get_current_selection_response' as const,
        text: 'selected text',
        filePath: '/src/foo.ts',
        startLine: 0,
        endLine: 2,
      })),
    },
    fileListProvider: {
      listFiles: vi.fn(() => Promise.resolve(['src/foo.ts', 'src/bar.ts'])),
    },
    vscode: {
      openFile: vi.fn(() => Promise.resolve()),
      openUrl: vi.fn(() => Promise.resolve()),
      openFolder: vi.fn(() => Promise.resolve()),
      openNewConversationTab: vi.fn(() => Promise.resolve()),
    },
    terminalLauncher: {
      openClaudeTerminal: vi.fn(),
    },
  };
}

export interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

// ─── Harness ──────────────────────────────────────────────────────────────────

export interface MockChannelRouter {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
}

export interface IpcTestHarness {
  processManager: MockProcessManager;
  sessionManager: MockSessionManager;
  diffManager: MockDiffManager;
  viewManager: MockViewManager;
  channelRouter: MockChannelRouter;
  webview: MockWebview;
  logger: MockLogger;
  /** Messages posted via webview.postMessage() (responses from the host). */
  postedMessages: ToWebviewMessage[];
  /** Simulate the webview posting a message to the extension host. */
  dispatch(msg: FromWebviewMessage): void;
  /** Clear the postedMessages array between assertions. */
  clearMessages(): void;
}

export function createIpcTestHarness(): IpcTestHarness {
  const postedMessages: ToWebviewMessage[] = [];

  const webview: MockWebview = {
    postMessage: vi.fn((msg: ToWebviewMessage) => {
      postedMessages.push(msg);
      return Promise.resolve(true);
    }),
    onDidReceiveMessage: vi.fn(),
  };

  let messageHandler: ((msg: FromWebviewMessage) => void) | undefined;

  // Capture the handler registered via onDidReceiveMessage so dispatch() can call it
  webview.onDidReceiveMessage.mockImplementation((handler: (msg: FromWebviewMessage) => void) => {
    messageHandler = handler;
    return { dispose: vi.fn() };
  });

  const processManager: MockProcessManager = {
    spawnClaude: vi.fn(),
    writeToChannel: vi.fn(),
    interruptClaude: vi.fn(),
    closeChannel: vi.fn(),
    hasChannel: vi.fn(() => false),
    dispose: vi.fn(),
  };

  const sessionManager: MockSessionManager = {
    updateSession: vi.fn(() => Promise.resolve()),
    listSessions: vi.fn(() => []),
    getSession: vi.fn(() => null),
    deleteSession: vi.fn(() => Promise.resolve()),
    renameSession: vi.fn(() => Promise.resolve()),
    getAllStates: vi.fn(() => new Map()),
  };

  const diffManager: MockDiffManager = {
    openDiff: vi.fn(() => Promise.resolve()),
    acceptDiff: vi.fn(() => Promise.resolve()),
    rejectDiff: vi.fn(),
    hasDiff: vi.fn(() => false),
  };

  const viewManager: MockViewManager = {
    broadcastMessage: vi.fn(),
    broadcastSessionStates: vi.fn(),
    postToSender: vi.fn(),
  };

  const channelRouter: MockChannelRouter = {
    register: vi.fn(),
    unregister: vi.fn(),
  };

  const logger: MockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    processManager,
    sessionManager,
    diffManager,
    viewManager,
    channelRouter,
    webview,
    logger,
    postedMessages,
    dispatch(msg: FromWebviewMessage) {
      if (!messageHandler) {
        throw new Error(
          'No message handler registered. Ensure MessageBroker called webview.onDidReceiveMessage().',
        );
      }
      messageHandler(msg);
    },
    clearMessages() {
      postedMessages.length = 0;
    },
  };
}
