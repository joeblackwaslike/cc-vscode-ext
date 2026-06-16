import { renderHook, act } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useSessionReducer } from './sessionStore';
import type { ClaudeStreamEvent, ToWebviewMessage } from '../lib/ipc';

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
});
