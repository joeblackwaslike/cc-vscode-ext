import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MessageList } from './MessageList';
import type { ClaudeStreamEvent } from '../lib/ipc';

const ev = (e: Record<string, unknown>) => e as ClaudeStreamEvent;

describe('MessageList: tool call + inline result', () => {
  test('renders a compact tool header with its paired result, and no empty user bubble', () => {
    render(
      <MessageList
        channelId="test-channel"
        events={[
          ev({
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'reading it' },
                { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a/utils.py' } },
              ],
            },
          }),
          ev({
            type: 'user',
            message: {
              content: [
                { type: 'tool_result', tool_use_id: 'tu_1', content: '   1\tdef f(): pass', is_error: false },
              ],
            },
          }),
        ]}
      />,
    );

    // Compact header: tool name + primary arg (basename of file_path)
    const tool = screen.getByTestId('tool-call');
    expect(tool).toHaveTextContent('Read');
    expect(tool).toHaveTextContent('(utils.py)');
    // The paired result is rendered inline (line content surfaced)
    expect(tool).toHaveTextContent('def f(): pass');
    // The tool_result carrier user event must NOT render as a user bubble
    expect(screen.queryByTestId('chat-message-user')).not.toBeInTheDocument();
  });

  test('shows the thinking spinner while waiting for a second turn, after a prior assistant reply', () => {
    render(
      <MessageList
        channelId="test-channel"
        running
        events={[
          ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'first reply' }] } }),
          ev({ type: 'user', message: { content: 'second question' } }),
        ]}
      />,
    );

    expect(screen.getByTestId('chat-loading')).toBeInTheDocument();
  });
});
