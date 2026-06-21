import type {
  FromWebviewMessage,
  ToWebviewMessage,
  GetAuthStatusResponseMessage,
  GetCurrentSelectionResponseMessage,
  CreateWorktreeResponseMessage,
  CheckGitStatusResponseMessage,
  CheckoutBranchResponseMessage,
  ThinkingLevel,
} from '../types/ipc';
import { EFFORT_THINKING_TOKENS, type PermissionMode } from '../process/ProcessArgs';
import { parseContextUsage } from '../process/usage';
import { ControlRequestManager, type ControlResponseEvent } from '../process/ControlRequest';
import type { ClaudeStreamEvent } from '../types/process';
import type { ProcessLaunchOptions } from '../process/ClaudeProcessManager';
import type { ILogger } from '../process/ClaudeProcessManager';

// ─── Dependency interfaces ─────────────────────────────────────────────────────

export interface IChannelRouter {
  register(channelId: string, handler: (event: unknown) => void): void;
  unregister(channelId: string): void;
}

export interface IClaudeProcessManager {
  spawnClaude(channelId: string, options: ProcessLaunchOptions, cwd?: string): Promise<void>;
  writeToChannel(channelId: string, data: unknown): void;
  sendUserMessage(channelId: string, text: string): void;
  interruptClaude(channelId: string): void;
  closeChannel(channelId: string): void;
  hasChannel(channelId: string): boolean;
}

export interface ISessionManager {
  updateSession(id: string, state: 'idle' | 'running' | 'error', title?: string): Promise<void>;
  listSessions(includeHidden?: boolean): unknown[];
  getSession(id: string): unknown | null;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  getAllStates(): Map<string, unknown>;
}

export interface IDiffManager {
  openDiff(msg: Extract<FromWebviewMessage, { type: 'open_diff' }>): Promise<void>;
}

export interface IViewManager {
  broadcastMessage(msg: ToWebviewMessage): void;
  broadcastSessionStates(): void;
  setPermissionMode(mode: PermissionMode): void;
  setThinkingLevel(level: ThinkingLevel): void;
  setModel(model: string): void;
}

export interface IWebview {
  postMessage(msg: ToWebviewMessage): Thenable<boolean>;
  onDidReceiveMessage(handler: (msg: unknown) => void): { dispose(): void };
}

// ─── Optional service interfaces ──────────────────────────────────────────────

export interface IAuthManager {
  ensureChecked(): Promise<void>;
  getAuthStatusResponse(): GetAuthStatusResponseMessage;
  invalidate?(): void;
}

export interface IWorktreeManager {
  createWorktree(branchName: string, cwd: string): Promise<CreateWorktreeResponseMessage>;
  checkGitStatus(cwd: string): Promise<CheckGitStatusResponseMessage>;
  checkoutBranch(branchName: string, cwd: string): Promise<CheckoutBranchResponseMessage>;
}

export interface IAtMentionHandler {
  getCurrentSelection(): GetCurrentSelectionResponseMessage;
}

export interface IFileListProvider {
  listFiles(query: string, cwd?: string): Promise<string[]>;
}

export interface IVSCodeBridge {
  openFile(filePath: string, line?: number): Promise<void>;
  openUrl(url: string): Promise<void>;
  openFolder(folderPath: string, newWindow?: boolean): Promise<void>;
  openNewConversationTab(): Promise<void>;
}

export interface ITerminalLauncher {
  openClaudeTerminal(cwd?: string): unknown;
}

export interface ICommandRunner {
  run(execId: string, command: string, cwd?: string): Promise<void>;
}

export interface MessageBrokerServices {
  authManager?: IAuthManager;
  worktreeManager?: IWorktreeManager;
  atMentionHandler?: IAtMentionHandler;
  fileListProvider?: IFileListProvider;
  vscode?: IVSCodeBridge;
  terminalLauncher?: ITerminalLauncher;
  commandRunner?: ICommandRunner;
}

/**
 * Central IPC dispatcher: translates incoming FromWebviewMessage events into
 * service calls and posts ToWebviewMessage responses back to the webview.
 *
 * Registered with the webview via `onDidReceiveMessage` at construction time.
 * Each message type routes to a dedicated private handler method.
 */
export class MessageBroker {
  /** Correlates control_request/control_response over the CLI stdin/stdout. */
  private readonly control: ControlRequestManager;

  constructor(
    private readonly processManager: IClaudeProcessManager,
    private readonly sessionManager: ISessionManager,
    private readonly diffManager: IDiffManager,
    private readonly viewManager: IViewManager,
    private readonly channelRouter: IChannelRouter,
    private readonly webview: IWebview,
    private readonly logger: ILogger,
    private readonly services: MessageBrokerServices = {},
  ) {
    this.control = new ControlRequestManager((channelId, data) =>
      this.processManager.writeToChannel(channelId, data),
    );
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as FromWebviewMessage);
    });
  }

  /** Fire a control request, swallowing failures into the log (live set_*). */
  private sendControl(channelId: string, subtype: Parameters<ControlRequestManager['send']>[1], payload?: Record<string, unknown>): void {
    this.control.send(channelId, subtype, payload).catch((err: unknown) => {
      this.logger.info(`[MessageBroker] control '${subtype}' failed: ${String(err)}`);
    });
  }

  /** Query the CLI's context breakdown for a channel and broadcast it. */
  private async refreshContextUsage(channelId: string): Promise<void> {
    try {
      const response = await this.control.send(channelId, 'get_context_usage');
      const usage = parseContextUsage(response);
      if (usage) this.viewManager.broadcastMessage({ type: 'context_usage', channelId, usage });
    } catch (err) {
      this.logger.info(`[MessageBroker] get_context_usage failed: ${String(err)}`);
    }
  }

  private async handleMessage(msg: FromWebviewMessage): Promise<void> {
    try {
      switch (msg.type) {
        // ─── Process lifecycle ──────────────────────────────────────────
        case 'launch_claude':
          return this.handleLaunchClaude(msg);
        case 'close_channel':
          return this.handleCloseChannel(msg);
        case 'interrupt_claude':
        case 'cancel_request':
          this.processManager.interruptClaude(msg.channelId);
          return;
        case 'control_request':
          this.processManager.sendUserMessage(msg.channelId, msg.text);
          return;

        // ─── Live session controls (applied to the running process now, and
        //     stored as defaults for subsequent launches) ──────────────────
        case 'set_permission_mode':
          this.viewManager.setPermissionMode(msg.mode);
          this.viewManager.broadcastSessionStates();
          this.sendControl(msg.channelId, 'set_permission_mode', { mode: msg.mode, userInitiated: true });
          return;
        case 'set_thinking_level':
          this.viewManager.setThinkingLevel(msg.level);
          this.viewManager.broadcastSessionStates();
          if (msg.channelId) {
            this.sendControl(msg.channelId, 'set_max_thinking_tokens', {
              maxThinkingTokens: EFFORT_THINKING_TOKENS[msg.level],
            });
          }
          return;
        case 'set_model':
          this.viewManager.setModel(msg.model);
          this.viewManager.broadcastSessionStates();
          if (msg.channelId) this.sendControl(msg.channelId, 'set_model', { model: msg.model });
          return;

        // ─── Context-window breakdown (for the usage ring popover) ────────
        case 'get_context_usage':
          void this.refreshContextUsage(msg.channelId);
          return;

        // ─── Session management ─────────────────────────────────────────
        case 'list_sessions_request': {
          const sessions = this.sessionManager.listSessions(msg.includeHidden);
          void this.webview.postMessage({ type: 'list_sessions_response', sessions: sessions as never });
          return;
        }
        case 'get_session_request': {
          const session = this.sessionManager.getSession(msg.sessionId);
          void this.webview.postMessage({ type: 'get_session_response', session: session as never });
          return;
        }
        case 'delete_session':
          await this.sessionManager.deleteSession(msg.sessionId);
          this.viewManager.broadcastSessionStates();
          void this.webview.postMessage({ type: 'delete_session_response', success: true });
          return;
        case 'rename_session':
          await this.sessionManager.renameSession(msg.sessionId, msg.title);
          this.viewManager.broadcastSessionStates();
          void this.webview.postMessage({ type: 'rename_session_response' });
          return;
        case 'update_session_state':
          await this.sessionManager.updateSession(msg.sessionId, msg.state, msg.title);
          this.viewManager.broadcastSessionStates();
          void this.webview.postMessage({ type: 'update_session_state_response' });
          return;

        // ─── Diff ───────────────────────────────────────────────────────
        case 'open_diff':
          await this.diffManager.openDiff(msg);
          void this.webview.postMessage({ type: 'open_diff_response' });
          return;

        // ─── Auth ───────────────────────────────────────────────────────
        case 'get_auth_status': {
          await this.services.authManager?.ensureChecked();
          const response = this.services.authManager?.getAuthStatusResponse()
            ?? { type: 'get_auth_status_response' as const, authenticated: false };
          void this.webview.postMessage(response);
          return;
        }

        case 'login':
          // Logging in via the CLI can write ~/.claude.json after our first
          // auth probe — drop the cached result so the next get_auth_status
          // re-checks and the welcome screen can recover.
          this.services.authManager?.invalidate?.();
          void this.services.terminalLauncher?.openClaudeTerminal();
          return;

        // ─── Worktree ───────────────────────────────────────────────────
        case 'create_worktree': {
          if (this.services.worktreeManager) {
            const response = await this.services.worktreeManager.createWorktree(
              msg.branchName,
              msg.cwd,
            );
            void this.webview.postMessage(response);
          }
          return;
        }
        case 'check_git_status': {
          if (this.services.worktreeManager) {
            const response = await this.services.worktreeManager.checkGitStatus(msg.cwd);
            void this.webview.postMessage(response);
          }
          return;
        }
        case 'checkout_branch': {
          if (this.services.worktreeManager) {
            const response = await this.services.worktreeManager.checkoutBranch(
              msg.branchName,
              msg.cwd,
            );
            void this.webview.postMessage(response);
          }
          return;
        }

        // ─── Inline command execution ───────────────────────────────────
        case 'run_command': {
          void this.services.commandRunner?.run(msg.execId, msg.command, msg.cwd);
          return;
        }

        // ─── At-mention / selection ─────────────────────────────────────
        case 'get_current_selection': {
          const response = this.services.atMentionHandler?.getCurrentSelection()
            ?? { type: 'get_current_selection_response' as const, text: '', filePath: undefined, startLine: undefined, endLine: undefined };
          void this.webview.postMessage(response);
          return;
        }

        // ─── File listing ───────────────────────────────────────────────
        case 'list_files_request': {
          if (this.services.fileListProvider) {
            const files = await this.services.fileListProvider.listFiles(msg.query, msg.cwd);
            void this.webview.postMessage({ type: 'list_files_response', files });
          }
          return;
        }

        // ─── VS Code native operations ──────────────────────────────────
        case 'open_url':
          await this.services.vscode?.openUrl(msg.url);
          return;
        case 'open_file':
          await this.services.vscode?.openFile(msg.filePath, msg.line);
          return;
        case 'open_folder':
          await this.services.vscode?.openFolder(msg.folderPath);
          return;
        case 'open_folder_in_new_window':
          await this.services.vscode?.openFolder(msg.folderPath, true);
          return;
        case 'new_conversation_tab':
          await this.services.vscode?.openNewConversationTab();
          return;

        // ─── Unhandled — log and ignore ─────────────────────────────────
        default:
          this.logger.info(`[MessageBroker] unhandled message type: ${(msg as { type: string }).type}`);
      }
    } catch (err) {
      this.logger.error(`[MessageBroker] error handling ${(msg as { type: string }).type}`, err);
    }
  }

  private handleLaunchClaude(msg: Extract<FromWebviewMessage, { type: 'launch_claude' }>): void {
    const { channelId } = msg;
    const options: ProcessLaunchOptions = {
      ...(msg.resume !== undefined ? { resume: msg.resume } : {}),
      ...(msg.permissionMode !== undefined ? { permissionMode: msg.permissionMode } : {}),
      ...(msg.thinkingLevel !== undefined ? { effort: msg.thinkingLevel } : {}),
      ...(msg.model !== undefined ? { model: msg.model } : {}),
    };

    // Forward stream events to all webviews. control_response lines are private
    // RPC plumbing — settle them here and never broadcast them as conversation
    // events. After each turn completes, refresh the context-usage breakdown.
    this.channelRouter.register(channelId, (event) => {
      const typed = event as { type?: string };
      if (typed.type === 'control_response') {
        this.control.handleResponse(event as ControlResponseEvent);
        return;
      }
      this.viewManager.broadcastMessage({
        type: 'request',
        channelId,
        requestId: channelId,
        request: event as ClaudeStreamEvent,
      });
      if (typed.type === 'result') {
        void this.refreshContextUsage(channelId);
      }
    });

    // Fire-and-forget: the router is already registered, so events flow once the
    // process spawns. The binary may download on first launch — don't block.
    void this.processManager.spawnClaude(channelId, options, msg.cwd).catch((err) => {
      this.logger.info(`[MessageBroker] spawnClaude failed: ${String(err)}`);
      // Don't leave the session stuck in 'running' — reflect the failure in the
      // sidebar state and end the turn in the conversation view.
      void this.sessionManager.updateSession(channelId, 'error');
      this.viewManager.broadcastSessionStates();
      this.viewManager.broadcastMessage({
        type: 'request',
        channelId,
        requestId: channelId,
        request: {
          type: 'result',
          subtype: 'error',
          is_error: true,
          error: `Failed to launch Claude: ${String(err)}`,
        } as ClaudeStreamEvent,
      });
    });
    void this.sessionManager.updateSession(channelId, 'running');
    this.viewManager.broadcastSessionStates();
  }

  private handleCloseChannel(msg: Extract<FromWebviewMessage, { type: 'close_channel' }>): void {
    this.processManager.closeChannel(msg.channelId);
    // Reject any in-flight control requests immediately instead of letting them
    // hang until their 10s timeout after the channel is gone.
    this.control.dispose();
    void this.sessionManager.updateSession(msg.channelId, 'idle');
    this.viewManager.broadcastSessionStates();
  }
}
