import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import type { FromWebviewMessage } from './lib/ipc';

const posted = vi.hoisted((): Array<{ type: string; channelId?: string; permissionMode?: string }> => []);
vi.mock('./lib/ipc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/ipc')>()),
  postMessage: (m: FromWebviewMessage) => { posted.push(m as (typeof posted)[number]); },
}));

import { App } from './App';

function sendInitialState(defaultPermissionMode = 'default'): void {
  act(() => {
    window.postMessage(
      {
        type: 'update_state',
        sessions: [],
        groups: [],
        defaultPermissionMode,
        thinkingLevel: 'medium',
        focusViewEnabled: false,
      },
      '*'
    );
  });
}

describe('App: new-conversation flow', () => {
  // Reproduces the exact path the user hit: open panel → New Conversation. The
  // composer must be usable immediately — no WelcomeScreen flash, a send button
  // (not a stuck stop button), and the compose placeholder — all before any
  // stream event has populated the channel.
  test('New Conversation immediately shows a usable, idle composer', async () => {
    render(<App />);

    expect(screen.queryByTestId('conversation-view')).not.toBeInTheDocument();

    sendInitialState();

    expect(await screen.findByTestId('conversation-view')).toBeInTheDocument();
    expect(screen.getByTestId('send-button')).toBeInTheDocument();
    expect(screen.queryByTestId('interrupt-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-input')).toHaveAttribute(
      'placeholder',
      'Message Claude… (@ to mention files)'
    );
  });

  // Submitting a message must (a) render the user's own turn — the CLI stream
  // doesn't echo it back — and (b) flip the composer into the running state.
  test('submitting a message renders the user turn and enters the running state', async () => {
    const user = userEvent.setup();
    render(<App />);

    sendInitialState();
    await screen.findByTestId('conversation-view');
    await user.type(screen.getByTestId('message-input'), 'hello there');
    await user.click(screen.getByTestId('send-button'));

    const userBubble = await screen.findByTestId('chat-message-user');
    expect(userBubble).toHaveTextContent('hello there');
    expect(screen.getByTestId('interrupt-button')).toBeInTheDocument();
    expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();
  });
});

describe('App: editor context on send', () => {
  test('a send with a visible chip posts the context and renders a history chip in the optimistic turn', async () => {
    const user = userEvent.setup();
    posted.length = 0;
    render(<App />);
    sendInitialState();
    await screen.findByTestId('conversation-view');
    act(() => {
      window.postMessage({ type: 'ide_context', context: { filePath: '/repo/src/app.ts' } }, '*');
    });
    await screen.findByTestId('context-chip-file');

    await user.type(screen.getByTestId('message-input'), 'hello there');
    await user.click(screen.getByTestId('send-button'));

    const request = posted.find((m) => m.type === 'control_request') as unknown as { context?: unknown };
    expect(request.context).toEqual({ filePath: '/repo/src/app.ts' });
    const bubble = await screen.findByTestId('chat-message-user');
    expect(bubble).toHaveTextContent('hello there');
    expect(bubble).not.toHaveTextContent('ide_opened_file');
    expect(await screen.findByTestId('history-chip-file')).toHaveTextContent('app.ts');
  });

  test('a slash command with a visible chip posts no context and renders a plain-text turn', async () => {
    const user = userEvent.setup();
    posted.length = 0;
    render(<App />);
    sendInitialState();
    await screen.findByTestId('conversation-view');
    act(() => {
      window.postMessage({ type: 'ide_context', context: { filePath: '/repo/src/app.ts' } }, '*');
    });
    await screen.findByTestId('context-chip-file');

    await user.type(screen.getByTestId('message-input'), '/clear');
    await user.click(screen.getByTestId('send-button'));

    const request = posted.find((m) => m.type === 'control_request')!;
    expect(request).not.toHaveProperty('context');
    const bubble = await screen.findByTestId('chat-message-user');
    expect(bubble).toHaveTextContent('/clear');
    expect(bubble).not.toHaveTextContent('ide_opened_file');
  });
});

describe('App: per-channel permission mode', () => {
  test('a channel approved into bypass shows bypass while a new tab still launches in the default', async () => {
    const user = userEvent.setup();
    posted.length = 0;
    render(<App />);
    sendInitialState('plan');
    await screen.findByTestId('conversation-view');
    const launches = () => posted.filter((m) => m.type === 'launch_claude');
    const first = launches()[0]!;
    expect(first.permissionMode).toBe('plan');

    act(() => {
      window.postMessage({ type: 'channel_mode', channelId: first.channelId, mode: 'bypassPermissions' }, '*');
    });
    await waitFor(() => expect(screen.getByTestId('mode-selector')).toHaveTextContent('Bypass permissions'));

    await user.click(screen.getByTestId('new-tab-button'));

    expect(launches()).toHaveLength(2);
    expect(launches()[1]!.permissionMode).toBe('plan');
    expect(screen.getByTestId('mode-selector')).toHaveTextContent('Plan mode');
  });
});
