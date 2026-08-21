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

  describe('session groups', () => {
    it('listGroups() returns empty array initially', () => {
      const { manager } = makeManager();
      expect(manager.listGroups()).toEqual([]);
    });

    it('createGroup() returns a group with a stable id and persists it', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      expect(group.name).toBe('Work');
      expect(group.id).toBeTruthy();
      expect(manager.listGroups()).toEqual([group]);
    });

    it('createGroup() generates distinct ids for distinct groups', async () => {
      const { manager } = makeManager();
      const a = await manager.createGroup('A');
      const b = await manager.createGroup('B');
      expect(a.id).not.toBe(b.id);
    });

    it('renameGroup() updates the name', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Old Name');
      await manager.renameGroup(group.id, 'New Name');
      expect(manager.listGroups()).toEqual([{ id: group.id, name: 'New Name' }]);
    });

    it('renameGroup() is a no-op for an unknown group id', async () => {
      const { manager } = makeManager();
      await expect(manager.renameGroup('unknown', 'New Name')).resolves.toBeUndefined();
      expect(manager.listGroups()).toEqual([]);
    });

    it('deleteGroup() removes the group and clears groupId on every member session (cascade)', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      await manager.updateSession('s1', 'idle', 'Session 1');
      await manager.updateSession('s2', 'idle', 'Session 2');
      await manager.moveSessionsToGroup(['s1', 's2'], group.id);

      await manager.deleteGroup(group.id);

      expect(manager.listGroups()).toEqual([]);
      expect(manager.getSession('s1')?.groupId).toBeUndefined();
      expect(manager.getSession('s2')?.groupId).toBeUndefined();
    });

    it('deleteGroup() does not touch sessions in a different group', async () => {
      const { manager } = makeManager();
      const groupA = await manager.createGroup('A');
      const groupB = await manager.createGroup('B');
      await manager.updateSession('s1', 'idle');
      await manager.moveSessionsToGroup(['s1'], groupB.id);

      await manager.deleteGroup(groupA.id);

      expect(manager.getSession('s1')?.groupId).toBe(groupB.id);
    });

    it('moveSessionsToGroup() moves a single session into a group', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      await manager.updateSession('s1', 'idle');
      await manager.moveSessionsToGroup(['s1'], group.id);
      expect(manager.getSession('s1')?.groupId).toBe(group.id);
    });

    it('moveSessionsToGroup() moves multiple sessions into a group', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      await manager.updateSession('s1', 'idle');
      await manager.updateSession('s2', 'idle');
      await manager.moveSessionsToGroup(['s1', 's2'], group.id);
      expect(manager.getSession('s1')?.groupId).toBe(group.id);
      expect(manager.getSession('s2')?.groupId).toBe(group.id);
    });

    it('moveSessionsToGroup() with groupId: null clears membership', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      await manager.updateSession('s1', 'idle');
      await manager.moveSessionsToGroup(['s1'], group.id);
      await manager.moveSessionsToGroup(['s1'], null);
      expect(manager.getSession('s1')?.groupId).toBeUndefined();
    });

    it('moveSessionsToGroup() skips unknown session ids without throwing', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      await expect(manager.moveSessionsToGroup(['unknown'], group.id)).resolves.toBeUndefined();
    });

    it('groupId survives an unrelated updateSession() call', async () => {
      const { manager } = makeManager();
      const group = await manager.createGroup('Work');
      await manager.updateSession('s1', 'idle', 'Title');
      await manager.moveSessionsToGroup(['s1'], group.id);

      await manager.updateSession('s1', 'running');

      expect(manager.getSession('s1')?.groupId).toBe(group.id);
    });
  });
});
