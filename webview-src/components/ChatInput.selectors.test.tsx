import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const postMessage = vi.fn();
vi.mock('../lib/ipc', () => ({ postMessage: (m: unknown) => postMessage(m) }));

import { ChatInput } from './ChatInput';
import { ExtensionContext, useExtensionReducer, type ExtensionState } from '../store/extensionStore';

function Harness({ stateOverride }: { stateOverride?: Partial<ExtensionState> } = {}) {
  const ext = useExtensionReducer();
  const value = stateOverride ? { ...ext, state: { ...ext.state, ...stateOverride } } : ext;
  return (
    <ExtensionContext.Provider value={value}>
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
    // Bare alias "Sonnet" has hint "claude-sonnet-5" concatenated without whitespace
    // (spans are adjacent in the DOM), yielding accessible name "Sonnetclaude-sonnet-5".
    fireEvent.click(screen.getByRole('menuitem', { name: /Sonnetclaude-sonnet-5/ }));

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

describe('ChatInput model picker — options', () => {
  test('all 10 base model options are present in the picker', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('model-selector'));

    // Verify total count first so regressions (additions or removals) fail loudly.
    expect(screen.getAllByRole('menuitem')).toHaveLength(10);

    // cc-menu__check renders "✓" for the selected item, so use regex (substring)
    // rather than exact strings to avoid accessible-name prefix mismatches.
    // Versioned items have unambiguous labels.
    for (const label of ['Default', 'Fable 5', 'Opus 5', 'Sonnet 5', 'Opus 4\\.8', 'Sonnet 4\\.6', 'Haiku 4\\.5']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
    // Bare aliases: spans are adjacent (no whitespace) so accessible name is label+hint
    // concatenated: "Opusclaude-opus-5", "Sonnetclaude-sonnet-5", "Haikuclaude-haiku-4-5".
    expect(screen.getByRole('menuitem', { name: /Opusclaude/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Sonnetclaude/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Haikuclaude/ })).toBeInTheDocument();
  });

  test('customModels from state appear as extra options below the base list', () => {
    render(<Harness stateOverride={{ customModels: ['claude-opus-4-7'] }} />);
    fireEvent.click(screen.getByTestId('model-selector'));
    expect(screen.getByRole('menuitem', { name: /claude-opus-4-7/ })).toBeInTheDocument();
  });

  test('selecting a versioned model posts its full model ID (not a bare alias)', () => {
    postMessage.mockClear();
    render(<Harness />);
    fireEvent.click(screen.getByTestId('model-selector'));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Opus 5$/ }));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'set_model',
      model: 'claude-opus-5',
      channelId: 'ch1',
    });
  });
});
