import type { FromWebviewMessage, ToWebviewMessage } from '../types/ipc';
import type { ClaudeStreamEvent } from '../types/process';
import type { ProcessLaunchOptions } from '../process/ClaudeProcessManager';
import type { ILogger } from '../process/ClaudeProcessManager';

// ─── Dependency interfaces ─────────────────────────────────────────────────────

export interface IChannelRouter {
  register(channelId: string, handler: (event: unknown) => void): void;
  unregister(channelId: string): void;
}

export interface IClaudeProcessManager {
  spawnClaude(channelId: string, options: ProcessLaunchOptions, cwd?: string): void;
  writeToChannel(channelId: string, data: unknown): void;
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
}

export interface IWebview {
  postMessage(msg: ToWebviewMessage): Thenable<boolean>;
  onDidReceiveMessage(handler: (msg: unknown) => void): { dispose(): void };
}

/**
 * Central IPC dispatcher: translates incoming FromWebviewMessage events into
 * service calls and posts ToWebviewMessage responses back to the webview.
 *
 * Registered with the webview via `onDidReceiveMessage` at construction time.
 * Each message type routes to a dedicated private handler method.
 */
export class MessageBroker {
  constructor(
    private readonly processManager: IClaudeProcessManager,
    private readonly sessionManager: ISessionManager,
    private readonly diffManager: IDiffManager,
    private readonly viewManager: IViewManager,
    private readonly channelRouter: IChannelRouter,
    private readonly webview: IWebview,
    private readonly logger: ILogger,
  ) {
    webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as FromWebviewMessage);
    });
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
          this.processManager.writeToChannel(msg.channelId, msg.data);
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
    };

    // Forward stream events from the process to all webviews
    this.channelRouter.register(channelId, (event) => {
      this.viewManager.broadcastMessage({
        type: 'request',
        channelId,
        requestId: channelId,
        request: event as ClaudeStreamEvent,
      });
    });

    this.processManager.spawnClaude(channelId, options, msg.cwd);
    void this.sessionManager.updateSession(channelId, 'running');
    this.viewManager.broadcastSessionStates();
  }

  private handleCloseChannel(msg: Extract<FromWebviewMessage, { type: 'close_channel' }>): void {
    this.processManager.closeChannel(msg.channelId);
    void this.sessionManager.updateSession(msg.channelId, 'idle');
    this.viewManager.broadcastSessionStates();
  }
}
