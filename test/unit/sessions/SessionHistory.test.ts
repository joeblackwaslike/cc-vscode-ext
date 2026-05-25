import { describe, it, expect, beforeEach } from 'vitest';
import { createMockMemento } from '../../helpers/mockVscode';
import { SessionStorage } from '../../../src/sessions/SessionStorage';
import { SessionHistory } from '../../../src/sessions/SessionHistory';

describe('SessionHistory', () => {
  let history: SessionHistory;
  let storage: SessionStorage;

  beforeEach(() => {
    const memento = createMockMemento();
    storage = new SessionStorage(memento as never);
    history = new SessionHistory(storage);
  });

  it('lastClosedWasSession is false initially', () => {
    expect(history.lastClosedWasSession).toBe(false);
  });

  it('recordClosed() sets lastClosedWasSession to true', () => {
    history.recordClosed('session-1');
    expect(history.lastClosedWasSession).toBe(true);
    expect(history.getLastClosed()).toBe('session-1');
  });

  it('clearLastClosed() resets the state', () => {
    history.recordClosed('session-1');
    history.clearLastClosed();
    expect(history.lastClosedWasSession).toBe(false);
    expect(history.getLastClosed()).toBeUndefined();
  });

  it('hideSession() adds the id to hidden set', async () => {
    await history.hideSession('session-1');
    expect(history.getHiddenIds().has('session-1')).toBe(true);
  });

  it('hideSession() accumulates multiple ids', async () => {
    await history.hideSession('session-1');
    await history.hideSession('session-2');
    const ids = history.getHiddenIds();
    expect(ids.has('session-1')).toBe(true);
    expect(ids.has('session-2')).toBe(true);
  });
});
