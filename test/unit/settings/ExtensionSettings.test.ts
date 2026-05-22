import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockOnDidChangeConfiguration } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockOnDidChangeConfiguration = vi.fn(() => ({ dispose: vi.fn() }));
  return { mockGet, mockOnDidChangeConfiguration };
});

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: mockGet })),
    onDidChangeConfiguration: mockOnDidChangeConfiguration,
  },
}));

import { ExtensionSettings } from '../../../src/settings/ExtensionSettings';

describe('ExtensionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return the second arg (defaultValue) for every get() call
    mockGet.mockImplementation((_key: string, defaultValue: unknown) => defaultValue);
  });

  it('read() returns all 14 settings with correct defaults', () => {
    const settings = new ExtensionSettings();
    const values = settings.read();

    expect(values.environmentVariables).toEqual([]);
    expect(values.useTerminal).toBe(false);
    expect(values.allowDangerouslySkipPermissions).toBe(false);
    expect(values.claudeProcessWrapper).toBeUndefined();
    expect(values.respectGitIgnore).toBe(true);
    expect(values.initialPermissionMode).toBe('default');
    expect(values.disableLoginPrompt).toBe(false);
    expect(values.autosave).toBe(true);
    expect(values.useCtrlEnterToSend).toBe(false);
    expect(values.preferredLocation).toBe('panel');
    expect(values.enableNewConversationShortcut).toBe(false);
    expect(values.enableReopenClosedSessionShortcut).toBe(true);
    expect(values.hideOnboarding).toBe(false);
    expect(values.usePythonEnvironment).toBe(true);
  });

  it('read() returns configured values when present', () => {
    mockGet.mockImplementation((key: string) => {
      if (key === 'useTerminal') return true;
      if (key === 'preferredLocation') return 'sidebar';
      if (key === 'initialPermissionMode') return 'acceptEdits';
      return undefined;
    });

    const values = new ExtensionSettings().read();
    expect(values.useTerminal).toBe(true);
    expect(values.preferredLocation).toBe('sidebar');
    expect(values.initialPermissionMode).toBe('acceptEdits');
  });

  it('onChange() fires when claudeCode config changes', () => {
    const handler = vi.fn();
    const settings = new ExtensionSettings();
    settings.onChange(handler);

    expect(mockOnDidChangeConfiguration).toHaveBeenCalledOnce();
    // Simulate the callback being invoked with a matching affectsConfiguration
    const [callback] = mockOnDidChangeConfiguration.mock.calls[0] as [(e: { affectsConfiguration(s: string): boolean }) => void];
    callback({ affectsConfiguration: (s: string) => s === 'claudeCode' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('onChange() does not fire for unrelated config sections', () => {
    const handler = vi.fn();
    new ExtensionSettings().onChange(handler);
    const [callback] = mockOnDidChangeConfiguration.mock.calls[0] as [(e: { affectsConfiguration(s: string): boolean }) => void];
    callback({ affectsConfiguration: () => false });
    expect(handler).not.toHaveBeenCalled();
  });
});
