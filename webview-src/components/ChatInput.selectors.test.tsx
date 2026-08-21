import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const postMessage = vi.fn();
vi.mock('../lib/ipc', () => ({ postMessage: (m: unknown) => postMessage(m) }));

import { ChatInput } from './ChatInput';
import { ExtensionContext, useExtensionReducer } from '../store/extensionStore';

function Harness() {
  const ext = useExtensionReducer();
  return (
    <ExtensionContext.Provider value={ext}>
      <ChatInput channelId="ch1" running={false} onSend={() => {}} onInterrupt={() => {}} onCompact={() => {}} />
    </ExtensionContext.Provider>
  );
}

describe('ChatInput selectors — live + optimistic', () => {
  test('choosing a model updates the pill instantly and posts set_model with channelId', () => {
    postMessage.mockClear();
    render(<Harness />);

    const trigger = screen.getByTestId('model-selector');
    expect(trigger).toHaveTextContent('Default');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Sonnet/ }));

    // Optimistic: pill reflects the choice before any host echo.
    expect(screen.getByTestId('model-selector')).toHaveTextContent('Sonnet');
    // And the live control message carries the channelId.
    expect(postMessage).toHaveBeenCalledWith({ type: 'set_model', model: 'sonnet', channelId: 'ch1' });
  });

  test('choosing an effort posts set_thinking_level with channelId', () => {
    postMessage.mockClear();
    render(<Harness />);

    fireEvent.click(screen.getByTestId('effort-selector'));
    fireEvent.click(screen.getByRole('menuitem', { name: /High/ }));

    expect(screen.getByTestId('effort-selector')).toHaveTextContent('High');
    expect(postMessage).toHaveBeenCalledWith({ type: 'set_thinking_level', level: 'high', channelId: 'ch1' });
  });

  test('clicking the Focus View toolbar toggle posts toggle_focus_view and optimistically flips the active state', () => {
    postMessage.mockClear();
    render(<Harness />);

    const toggle = screen.getByTestId('focus-view-toggle');
    expect(toggle.className).not.toContain('cc-tbtn--active');

    fireEvent.click(toggle);

    // Optimistic: the toolbar button reflects the new state before any host echo.
    expect(toggle.className).toContain('cc-tbtn--active');
    // And the live control message is posted so the host's ViewManager converges every webview.
    expect(postMessage).toHaveBeenCalledWith({ type: 'toggle_focus_view' });
  });
});
