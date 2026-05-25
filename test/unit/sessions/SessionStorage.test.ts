import { describe, it, expect, beforeEach } from 'vitest';
import { createMockMemento } from '../../helpers/mockVscode';
import { SessionStorage } from '../../../src/sessions/SessionStorage';
import type { SessionState } from '../../../src/types/session';

function makeSession(id: string): SessionState {
  return { id, title: `Session ${id}`, state: 'idle', updatedAt: '2024-01-01T00:00:00Z' };
}

describe('SessionStorage', () => {
  let memento: ReturnType<typeof createMockMemento>;
  let storage: SessionStorage;

  beforeEach(() => {
    memento = createMockMemento();
    storage = new SessionStorage(memento as never);
  });

  it('getSessions() returns an empty map on first run', () => {
    expect(storage.getSessions().size).toBe(0);
  });

  it('saveSessions() persists and getSessions() retrieves', async () => {
    const sessions = new Map([['s1', makeSession('s1')], ['s2', makeSession('s2')]]);
    await storage.saveSessions(sessions);
    const loaded = storage.getSessions();
    expect(loaded.size).toBe(2);
    expect(loaded.get('s1')?.title).toBe('Session s1');
  });

  it('getHiddenIds() returns empty set initially', () => {
    expect(storage.getHiddenIds().size).toBe(0);
  });

  it('setHiddenIds() persists and getHiddenIds() retrieves', async () => {
    await storage.setHiddenIds(new Set(['id-1', 'id-2']));
    const ids = storage.getHiddenIds();
    expect(ids.has('id-1')).toBe(true);
    expect(ids.has('id-2')).toBe(true);
  });

  it('getLastLocation() returns undefined initially', () => {
    expect(storage.getLastLocation()).toBeUndefined();
  });

  it('setLastLocation() persists and getLastLocation() retrieves', async () => {
    await storage.setLastLocation('panel');
    expect(storage.getLastLocation()).toBe('panel');
  });

  it('constructor calls setKeysForSync', () => {
    expect(memento.setKeysForSync).toHaveBeenCalledOnce();
  });
});
