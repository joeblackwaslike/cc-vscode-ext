import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test } from 'vitest';
import { App } from './App';

describe('App: new-conversation flow', () => {
  // Reproduces the exact path the user hit: open panel → New Conversation. The
  // composer must be usable immediately — no WelcomeScreen flash, a send button
  // (not a stuck stop button), and the compose placeholder — all before any
  // stream event has populated the channel.
  test('New Conversation immediately shows a usable, idle composer', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('conversation-view')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('new-session-button'));

    expect(screen.getByTestId('conversation-view')).toBeInTheDocument();
    expect(screen.getByTestId('send-button')).toBeInTheDocument();
    expect(screen.queryByTestId('interrupt-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-input')).toHaveAttribute(
      'placeholder',
      'Message Claude… (@ to mention files)',
    );
  });

  // Submitting a message must (a) render the user's own turn — the CLI stream
  // doesn't echo it back — and (b) flip the composer into the running state.
  test('submitting a message renders the user turn and enters the running state', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByTestId('new-session-button'));
    await user.type(screen.getByTestId('message-input'), 'hello there');
    await user.click(screen.getByTestId('send-button'));

    const userBubble = await screen.findByTestId('chat-message-user');
    expect(userBubble).toHaveTextContent('hello there');
    expect(screen.getByTestId('interrupt-button')).toBeInTheDocument();
    expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();
  });
});
