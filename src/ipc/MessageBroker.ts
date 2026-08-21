import type {
  FromWebviewMessage,
  ToWebviewMessage,
  GetAuthStatusResponseMessage,
  GetCurrentSelectionResponseMessage,
  CreateWorktreeResponseMessage,
  CheckGitStatusResponseMessage,
  CheckoutBranchResponseMessage,
  ThinkingLevel,
  ContextUsage,
} from '../types/ipc';
import { EFFORT_THINKING_TOKENS, type PermissionMode } from '../process/ProcessArgs';
import { parseContextUsage } from '../process/usage';
import { ControlRequestManager, type ControlResponseEvent } from '../process/ControlRequest';
import type { ClaudeStreamEvent } from '../types/process';
import type { ProcessLaunchOptions } from '../process/ClaudeProcessManager';
import type { ILogger } from '../process/ClaudeProcessManager';
import { SessionRelayManager } from '../relay/SessionRelayManager';

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
  swapChannel(channelId: string, options: ProcessLaunchOptions, cwd?: string): Promise<void>;
}

export interface ISessionManager {
  updateSession(id: string, state: 'idle' | 'running' | 'error', title?: string): Promise<void>;
  listSessions(includeHidden?: boolean): unknown[];
  getSession(id: string): unknown | null;
  deleteSession(id: string): Promise<void>;
  renameSession(id: string, title: string): Promise<void>;
  getAllStates(): Map<string, unknown>;
  listGroups(): unknown[];
  createGroup(name: string): Promise<unknown>;
  renameGroup(groupId: string, name: string): Promise<void>;
  deleteGroup(groupId: string): Promise<void>;
  moveSessionsToGroup(sessionIds: string[], groupId: string | null): Promise<void>;
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

export interface ISessionRelayManager {
  registerLaunch(channelId: string, options: ProcessLaunchOptions, cwd?: string): void;
  unregisterChannel(channelId: string): void;
  onContextUsage(channelId: string, usage: ContextUsage): void;
  handleStreamEvent(channelId: string, event: ClaudeStreamEvent): void;
  getThreshold(channelId?: string): number;
  setThreshold(threshold: number, channelId?: string): void;
  isRelaying(channelId: string): boolean;
  enqueueIfRelaying(channelId: string, text: string): boolean;
  updateLaunchOptions(channelId: string, patch: Partial<ProcessLaunchOptions>): void;
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
  sessionRelayManager?: ISessionRelayManager;
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
  private readonly sessionRelayManager: ISessionRelayManager;
  /** Per-channel counter, bumped on every REAL user-submitted turn. Lets an
   * in-flight post-result usage refresh detect that a genuinely new turn
   * started while it was awaiting its control round-trip, and drop its
   * relay notification instead of racing that new turn (see
   * `refreshContextUsage`). */
  private readonly turnGenerations = new Map<string, number>();

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
    this.sessionRelayManager =
      this.services.sessionRelayManager ??
      new SessionRelayManager(this.processManager, this.control, this.viewManager, this.logger);
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

  /** Query the CLI's context breakdown for a channel and broadcast it. `notifyRelay`
   * should only be true when this refresh follows a genuine turn completion (a
   * `result` stream event) — never for an on-demand refresh the webview requested
   * (e.g. opening the usage ring popover), which can happen mid-turn and must not
   * be allowed to trigger a relay while a real response is still in flight.
   *
   * Even when notifyRelay is true, this is an async round-trip: the `result`
   * event flips the webview's `running` state to false before this resolves,
   * so a user can submit a genuinely new turn while it's in flight. Snapshot
   * the channel's turn generation up front and only notify the relay manager
   * if it's unchanged by the time the response lands — otherwise the delayed
   * usage reading would relay a process that's now mid-turn again. */
  private async refreshContextUsage(channelId: string, notifyRelay = false): Promise<void> {
    const generation = this.turnGenerations.get(channelId) ?? 0;
    try {
      const response = await this.control.send(channelId, 'get_context_usage');
      const usage = parseContextUsage(response);
      if (usage) {
        this.viewManager.broadcastMessage({ type: 'context_usage', channelId, usage });
        if (notifyRelay && generation === (this.turnGenerations.get(channelId) ?? 0)) {
          this.sessionRelayManager.onContextUsage(channelId, usage);
        }
      }
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
          this.turnGenerations.set(msg.channelId, (this.turnGenerations.get(msg.channelId) ?? 0) + 1);
          if (!this.sessionRelayManager.enqueueIfRelaying(msg.channelId, msg.text)) {
            this.processManager.sendUserMessage(msg.channelId, msg.text);
          }
          return;

        // ─── Live session controls (applied to the running process now, and
        //     stored as defaults for subsequent launches) ──────────────────
        case 'set_permission_mode':
          this.viewManager.setPermissionMode(msg.mode);
          this.viewManager.broadcastSessionStates();
          this.sendControl(msg.channelId, 'set_permission_mode', { mode: msg.mode, userInitiated: true });
          this.sessionRelayManager.updateLaunchOptions(msg.channelId, { permissionMode: msg.mode });
          return;
        case 'set_thinking_level':
          this.viewManager.setThinkingLevel(msg.level);
          this.viewManager.broadcastSessionStates();
          if (msg.channelId) {
            this.sendControl(msg.channelId, 'set_max_thinking_tokens', {
              maxThinkingTokens: EFFORT_THINKING_TOKENS[msg.level],
            });
            this.sessionRelayManager.updateLaunchOptions(msg.channelId, { effort: msg.level });
          }
          return;
        case 'set_model':
          this.viewManager.setModel(msg.model);
          this.viewManager.broadcastSessionStates();
          if (msg.channelId) {
            this.sendControl(msg.channelId, 'set_model', { model: msg.model });
            this.sessionRelayManager.updateLaunchOptions(msg.channelId, { model: msg.model });
          }
          return;

        // ─── Context-window breakdown (for the usage ring popover) ────────
        case 'get_context_usage':
          void this.refreshContextUsage(msg.channelId);
          return;

        // ─── Session relay ──────────────────────────────────────────────
        case 'get_relay_threshold': {
          const threshold = this.sessionRelayManager.getThreshold(msg.channelId);
          void this.webview.postMessage({ type: 'relay_threshold', channelId: msg.channelId, threshold });
          return;
        }
        case 'set_relay_threshold': {
          this.sessionRelayManager.setThreshold(msg.threshold, msg.channelId);
          const threshold = this.sessionRelayManager.getThreshold(msg.channelId);
          void this.webview.postMessage({ type: 'relay_threshold', channelId: msg.channelId, threshold });
          return;
        }

        // ─── Session management ─────────────────────────────────────────
        case 'list_sessions_request': {
          const sessions = this.sessionManager.listSessions(msg.includeHidden);
          const groups = this.sessionManager.listGroups();
          void this.webview.postMessage({
            type: 'list_sessions_response',
            sessions: sessions as never,
            groups: groups as never,
          });
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
        case 'create_session_group':
          await this.sessionManager.createGroup(msg.name);
          this.viewManager.broadcastSessionStates();
          return;
        case 'rename_session_group':
          await this.sessionManager.renameGroup(msg.groupId, msg.name);
          this.viewManager.broadcastSessionStates();
          return;
        case 'delete_session_group':
          await this.sessionManager.deleteGroup(msg.groupId);
          this.viewManager.broadcastSessionStates();
          return;
        case 'move_sessions_to_group':
          await this.sessionManager.moveSessionsToGroup(msg.sessionIds, msg.groupId);
          this.viewManager.broadcastSessionStates();
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

    this.sessionRelayManager.registerLaunch(channelId, options, msg.cwd);

    // Forward stream events to all webviews. control_response lines are private
    // RPC plumbing — settle them here and never broadcast them as conversation
    // events. After each turn completes, refresh the context-usage breakdown.
    // While a relay is in progress, its internal handoff/reseed turns must
    // never reach the webview as ordinary conversation (it would flip
    // `running` false mid-swap, re-enabling input while the process
    // underneath is being torn down) and must not trigger a redundant
    // relay-notifying refresh of their own.
    this.channelRouter.register(channelId, (event) => {
      const typed = event as { type?: string };
      if (typed.type === 'control_response') {
        this.control.handleResponse(event as ControlResponseEvent);
        return;
      }
      const relaying = this.sessionRelayManager.isRelaying(channelId);
      if (!relaying) {
        this.viewManager.broadcastMessage({
          type: 'request',
          channelId,
          requestId: channelId,
          request: event as ClaudeStreamEvent,
        });
      }
      if (typed.type === 'result') {
        this.sessionRelayManager.handleStreamEvent(channelId, event as ClaudeStreamEvent);
        if (!relaying) void this.refreshContextUsage(channelId, true);
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
    this.turnGenerations.delete(msg.channelId);
    this.sessionRelayManager.unregisterChannel(msg.channelId);
    void this.sessionManager.updateSession(msg.channelId, 'idle');
    this.viewManager.broadcastSessionStates();
  }
}
