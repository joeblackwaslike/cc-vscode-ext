import type { ToWebviewMessage, ThinkingLevel } from '../types/ipc';
import type { SessionInfo, SessionGroup } from '../types/session';
import type { PermissionMode } from '../process/ProcessArgs';

export interface IPostable {
  postMessage(msg: ToWebviewMessage): Thenable<boolean>;
}

interface ISessionManagerForBroadcast {
  listSessions(): SessionInfo[];
  listGroups(): SessionGroup[];
}

/**
 * Manages the set of all open webview panels/views and provides broadcast helpers.
 *
 * `allComms` is the authoritative set of connected webviews. Every postMessage to
 * multiple panels goes through `broadcastMessage` so there is one code path to audit.
 */
export class ViewManager {
  private readonly allComms = new Set<IPostable>();
  private activeSessionId: string | undefined;
  private defaultPermissionMode: PermissionMode = 'default';
  private thinkingLevel: ThinkingLevel = 'medium';
  private model: string | undefined;

  constructor(private readonly sessionManager: ISessionManagerForBroadcast) {}

  /** Register a newly-opened webview so it receives broadcasts. */
  register(webview: IPostable): void {
    this.allComms.add(webview);
  }

  /** Unregister a webview when its panel is disposed. */
  unregister(webview: IPostable): void {
    this.allComms.delete(webview);
  }

  /** Returns true if the webview is currently registered. */
  has(webview: IPostable): boolean {
    return this.allComms.has(webview);
  }

  /** Returns the number of registered webviews. */
  get size(): number {
    return this.allComms.size;
  }

  /** Send a message to every registered webview. */
  broadcastMessage(msg: ToWebviewMessage): void {
    for (const webview of this.allComms) {
      void webview.postMessage(msg);
    }
  }

  /**
   * Broadcast the full session state snapshot to all webviews.
   * Called after any mutation to sessions, permission mode, or thinking level.
   */
  broadcastSessionStates(): void {
    const sessions = this.sessionManager.listSessions();
    const groups = this.sessionManager.listGroups();
    this.broadcastMessage({
      type: 'update_state',
      sessions,
      groups,
      activeSessionId: this.activeSessionId,
      defaultPermissionMode: this.defaultPermissionMode,
      thinkingLevel: this.thinkingLevel,
      ...(this.model !== undefined ? { model: this.model } : {}),
    });
  }

  setActiveSession(id: string | undefined): void {
    this.activeSessionId = id;
  }

  setPermissionMode(mode: PermissionMode): void {
    this.defaultPermissionMode = mode;
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.thinkingLevel = level;
  }

  setModel(model: string): void {
    this.model = model;
  }
}
