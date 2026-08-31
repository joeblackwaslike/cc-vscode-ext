import { randomUUID } from 'crypto';
import type { SessionState, SessionInfo, SessionGroup } from '../types/session';
import type { SessionStorage } from './SessionStorage';
import type { SessionHistory } from './SessionHistory';
import { ClaudeProjectReader } from './ClaudeProjectReader';

/**
 * In-memory session registry with persistence via SessionStorage.
 *
 * Maintains `sessionStates: Map<id, SessionState>` as the authoritative cache.
 * All writes go through this class so they stay in sync with globalState.
 */
export class SessionManager {
  private sessionStates: Map<string, SessionState>;
  private groups: SessionGroup[];
  private readonly projectReader = new ClaudeProjectReader();

  constructor(
    private readonly storage: SessionStorage,
    private readonly history: SessionHistory
  ) {
    this.sessionStates = storage.getSessions();
    this.groups = storage.getGroups();
  }

  /** Persist the last-used session ID so panels can auto-resume on reopen. */
  async updateLastSessionId(id: string): Promise<void> {
    await this.storage.setLastSessionId(id);
  }

  /**
   * Sync the in-memory session registry from the Claude CLI's on-disk JSONL files
   * for the given workspace path. Adds new sessions, updates titles of known ones,
   * and removes entries that no longer have a corresponding file on disk.
   */
  async syncFromFilesystem(workspacePath: string): Promise<void> {
    const discovered = await this.projectReader.readSessions(workspacePath);
    const diskIds = new Set(discovered.map((s) => s.id));

    for (const session of discovered) {
      const existing = this.sessionStates.get(session.id);
      const updated: SessionState = {
        ...existing,
        id: session.id,
        title: session.title,
        state: existing?.state ?? 'idle',
        updatedAt: session.updatedAt.toISOString(),
        ...(existing?.groupId !== undefined ? { groupId: existing.groupId } : {}),
      };
      this.sessionStates.set(session.id, updated);
    }

    for (const id of this.sessionStates.keys()) {
      if (!diskIds.has(id)) {
        this.sessionStates.delete(id);
      }
    }

    await this.storage.saveSessions(this.sessionStates);
  }

  /** Update (or create) a session's state and title, then persist. */
  async updateSession(
    id: string,
    state: SessionState['state'],
    title?: string
  ): Promise<void> {
    const existing = this.sessionStates.get(id);
    const updated: SessionState = {
      ...existing,
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

  /** List all sidebar session groups. */
  listGroups(): SessionGroup[] {
    return [...this.groups];
  }

  /**
   * Create a new session group, then persist. Rejects a blank/whitespace-only
   * name at this boundary — the webview's own trim/guard isn't the only thing
   * standing between the untyped IPC surface and a stored group.
   */
  async createGroup(name: string): Promise<SessionGroup> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Group name must not be empty');
    }
    const group: SessionGroup = { id: randomUUID(), name: trimmed };
    this.groups = [...this.groups, group];
    await this.storage.saveGroups(this.groups);
    return group;
  }

  /**
   * Rename an existing session group. No-op (matching `renameSession`'s
   * unknown-id convention) if the id is unknown or the name is blank.
   */
  async renameGroup(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!this.groups.some((g) => g.id === id)) return;
    this.groups = this.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g));
    await this.storage.saveGroups(this.groups);
  }

  /**
   * Delete a session group and cascade: clear `groupId` on every session that
   * referenced it, so no session is left pointing at an unreachable group.
   */
  async deleteGroup(id: string): Promise<void> {
    this.groups = this.groups.filter((g) => g.id !== id);
    await this.storage.saveGroups(this.groups);

    let changed = false;
    for (const [sessionId, session] of this.sessionStates) {
      if (session.groupId === id) {
        const updated: SessionState = { ...session };
        delete updated.groupId;
        this.sessionStates.set(sessionId, updated);
        changed = true;
      }
    }
    if (changed) {
      await this.storage.saveSessions(this.sessionStates);
    }
  }

  /**
   * Move one or more sessions into a group, or clear their group membership
   * when `groupId` is null. Unknown session ids are silently skipped.
   */
  async moveSessionsToGroup(sessionIds: string[], groupId: string | null): Promise<void> {
    let changed = false;
    for (const sessionId of sessionIds) {
      const existing = this.sessionStates.get(sessionId);
      if (!existing) continue;
      const updated: SessionState = { ...existing };
      if (groupId === null) {
        delete updated.groupId;
      } else {
        updated.groupId = groupId;
      }
      this.sessionStates.set(sessionId, updated);
      changed = true;
    }
    if (changed) {
      await this.storage.saveSessions(this.sessionStates);
    }
  }
}
