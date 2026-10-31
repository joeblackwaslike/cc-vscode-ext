import { renderHook, act } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useSessionReducer } from './sessionStore';
import type { ClaudeStreamEvent, PermissionRequest, ToWebviewMessage } from '../lib/ipc';

function requestMsg(channelId: string, event: ClaudeStreamEvent): ToWebviewMessage {
  return { type: 'request', channelId, requestId: channelId, request: event };
}

describe('sessionStore', () => {
  // Regression guard: Claude emits a `system` init event on launch, before any
  // user turn. The channel must materialize as NOT running, or the input shows
  // "Claude is thinking…" with a stop button and no way to send.
  test('a fresh channel is not running when its first (init) event arrives', () => {
    const { result } = renderHook(() => useSessionReducer());

    act(() => {
      result.current.handleMessage(requestMsg('c1', { type: 'system' }));
    });

    expect(result.current.state.channels.c1.running).toBe(false);
  });

  test('running flips true on send and clears when a result event arrives', () => {
    const { result } = renderHook(() => useSessionReducer());

    act(() => {
      result.current.dispatch({ type: 'SET_RUNNING', channelId: 'c1', running: true });
    });
    expect(result.current.state.channels.c1.running).toBe(true);

    act(() => {
      result.current.handleMessage(requestMsg('c1', { type: 'result' }));
    });
    expect(result.current.state.channels.c1.running).toBe(false);
  });

  test('relay_started is recorded as a relay_marker event in the channel transcript', () => {
    const { result } = renderHook(() => useSessionReducer());

    act(() => {
      result.current.handleMessage({
        type: 'relay_started',
        channelId: 'c1',
        fromSessionId: 'old-sess',
        toSessionId: 'new-sess',
      });
    });

    expect(result.current.state.channels.c1.events).toEqual([
      { type: 'relay_marker', fromSessionId: 'old-sess', toSessionId: 'new-sess' },
    ]);
  });

  describe('permission prompts', () => {
    const req = (requestId: string, toolUseId: string | undefined = `tu-${requestId}`): PermissionRequest => ({
      channelId: 'c1',
      requestId,
      toolName: 'AskUserQuestion',
      toolUseId,
      input: {},
      suggestions: undefined,
      description: undefined,
      priorMode: undefined,
    });

    test('PERMISSION_ADDED dedupes on requestId', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({ type: 'PERMISSION_ADDED', request: req('r1') });
        result.current.dispatch({ type: 'PERMISSION_ADDED', request: req('r1') });
      });
      expect(result.current.state.permissions.c1.pending).toHaveLength(1);
    });

    test('PERMISSION_RESOLVED removes pending, records decision and copies answers', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({ type: 'PERMISSION_ADDED', request: req('r1') });
        result.current.dispatch({
          type: 'PERMISSION_RESOLVED',
          channelId: 'c1',
          requestId: 'r1',
          toolUseId: 'tu-r1',
          decision: { behavior: 'allow', updatedInput: { answers: { Q: 'A' } } },
        });
      });
      const p = result.current.state.permissions.c1;
      expect(p.pending).toEqual([]);
      expect(p.decisions['tu-r1']).toBe('allowed');
      expect(p.answers['tu-r1']).toEqual({ Q: 'A' });
    });

    test('PERMISSION_RESOLVED deny records denied and ignores malformed answers', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({
          type: 'PERMISSION_RESOLVED',
          channelId: 'c1',
          requestId: 'r1',
          toolUseId: 'tu-r1',
          decision: { behavior: 'deny', message: 'no' },
        });
        result.current.dispatch({
          type: 'PERMISSION_RESOLVED',
          channelId: 'c1',
          requestId: 'r2',
          toolUseId: 'tu-r2',
          decision: { behavior: 'allow', updatedInput: { answers: { Q: 1 } } },
        });
      });
      const p = result.current.state.permissions.c1;
      expect(p.decisions['tu-r1']).toBe('denied');
      expect(p.answers['tu-r2']).toBeUndefined();
    });

    test('PERMISSION_RESOLVED without toolUseId records no decision', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({ type: 'PERMISSION_ADDED', request: req('r1', undefined) });
        result.current.dispatch({
          type: 'PERMISSION_RESOLVED',
          channelId: 'c1',
          requestId: 'r1',
          toolUseId: undefined,
          decision: { behavior: 'deny', message: 'no' },
        });
      });
      const p = result.current.state.permissions.c1;
      expect(p.pending).toEqual([]);
      expect(p.decisions).toEqual({});
    });

    test('PERMISSIONS_CANCELLED marks decisions cancelled and drops pending', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({ type: 'PERMISSION_ADDED', request: req('r1') });
        result.current.dispatch({
          type: 'PERMISSIONS_CANCELLED',
          channelId: 'c1',
          requestIds: ['r1'],
          toolUseIds: ['tu-r1'],
        });
      });
      const p = result.current.state.permissions.c1;
      expect(p.pending).toEqual([]);
      expect(p.decisions['tu-r1']).toBe('cancelled');
    });

    test('COMMENT_ADDED and COMMENT_REMOVED manage plan comments', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({
          type: 'COMMENT_ADDED',
          channelId: 'c1',
          toolUseId: 'tu',
          comment: { id: 'k1', quote: 'q', text: 't' },
        });
        result.current.dispatch({
          type: 'COMMENT_ADDED',
          channelId: 'c1',
          toolUseId: 'tu',
          comment: { id: 'k2', quote: 'q2', text: 't2' },
        });
        result.current.dispatch({ type: 'COMMENT_REMOVED', channelId: 'c1', toolUseId: 'tu', commentId: 'k1' });
      });
      expect(result.current.state.permissions.c1.planComments.tu.map((c) => c.id)).toEqual(['k2']);
    });

    test('handleMessage routes the three permission messages', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.handleMessage({ type: 'permission_request', request: req('r1') });
      });
      expect(result.current.state.permissions.c1.pending).toHaveLength(1);
      act(() => {
        result.current.handleMessage({
          type: 'permission_resolved',
          channelId: 'c1',
          requestId: 'r1',
          toolUseId: 'tu-r1',
          decision: { behavior: 'deny', message: 'x' },
        });
      });
      expect(result.current.state.permissions.c1.decisions['tu-r1']).toBe('denied');
      act(() => {
        result.current.handleMessage({
          type: 'permission_cancelled',
          channelId: 'c1',
          requestIds: [],
          toolUseIds: ['tu-z'],
        });
      });
      expect(result.current.state.permissions.c1.decisions['tu-z']).toBe('cancelled');
    });

    test('CLEAR_CHANNEL drops the channel permissions', () => {
      const { result } = renderHook(() => useSessionReducer());
      act(() => {
        result.current.dispatch({ type: 'PERMISSION_ADDED', request: req('r1') });
        result.current.dispatch({ type: 'CLEAR_CHANNEL', channelId: 'c1' });
      });
      expect(result.current.state.permissions.c1).toBeUndefined();
    });
  });
});
