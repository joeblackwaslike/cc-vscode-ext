import { act, render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ChatInput } from './ChatInput';
import { ExtensionContext, useExtensionReducer } from '../store/extensionStore';
import type { IdeContext } from '../lib/ipc';

function renderWithContext(onSend: (text: string, context?: IdeContext) => void) {
  let push: (context: IdeContext | null) => void = () => {};
  function Harness() {
    const ext = useExtensionReducer();
    push = (context) => ext.handleMessage({ type: 'ide_context', context });
    return (
      <ExtensionContext.Provider value={ext}>
        <ChatInput channelId="ch1" running={false} onSend={onSend} onInterrupt={() => {}} onCompact={() => {}} />
      </ExtensionContext.Provider>
    );
  }
  render(<Harness />);
  return { setContext: (context: IdeContext | null) => act(() => push(context)) };
}

async function send(text = 'go') {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('message-input'), text);
  await user.click(screen.getByTestId('send-button'));
}

const removeButton = (label: string) => screen.getByRole('button', { name: `Remove ${label} from context` });

describe('ChatInput context chips', () => {
  test('chips render from the ide_context in the store', () => {
    const { setContext } = renderWithContext(() => {});
    setContext({ filePath: '/repo/a.ts' });
    expect(screen.getByTestId('context-chip-file')).toHaveTextContent('a.ts');

    setContext({ filePath: '/repo/a.ts', selection: { startLine: 2, endLine: 4, text: 'x' } });
    expect(screen.getByTestId('context-chip-selection')).toHaveTextContent('a.ts:2-4');
  });

  test('a null context (both settings off) renders no chips and sends no context', async () => {
    const onSend = vi.fn();
    const { setContext } = renderWithContext(onSend);
    setContext(null);

    expect(screen.queryByTestId('context-chip-file')).not.toBeInTheDocument();
    expect(screen.queryByTestId('context-chip-selection')).not.toBeInTheDocument();
    await send('hi');
    expect(onSend).toHaveBeenCalledWith('hi', undefined);
  });

  test('send carries the visible file chip', async () => {
    const onSend = vi.fn();
    const { setContext } = renderWithContext(onSend);
    setContext({ filePath: '/repo/a.ts' });

    await send('hi');
    expect(onSend).toHaveBeenCalledWith('hi', { filePath: '/repo/a.ts' });
  });

  test('send carries the visible selection chip, keeping a withheld selection without text', async () => {
    const onSend = vi.fn();
    const { setContext } = renderWithContext(onSend);
    setContext({ filePath: '/repo/.env', selection: { startLine: 1, endLine: 2 } });

    await send('hi');
    expect(onSend).toHaveBeenCalledWith('hi', { filePath: '/repo/.env', selection: { startLine: 1, endLine: 2 } });
    expect(onSend.mock.calls[0]![1].selection).not.toHaveProperty('text');
  });

  test('removing the file chip hides it and drops it from the send', async () => {
    const onSend = vi.fn();
    const { setContext } = renderWithContext(onSend);
    setContext({ filePath: '/repo/a.ts' });

    fireEvent.click(removeButton('a.ts'));
    expect(screen.queryByTestId('context-chip-file')).not.toBeInTheDocument();
    await send('hi');
    expect(onSend).toHaveBeenCalledWith('hi', undefined);
  });

  test('removing the selection chip drops the selection from the send', async () => {
    const onSend = vi.fn();
    const { setContext } = renderWithContext(onSend);
    setContext({ filePath: '/repo/a.ts', selection: { startLine: 2, endLine: 4, text: 'x' } });

    fireEvent.click(removeButton('a.ts:2-4'));
    expect(screen.queryByTestId('context-chip-selection')).not.toBeInTheDocument();
    await send('hi');
    expect(onSend).toHaveBeenCalledWith('hi', undefined);
  });

  test('a text-only change to the selection keeps it dismissed', () => {
    const { setContext } = renderWithContext(() => {});
    setContext({ filePath: '/repo/a.ts', selection: { startLine: 2, endLine: 4, text: 'x' } });
    fireEvent.click(removeButton('a.ts:2-4'));

    setContext({ filePath: '/repo/a.ts', selection: { startLine: 2, endLine: 4, text: 'y' } });
    expect(screen.queryByTestId('context-chip-selection')).not.toBeInTheDocument();
  });

  test('a new line range restores a dismissed selection chip', () => {
    const { setContext } = renderWithContext(() => {});
    setContext({ filePath: '/repo/a.ts', selection: { startLine: 2, endLine: 4, text: 'x' } });
    fireEvent.click(removeButton('a.ts:2-4'));

    setContext({ filePath: '/repo/a.ts', selection: { startLine: 2, endLine: 5, text: 'x' } });
    expect(screen.getByTestId('context-chip-selection')).toHaveTextContent('a.ts:2-5');
  });

  test('a different file restores the chip, and so does switching back', () => {
    const { setContext } = renderWithContext(() => {});
    setContext({ filePath: '/repo/a.ts' });
    fireEvent.click(removeButton('a.ts'));

    setContext({ filePath: '/repo/b.ts' });
    expect(screen.getByTestId('context-chip-file')).toHaveTextContent('b.ts');
    setContext({ filePath: '/repo/a.ts' });
    expect(screen.getByTestId('context-chip-file')).toHaveTextContent('a.ts');
  });

  test('closing the file then reopening it restores the chip', () => {
    const { setContext } = renderWithContext(() => {});
    setContext({ filePath: '/repo/a.ts' });
    fireEvent.click(removeButton('a.ts'));

    setContext(null);
    setContext({ filePath: '/repo/a.ts' });
    expect(screen.getByTestId('context-chip-file')).toHaveTextContent('a.ts');
  });
});

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
    expect(onSend).toHaveBeenCalledWith('hi', undefined);
  });

  test('clicking stop fires onInterrupt', () => {
    const onInterrupt = vi.fn();
    render(<ChatInput running={true} onSend={() => {}} onInterrupt={onInterrupt} />);

    fireEvent.click(screen.getByTestId('interrupt-button'));

    expect(onInterrupt).toHaveBeenCalledOnce();
  });
});
