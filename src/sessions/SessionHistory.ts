import type { SessionStorage } from './SessionStorage';

/**
 * Tracks the "last closed session" state for the Cmd+Shift+T reopen shortcut.
 *
 * VS Code sets `claw-vscode.lastClosedWasSession` context key to true when the
 * last thing the user closed was a Claude session tab. This lets the keybinding
 * intercept Cmd+Shift+T only when it should reopen a Claude session.
 */
export class SessionHistory {
  private lastClosedSessionId: string | undefined = undefined;

  constructor(private readonly storage: SessionStorage) {}

  /** Called when a panel tab is closed. */
  recordClosed(sessionId: string): void {
    this.lastClosedSessionId = sessionId;
  }

  /** Returns the last closed session ID, or undefined if nothing to reopen. */
  getLastClosed(): string | undefined {
    return this.lastClosedSessionId;
  }

  /** Clears the last-closed state (called after reopening). */
  clearLastClosed(): void {
    this.lastClosedSessionId = undefined;
  }

  /** Whether a Claude session was the last thing closed (drives the context key). */
  get lastClosedWasSession(): boolean {
    return this.lastClosedSessionId !== undefined;
  }

  /** Soft-delete a session (adds to hiddenIds in storage). */
  async hideSession(sessionId: string): Promise<void> {
    const ids = this.storage.getHiddenIds();
    ids.add(sessionId);
    await this.storage.setHiddenIds(ids);
  }

  /** Returns the full set of hidden session IDs. */
  getHiddenIds(): Set<string> {
    return this.storage.getHiddenIds();
  }
}
