import { renderHook, act } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useExtensionReducer } from './extensionStore';
import type { SessionInfo, SessionGroup } from '../lib/ipc';

const fakeSessions: SessionInfo[] = [
  { id: 's1', title: 'Chat', state: 'idle', updatedAt: '2024-01-01T00:00:00Z', hidden: false },
];
const fakeGroups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];

describe('extensionStore', () => {
  test('groups defaults to an empty array', () => {
    const { result } = renderHook(() => useExtensionReducer());
    expect(result.current.state.groups).toEqual([]);
  });

  test('UPDATE_STATE populates groups from an update_state message', () => {
    const { result } = renderHook(() => useExtensionReducer());

    act(() => {
      result.current.handleMessage({
        type: 'update_state',
        sessions: fakeSessions,
        groups: fakeGroups,
        activeSessionId: undefined,
        defaultPermissionMode: 'default',
        thinkingLevel: 'medium',
        focusViewEnabled: false,
      });
    });

    expect(result.current.state.sessions).toEqual(fakeSessions);
    expect(result.current.state.groups).toEqual(fakeGroups);
  });

  test('focusViewEnabled defaults to false', () => {
    const { result } = renderHook(() => useExtensionReducer());
    expect(result.current.state.focusViewEnabled).toBe(false);
  });

  test('UPDATE_STATE populates focusViewEnabled from an update_state message', () => {
    const { result } = renderHook(() => useExtensionReducer());

    act(() => {
      result.current.handleMessage({
        type: 'update_state',
        sessions: fakeSessions,
        groups: fakeGroups,
        activeSessionId: undefined,
        defaultPermissionMode: 'default',
        thinkingLevel: 'medium',
        focusViewEnabled: true,
      });
    });

    expect(result.current.state.focusViewEnabled).toBe(true);
  });

  test('SET_DEFAULTS optimistically flips focusViewEnabled', () => {
    const { result } = renderHook(() => useExtensionReducer());

    act(() => {
      result.current.dispatch({ type: 'SET_DEFAULTS', defaults: { focusViewEnabled: true } });
    });

    expect(result.current.state.focusViewEnabled).toBe(true);
  });

  test('LIST_SESSIONS populates groups from a list_sessions_response message', () => {
    const { result } = renderHook(() => useExtensionReducer());

    act(() => {
      result.current.handleMessage({
        type: 'list_sessions_response',
        sessions: fakeSessions,
        groups: fakeGroups,
      });
    });

    expect(result.current.state.sessions).toEqual(fakeSessions);
    expect(result.current.state.groups).toEqual(fakeGroups);
  });
});
