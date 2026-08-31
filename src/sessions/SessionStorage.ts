import type * as vscode from 'vscode';
import type { SessionState, SessionGroup } from '../types/session';

/** Keys used in VS Code's globalState Memento for session persistence. */
const KEYS = {
  sessions: 'claudeCode.sessions',
  hiddenIds: 'claudeCode.hiddenSessionIds',
  lastLocation: 'claudeCode.lastClaudeLocation',
  lastSessionId: 'claudeCode.lastSessionId',
  sessionGroups: 'claudeCode.sessionGroups',
} as const;

/**
 * Persists session metadata in VS Code's `globalState` Memento.
 * Sessions survive extension restarts; titles and states are recovered on reactivation.
 */
export class SessionStorage {
  constructor(private readonly globalState: vscode.Memento) {
    (globalState as vscode.Memento & { setKeysForSync?(keys: readonly string[]): void }).setKeysForSync?.([KEYS.sessions, KEYS.hiddenIds, KEYS.lastSessionId, KEYS.sessionGroups]);
  }

  /** Retrieve all persisted sessions (returns empty map on first run). */
  getSessions(): Map<string, SessionState> {
    const raw = this.globalState.get<Record<string, SessionState>>(KEYS.sessions, {});
    return new Map(Object.entries(raw));
  }

  /** Persist the full sessions map. */
  async saveSessions(sessions: Map<string, SessionState>): Promise<void> {
    await this.globalState.update(KEYS.sessions, Object.fromEntries(sessions));
  }

  getHiddenIds(): Set<string> {
    return new Set(this.globalState.get<string[]>(KEYS.hiddenIds, []));
  }

  async setHiddenIds(ids: Set<string>): Promise<void> {
    await this.globalState.update(KEYS.hiddenIds, [...ids]);
  }

  getLastLocation(): string | undefined {
    return this.globalState.get<string | undefined>(KEYS.lastLocation, undefined);
  }

  async setLastLocation(location: string): Promise<void> {
    await this.globalState.update(KEYS.lastLocation, location);
  }

  getLastSessionId(): string | undefined {
    return this.globalState.get<string | undefined>(KEYS.lastSessionId, undefined);
  }

  async setLastSessionId(id: string | undefined): Promise<void> {
    await this.globalState.update(KEYS.lastSessionId, id);
  }

  getGroups(): SessionGroup[] {
    return this.globalState.get<SessionGroup[]>(KEYS.sessionGroups, []);
  }

  async saveGroups(groups: SessionGroup[]): Promise<void> {
    await this.globalState.update(KEYS.sessionGroups, groups);
  }
}
