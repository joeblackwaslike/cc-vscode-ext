import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { SettingsWatcher } from '../../../src/settings/SettingsWatcher';

describe('SettingsWatcher', () => {
  const fakeSettings = { claudeProcessWrapper: undefined, apiKeyHelper: undefined };
  const mockSettings = {
    read: vi.fn(() => fakeSettings),
  };

  let changeListener: ((event: { affectsConfiguration(s: string): boolean }) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.read.mockReturnValue(fakeSettings);
    // Capture the listener passed to onDidChangeConfiguration
    mockVscode.workspace.onDidChangeConfiguration.mockImplementation(
      (listener: (event: { affectsConfiguration(s: string): boolean }) => void) => {
        changeListener = listener;
        return { dispose: vi.fn() };
      },
    );
    changeListener = undefined;
  });

  it('registers an onDidChangeConfiguration listener on construction', () => {
    new SettingsWatcher(mockSettings as never);
    expect(mockVscode.workspace.onDidChangeConfiguration).toHaveBeenCalledOnce();
  });

  it('calls onChange handlers when claudeCode config changes', () => {
    const handler = vi.fn();
    const watcher = new SettingsWatcher(mockSettings as never);
    watcher.onChange(handler);

    changeListener?.({ affectsConfiguration: (s: string) => s === 'claudeCode' });

    expect(handler).toHaveBeenCalledWith(fakeSettings);
  });

  it('does NOT call handlers when an unrelated config changes', () => {
    const handler = vi.fn();
    const watcher = new SettingsWatcher(mockSettings as never);
    watcher.onChange(handler);

    changeListener?.({ affectsConfiguration: () => false });

    expect(handler).not.toHaveBeenCalled();
  });

  it('calls multiple registered handlers', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const watcher = new SettingsWatcher(mockSettings as never);
    watcher.onChange(h1);
    watcher.onChange(h2);

    changeListener?.({ affectsConfiguration: () => true });

    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('dispose() calls the underlying disposable', () => {
    const mockDispose = vi.fn();
    mockVscode.workspace.onDidChangeConfiguration.mockReturnValue({ dispose: mockDispose });
    const watcher = new SettingsWatcher(mockSettings as never);
    watcher.dispose();
    expect(mockDispose).toHaveBeenCalled();
  });
});
