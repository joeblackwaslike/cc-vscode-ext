import { renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const postMessage = vi.hoisted(() => vi.fn());
vi.mock('../lib/ipc', () => ({ postMessage }));

import { useSession } from './useSession';

describe('useSession.sendText', () => {
  test('posts the context when one is given', () => {
    postMessage.mockClear();
    const { result } = renderHook(() => useSession());
    result.current.sendText('ch1', 'hi', 'r1', { filePath: '/repo/a.ts' });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'control_request',
      channelId: 'ch1',
      requestId: 'r1',
      text: 'hi',
      context: { filePath: '/repo/a.ts' },
    });
  });

  test('omits the context key when there is none', () => {
    postMessage.mockClear();
    const { result } = renderHook(() => useSession());
    result.current.sendText('ch1', 'hi', 'r1');

    expect(postMessage.mock.calls[0]![0]).not.toHaveProperty('context');
  });
});
