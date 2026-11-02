import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockInspect, mockUpdate, mockOnDidChangeConfiguration, mockReadFileSync } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockInspect = vi.fn();
  const mockUpdate = vi.fn(async () => undefined);
  const mockOnDidChangeConfiguration = vi.fn(() => ({ dispose: vi.fn() }));
  const mockReadFileSync = vi.fn();
  return { mockGet, mockInspect, mockUpdate, mockOnDidChangeConfiguration, mockReadFileSync };
});

vi.mock('fs', () => ({ readFileSync: mockReadFileSync }));

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: {
    getConfiguration: vi.fn((section: string) => ({
      get: (key: string, fallback?: unknown) => mockGet(`${section}.${key}`, fallback),
      inspect: (key: string) => mockInspect(`${section}.${key}`),
      update: (key: string, value: unknown, target: unknown) => mockUpdate(`${section}.${key}`, value, target),
    })),
    onDidChangeConfiguration: mockOnDidChangeConfiguration,
  },
}));

function stubConfig(
  values: Record<string, unknown>,
  explicitDefault?: Record<string, unknown>,
  workspaceOnly: Record<string, unknown> = {},
): void {
  const effective = { ...values, ...workspaceOnly };
  mockGet.mockImplementation((key: string, fallback?: unknown) => (key in effective ? effective[key] : fallback));
  mockInspect.mockImplementation((key: string) => {
    if (explicitDefault?.[key]) return explicitDefault[key];
    if (key in workspaceOnly) return { workspaceValue: workspaceOnly[key] };
    if (key in values) return { defaultValue: values[key] };
    return undefined;
  });
}

import { ExtensionSettings } from '../../../src/settings/ExtensionSettings';

describe('ExtensionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
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
      if (key === 'claudeCode.useTerminal') return true;
      if (key === 'claudeCode.preferredLocation') return 'sidebar';
      if (key === 'claudeCode.initialPermissionMode') return 'acceptEdits';
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
        { 'clawdCode.defaultPermissionMode': 'auto', 'claudeCode.initialPermissionMode': 'plan' },
        { 'clawdCode.defaultPermissionMode': { globalValue: 'auto' } },
      );
      expect(new ExtensionSettings().getDefaultPermissionMode()).toBe('auto');
    });

    it('falls through to claudeCode.initialPermissionMode when clawdCode value is unset', () => {
      stubConfig({ 'clawdCode.defaultPermissionMode': 'auto', 'claudeCode.initialPermissionMode': 'plan' });
      expect(new ExtensionSettings().getDefaultPermissionMode()).toBe('plan');
    });

    it('ignores a workspaceFolderValue-only inspect result, since setDefaultPermissionMode never writes there', () => {
      stubConfig(
        { 'clawdCode.defaultPermissionMode': 'auto', 'claudeCode.initialPermissionMode': 'plan' },
        { 'clawdCode.defaultPermissionMode': { workspaceFolderValue: 'auto' } },
      );
      expect(new ExtensionSettings().getDefaultPermissionMode()).toBe('plan');
    });
  });

  describe('getExitPlanApproveMode', () => {
    it('returns auto by default and for an invalid value', () => {
      stubConfig({});
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
      stubConfig({ 'clawdCode.exitPlanModeFallback': 'turbo' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
      stubConfig({ 'clawdCode.exitPlanModeFallback': 'plan' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
    });

    it('returns a valid configured value', () => {
      stubConfig({ 'clawdCode.exitPlanModeFallback': 'bypassPermissions' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('bypassPermissions');
    });
  });

  describe('workspace-scoped values', () => {
    it('ignores a workspace-only exitPlanModeFallback but honors a user-level one', () => {
      stubConfig({}, undefined, { 'clawdCode.exitPlanModeFallback': 'bypassPermissions' });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('auto');
      stubConfig({}, { 'clawdCode.exitPlanModeFallback': { globalValue: 'acceptEdits', workspaceValue: 'bypassPermissions' } });
      expect(new ExtensionSettings().getExitPlanApproveMode()).toBe('acceptEdits');
    });

    it('ignores a workspace-only offerDefaultModeAfterPlan but honors a user-level one', () => {
      stubConfig({}, undefined, { 'clawdCode.offerDefaultModeAfterPlan': 'off' });
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('auto');
      stubConfig({}, { 'clawdCode.offerDefaultModeAfterPlan': { globalValue: 'off' } });
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('off');
    });

    it('does not let workspace settings grant the bypass flag', () => {
      const workspaceGrants: Array<Record<string, unknown>> = [
        { 'claudeCode.allowDangerouslySkipPermissions': true },
        { 'clawdCode.allowDangerouslySkipPermissions': true },
        { 'clawdCode.exitPlanModeFallback': 'bypassPermissions' },
        { 'clawdCode.offerDefaultModeAfterPlan': 'bypassPermissions' },
        { 'clawdCode.defaultPermissionMode': 'bypassPermissions' },
        { 'claudeCode.initialPermissionMode': 'bypassPermissions' },
      ];
      for (const grant of workspaceGrants) {
        stubConfig({}, undefined, grant);
        expect(new ExtensionSettings().shouldAllowBypass()).toBe(false);
      }
    });

    it('honors user-level consent for the flag', () => {
      stubConfig({}, { 'claudeCode.allowDangerouslySkipPermissions': { globalValue: true } });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      stubConfig({}, { 'clawdCode.allowDangerouslySkipPermissions': { globalValue: true } });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      stubConfig({}, { 'clawdCode.exitPlanModeFallback': { globalValue: 'bypassPermissions' } });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      stubConfig({}, { 'clawdCode.offerDefaultModeAfterPlan': { globalValue: 'bypassPermissions' } });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      stubConfig({}, { 'clawdCode.defaultPermissionMode': { globalValue: 'bypassPermissions' } });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      stubConfig({}, { 'claudeCode.initialPermissionMode': { globalValue: 'bypassPermissions' } });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
    });
  });

  describe('getOfferDefaultMode', () => {
    it('returns off when configured off, auto by default, auto for an invalid value', () => {
      stubConfig({ 'clawdCode.offerDefaultModeAfterPlan': 'off' });
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('off');
      stubConfig({});
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('auto');
      stubConfig({ 'clawdCode.offerDefaultModeAfterPlan': 'turbo' });
      expect(new ExtensionSettings().getOfferDefaultMode()).toBe('auto');
    });
  });

  describe('shouldAllowBypass', () => {
    it('is true for each trigger in the spec and false when none applies', () => {
      const bypassTriggers: Array<Record<string, unknown>> = [
        { 'clawdCode.allowDangerouslySkipPermissions': true },
        { 'claudeCode.allowDangerouslySkipPermissions': true },
        { 'clawdCode.exitPlanModeFallback': 'bypassPermissions' },
        { 'clawdCode.offerDefaultModeAfterPlan': 'bypassPermissions' },
        { 'clawdCode.defaultPermissionMode': 'bypassPermissions' },
      ];
      for (const values of bypassTriggers) {
        const explicit = values['clawdCode.defaultPermissionMode'] ? { 'clawdCode.defaultPermissionMode': { globalValue: 'bypassPermissions' } } : undefined;
        stubConfig(values, explicit);
        expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      }
      stubConfig({});
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(false);
    });

    it('reads claudeCode.allowDangerouslySkipPermissions from its own section while clawdCode is unset', () => {
      stubConfig({ 'claudeCode.allowDangerouslySkipPermissions': true });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
      stubConfig({ 'claudeCode.exitPlanModeFallback': 'bypassPermissions' });
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(false);
    });

    it('is true when ~/.claude/settings.json defaultMode is bypassPermissions', () => {
      stubConfig({});
      mockReadFileSync.mockReturnValue('{"defaultMode":"bypassPermissions"}');
      expect(new ExtensionSettings().shouldAllowBypass()).toBe(true);
    });
  });

  describe.each([
    ['attachOpenFile', 'getAttachOpenFile'],
    ['attachSelection', 'getAttachSelection'],
    ['respectGitIgnore', 'getRespectGitIgnore'],
  ] as const)('%s', (key, getter) => {
    it('defaults to true', () => {
      stubConfig({});
      expect(new ExtensionSettings()[getter]()).toBe(true);
    });

    it('falls back to the claudeCode value when the clawdCode key is unset', () => {
      stubConfig({ [`claudeCode.${key}`]: false });
      expect(new ExtensionSettings()[getter]()).toBe(false);
    });

    it('prefers an explicit clawdCode value over claudeCode', () => {
      stubConfig(
        { [`claudeCode.${key}`]: false, [`clawdCode.${key}`]: true },
        { [`clawdCode.${key}`]: { globalValue: true } },
      );
      expect(new ExtensionSettings()[getter]()).toBe(true);
    });

    it('honors an explicit workspace-level clawdCode value', () => {
      stubConfig({ [`claudeCode.${key}`]: true }, { [`clawdCode.${key}`]: { workspaceValue: false } });
      expect(new ExtensionSettings()[getter]()).toBe(false);
    });
  });

  describe('setDefaultPermissionMode', () => {
    it('writes to workspace scope when a workspace value exists', async () => {
      stubConfig({}, { 'clawdCode.defaultPermissionMode': { workspaceValue: 'plan' } });
      await new ExtensionSettings().setDefaultPermissionMode('auto');
      expect(mockUpdate).toHaveBeenCalledWith('clawdCode.defaultPermissionMode', 'auto', 2);
    });

    it('never targets the workspace-folder scope, which needs a resource to write', async () => {
      stubConfig({}, { 'clawdCode.defaultPermissionMode': { workspaceFolderValue: 'plan', workspaceValue: 'plan' } });
      await new ExtensionSettings().setDefaultPermissionMode('auto');
      expect(mockUpdate).toHaveBeenCalledWith('clawdCode.defaultPermissionMode', 'auto', 2);
    });

    it('writes to global scope otherwise', async () => {
      stubConfig({}, { 'clawdCode.defaultPermissionMode': { globalValue: 'plan' } });
      await new ExtensionSettings().setDefaultPermissionMode('auto');
      expect(mockUpdate).toHaveBeenCalledWith('clawdCode.defaultPermissionMode', 'auto', 1);
    });
  });
});
