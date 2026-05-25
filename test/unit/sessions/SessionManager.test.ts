import { describe, it, expect } from 'vitest';
import { createMockMemento } from '../../helpers/mockVscode';
import { SessionStorage } from '../../../src/sessions/SessionStorage';
import { SessionHistory } from '../../../src/sessions/SessionHistory';
import { SessionManager } from '../../../src/sessions/SessionManager';

function makeManager(): { manager: SessionManager; storage: SessionStorage; history: SessionHistory } {
  const memento = createMockMemento();
  const storage = new SessionStorage(memento as never);
  const history = new SessionHistory(storage);
  const manager = new SessionManager(storage, history);
  return { manager, storage, history };
}

describe('SessionManager', () => {
  it('listSessions() returns empty array initially', () => {
    const { manager } = makeManager();
    expect(manager.listSessions()).toEqual([]);
  });

  it('updateSession() creates a new session', async () => {
    const { manager } = makeManager();
    await manager.updateSession('s1', 'running', 'My Chat');
    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe('s1');
    expect(sessions[0]?.title).toBe('My Chat');
    expect(sessions[0]?.state).toBe('running');
  });

  it('updateSession() updates an existing session', async () => {
    const { manager } = makeManager();
    await manager.updateSession('s1', 'running', 'Title');
    await manager.updateSession('s1', 'idle');
    const session = manager.getSession('s1');
    expect(session?.state).toBe('idle');
    expect(session?.title).toBe('Title');
  });

  it('getSession() returns null for unknown id', () => {
    const { manager } = makeManager();
    expect(manager.getSession('unknown')).toBeNull();
  });

  it('deleteSession() soft-hides the session', async () => {
    const { manager } = makeManager();
    await manager.updateSession('s1', 'idle');
    await manager.deleteSession('s1');
    expect(manager.listSessions()).toHaveLength(0);
    expect(manager.listSessions(true)).toHaveLength(1);
    expect(manager.listSessions(true)[0]?.hidden).toBe(true);
  });

  it('renameSession() updates the title', async () => {
    const { manager } = makeManager();
    await manager.updateSession('s1', 'idle', 'Old Title');
    await manager.renameSession('s1', 'New Title');
    expect(manager.getSession('s1')?.title).toBe('New Title');
  });

  it('renameSession() is a no-op for unknown session', async () => {
    const { manager } = makeManager();
    await expect(manager.renameSession('unknown', 'Title')).resolves.toBeUndefined();
  });
});
