import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockInspect, mockUpdate, mockOnDidChangeConfiguration } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockInspect = vi.fn();
  const mockUpdate = vi.fn(async () => undefined);
  const mockOnDidChangeConfiguration = vi.fn(() => ({ dispose: vi.fn() }));
  return { mockGet, mockInspect, mockUpdate, mockOnDidChangeConfiguration };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: mockGet, inspect: mockInspect, update: mockUpdate })),
    onDidChangeConfiguration: mockOnDidChangeConfiguration,
  },
}));

function stubConfig(values: Record<string, unknown>, explicitDefault?: Record<string, unknown>): void {
  mockGet.mockImplementation((key: string, fallback?: unknown) => (key in values ? values[key] : fallback));
  mockInspect.mockImplementation((key: string) => explicitDefault?.[key] ?? undefined);
}

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

  describe('getDefaultPermissionMode', () => {
    it('returns auto when clawdCode.defaultPermissionMode is explicitly auto and claudeCode.initialPermissionMode is plan', () => {
      stubConfig(
        { defaultPermissionMode: 'auto', initialPermissionMode: 'plan' },
        { defaultPermissionMode: { globalValue: 'auto' } },
      );
      expect(new ExtensionSettings().getDefaultPermissionMode()).toBe('auto');
    });

    it('falls through to claudeCode.initialPermissionMode when clawdCode value is unset', () => {
      stubConfig({ defaultPermissionMode: 'auto', initialPermissionMode: 'plan' });
      expect(new ExtensionSettings().getDefaultPermissionMode()).toBe('plan');
    });
  });

  describe('getExitPlanApproveMode', () => {
    it('returns auto by default and for an invalid value', () => {
      stubConfig({});
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
      stubConfig({ exitPlanModeFallback: 'turbo' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
      stubConfig({ exitPlanModeFallback: 'plan' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
    });

    it('returns a valid configured value', () => {
      stubConfig({ exitPlanModeFallback: 'bypassPermissions' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('bypassPermissions');
    });
  });

  describe('getOfferDefaultMode', () => {
    it('returns off when configured off, auto by default, auto for an invalid value', () => {
      stubConfig({ offerDefaultModeAfterPlan: 'off' });
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('off');
      stubConfig({});
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('auto');
      stubConfig({ offerDefaultModeAfterPlan: 'turbo' });
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('auto');
    });
  });

  describe('shouldAllowBypass', () => {
    it('is true for each trigger in the spec and false when none applies', () => {
      const bypassTriggers: Array<Record<string, unknown>> = [
        { allowDangerouslySkipPermissions: true },
        { exitPlanModeFallback: 'bypassPermissions' },
        { offerDefaultModeAfterPlan: 'bypassPermissions' },
        { defaultPermissionMode: 'bypassPermissions' },
      ];
      for (const values of bypassTriggers) {
        stubConfig(values, values.defaultPermissionMode ? { defaultPermissionMode: { globalValue: 'bypassPermissions' } } : undefined);
        expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      }
      stubConfig({});
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(false);
    });
  });

  describe('setDefaultPermissionMode', () => {
    it('writes to workspace scope when a workspace value exists', async () => {
      stubConfig({}, { defaultPermissionMode: { workspaceValue: 'plan' } });
      await new ExtensionSettings().setDefaultPermissionMode('auto');
      expect(mockUpdate).toHaveBeenCalledWith('defaultPermissionMode', 'auto', 2);
    });

    it('writes to workspace folder scope when a folder value exists', async () => {
      stubConfig({}, { defaultPermissionMode: { workspaceFolderValue: 'plan', workspaceValue: 'plan' } });
      await new ExtensionSettings().setDefaultPermissionMode('auto');
      expect(mockUpdate).toHaveBeenCalledWith('defaultPermissionMode', 'auto', 3);
    });

    it('writes to global scope otherwise', async () => {
      stubConfig({}, { defaultPermissionMode: { globalValue: 'plan' } });
      await new ExtensionSettings().setDefaultPermissionMode('auto');
      expect(mockUpdate).toHaveBeenCalledWith('defaultPermissionMode', 'auto', 1);
    });
  });
});
