import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PermissionMode } from '../lib/ipc';
import { SessionContext, useSessionReducer } from '../store/sessionStore';

const postMessage = vi.fn();
vi.mock('../lib/ipc', () => ({ postMessage: (m: unknown) => postMessage(m) }));

import { ChatInput } from './ChatInput';
import {
  ExtensionContext,
  useExtensionReducer,
  type ExtensionState,
} from '../store/extensionStore';

function Harness({ stateOverride }: { stateOverride?: Partial<ExtensionState> } = {}) {
  const ext = useExtensionReducer();
  const value = stateOverride ? { ...ext, state: { ...ext.state, ...stateOverride } } : ext;
  return (
    <ExtensionContext.Provider value={value}>
      <ChatInput
        channelId="ch1"
        running={false}
        onSend={() => {}}
        onInterrupt={() => {}}
        onCompact={() => {}}
      />
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
    expect(postMessage).toHaveBeenCalledWith({
      type: 'set_model',
      model: 'sonnet',
      channelId: 'ch1',
    });
  });

  test('choosing an effort posts set_thinking_level with channelId', () => {
    postMessage.mockClear();
    render(<Harness />);

    fireEvent.click(screen.getByTestId('effort-selector'));
    fireEvent.click(screen.getByRole('menuitem', { name: /High/ }));

    expect(screen.getByTestId('effort-selector')).toHaveTextContent('High');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'set_thinking_level',
      level: 'high',
      channelId: 'ch1',
    });
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

describe('ChatInput mode picker — per-channel mode', () => {
  function ModeHarness({ channelMode }: { channelMode?: PermissionMode }) {
    const ext = useExtensionReducer();
    const sess = useSessionReducer();
    React.useEffect(() => {
      ext.dispatch({ type: 'SET_DEFAULTS', defaults: { defaultPermissionMode: 'plan' } });
      if (channelMode) sess.handleMessage({ type: 'channel_mode', channelId: 'ch1', mode: channelMode });
    }, []);
    return (
      <ExtensionContext.Provider value={ext}>
        <SessionContext.Provider value={sess}>
          <span data-testid="default-mode">{ext.state.defaultPermissionMode}</span>
          <ChatInput channelId="ch1" running={false} onSend={() => {}} onInterrupt={() => {}} onCompact={() => {}} />
        </SessionContext.Provider>
      </ExtensionContext.Provider>
    );
  }

  test("shows the channel's own mode instead of the new-conversation default", () => {
    render(<ModeHarness channelMode="bypassPermissions" />);
    expect(screen.getByTestId('mode-selector')).toHaveTextContent('Bypass permissions');
    expect(screen.getByTestId('default-mode')).toHaveTextContent('plan');
  });

  test('falls back to the default when the channel has no reported mode', () => {
    render(<ModeHarness />);
    expect(screen.getByTestId('mode-selector')).toHaveTextContent('Plan mode');
  });

  test('choosing a mode updates the picker and the default and posts set_permission_mode', () => {
    postMessage.mockClear();
    render(<ModeHarness channelMode="bypassPermissions" />);

    fireEvent.click(screen.getByTestId('mode-selector'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Accept edits/ }));

    expect(screen.getByTestId('mode-selector')).toHaveTextContent('Accept edits');
    expect(screen.getByTestId('default-mode')).toHaveTextContent('acceptEdits');
    expect(postMessage).toHaveBeenCalledWith({ type: 'set_permission_mode', channelId: 'ch1', mode: 'acceptEdits' });
  });
});

describe('ChatInput model picker — options', () => {
  test('all 11 base model options are present in the picker', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('model-selector'));

    // Verify total count first so regressions (additions or removals) fail loudly.
    expect(screen.getAllByRole('menuitem')).toHaveLength(11);

    // cc-menu__check renders "✓" for the selected item, so use regex (substring)
    // rather than exact strings to avoid accessible-name prefix mismatches.
    // Versioned items have unambiguous labels.
    for (const label of [
      'Default',
      'Fable 5\\.1',
      'Fable 5(?!\\.)',
      'Opus 5',
      'Sonnet 5',
      'Opus 4\\.8',
      'Sonnet 4\\.6',
      'Haiku 4\\.5',
    ]) {
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
