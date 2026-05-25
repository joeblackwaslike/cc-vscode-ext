import type { SessionState, SessionInfo } from '../types/session';
import type { SessionStorage } from './SessionStorage';
import type { SessionHistory } from './SessionHistory';

/**
 * In-memory session registry with persistence via SessionStorage.
 *
 * Maintains `sessionStates: Map<id, SessionState>` as the authoritative cache.
 * All writes go through this class so they stay in sync with globalState.
 */
export class SessionManager {
  private sessionStates: Map<string, SessionState>;

  constructor(
    private readonly storage: SessionStorage,
    private readonly history: SessionHistory
  ) {
    this.sessionStates = storage.getSessions();
  }

  /** Update (or create) a session's state and title, then persist. */
  async updateSession(
    id: string,
    state: SessionState['state'],
    title?: string
  ): Promise<void> {
    const existing = this.sessionStates.get(id);
    const updated: SessionState = {
      id,
      title: title ?? existing?.title,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.sessionStates.set(id, updated);
    await this.storage.saveSessions(this.sessionStates);
  }

  /** List sessions, optionally including hidden ones. */
  listSessions(includeHidden = false): SessionInfo[] {
    const hiddenIds = this.history.getHiddenIds();
    return [...this.sessionStates.values()].map((s) => ({
      ...s,
      hidden: hiddenIds.has(s.id),
    })).filter((s) => includeHidden || !s.hidden);
  }

  /** Retrieve a single session by ID (null if not found). */
  getSession(id: string): SessionInfo | null {
    const session = this.sessionStates.get(id);
    if (!session) return null;
    const hidden = this.history.getHiddenIds().has(id);
    return { ...session, hidden };
  }

  /** Soft-delete a session (marks it hidden, keeps data for the CLI). */
  async deleteSession(id: string): Promise<void> {
    await this.history.hideSession(id);
  }

  /** Rename a session (updates the title). */
  async renameSession(id: string, title: string): Promise<void> {
    const existing = this.sessionStates.get(id);
    if (!existing) return;
    await this.updateSession(id, existing.state, title);
  }

  /** Returns the raw in-memory map (used for state broadcasts). */
  getAllStates(): Map<string, SessionState> {
    return this.sessionStates;
  }
}
