import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatInput } from './ChatInput';

describe('ChatInput', () => {
  test('idle state shows the send button and the compose placeholder', () => {
    render(<ChatInput running={false} onSend={() => {}} onInterrupt={() => {}} />);

    expect(screen.getByTestId('send-button')).toBeInTheDocument();
    expect(screen.queryByTestId('interrupt-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-input')).toHaveAttribute(
      'placeholder',
      'Message Claude… (@ to mention files)',
    );
  });

  test('running state shows the stop button and the thinking placeholder', () => {
    render(<ChatInput running={true} onSend={() => {}} onInterrupt={() => {}} />);

    expect(screen.getByTestId('interrupt-button')).toBeInTheDocument();
    expect(screen.queryByTestId('send-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('message-input')).toHaveAttribute(
      'placeholder',
      'Claude is thinking…',
    );
  });

  test('typing and clicking send fires onSend with the trimmed text', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput running={false} onSend={onSend} onInterrupt={() => {}} />);

    await user.type(screen.getByTestId('message-input'), '  hi  ');
    await user.click(screen.getByTestId('send-button'));

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  test('clicking stop fires onInterrupt', () => {
    const onInterrupt = vi.fn();
    render(<ChatInput running={true} onSend={() => {}} onInterrupt={onInterrupt} />);

    fireEvent.click(screen.getByTestId('interrupt-button'));

    expect(onInterrupt).toHaveBeenCalledOnce();
  });
});
