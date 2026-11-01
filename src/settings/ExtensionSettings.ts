import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { PermissionMode } from '../process/ProcessArgs';

const PERMISSION_MODES: readonly PermissionMode[] = ['auto', 'default', 'plan', 'acceptEdits', 'bypassPermissions'];

/** Permission modes a plan approval can switch into. */
export type ApproveMode = Exclude<PermissionMode, 'plan'>;

const APPROVE_MODES: readonly ApproveMode[] = ['auto', 'default', 'acceptEdits', 'bypassPermissions'];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Shape of a single `claudeCode.environmentVariables` entry. */
export interface ConfigEnvVar {
  name: string;
  value: string;
}

/** All settings under the `claudeCode` VS Code configuration namespace. */
export interface ExtensionSettingsValues {
  environmentVariables: ConfigEnvVar[];
  useTerminal: boolean;
  allowDangerouslySkipPermissions: boolean;
  claudeProcessWrapper: string | undefined;
  respectGitIgnore: boolean;
  initialPermissionMode: PermissionMode;
  disableLoginPrompt: boolean;
  autosave: boolean;
  useCtrlEnterToSend: boolean;
  preferredLocation: 'sidebar' | 'panel';
  enableNewConversationShortcut: boolean;
  enableReopenClosedSessionShortcut: boolean;
  hideOnboarding: boolean;
  usePythonEnvironment: boolean;
}

/** Typed wrapper around `vscode.workspace.getConfiguration('claudeCode')`. */
export class ExtensionSettings {
  read(): ExtensionSettingsValues {
    const cfg = vscode.workspace.getConfiguration('claudeCode');
    return {
      environmentVariables: cfg.get<ConfigEnvVar[]>('environmentVariables', []),
      useTerminal: cfg.get<boolean>('useTerminal', false),
      allowDangerouslySkipPermissions: cfg.get<boolean>('allowDangerouslySkipPermissions', false),
      claudeProcessWrapper: cfg.get<string | undefined>('claudeProcessWrapper', undefined),
      respectGitIgnore: cfg.get<boolean>('respectGitIgnore', true),
      initialPermissionMode: cfg.get<PermissionMode>('initialPermissionMode', 'default'),
      disableLoginPrompt: cfg.get<boolean>('disableLoginPrompt', false),
      autosave: cfg.get<boolean>('autosave', true),
      useCtrlEnterToSend: cfg.get<boolean>('useCtrlEnterToSend', false),
      preferredLocation: cfg.get<'sidebar' | 'panel'>('preferredLocation', 'panel'),
      enableNewConversationShortcut: cfg.get<boolean>('enableNewConversationShortcut', false),
      enableReopenClosedSessionShortcut: cfg.get<boolean>('enableReopenClosedSessionShortcut', true),
      hideOnboarding: cfg.get<boolean>('hideOnboarding', false),
      usePythonEnvironment: cfg.get<boolean>('usePythonEnvironment', true),
    };
  }

  /**
   * Resolves the default permission mode to use for new conversations.
   * Priority: clawdCode VS Code setting → claudeCode VS Code setting (official ext) → ~/.claude/settings.json → 'auto'
   */
  getDefaultPermissionMode(): PermissionMode {
    const validModes = PERMISSION_MODES;
    const ownCfg = vscode.workspace.getConfiguration('clawdCode');
    const configured = ownCfg.get<string>('defaultPermissionMode');
    const inspected = ownCfg.inspect<string>('defaultPermissionMode');
    const isExplicit =
      inspected?.globalValue !== undefined ||
      inspected?.workspaceValue !== undefined ||
      inspected?.workspaceFolderValue !== undefined;
    if (configured && (isExplicit || configured !== 'auto') && validModes.includes(configured as PermissionMode)) {
      return configured as PermissionMode;
    }
    // Fallback: official Claude Code extension's VS Code setting
    const officialCfg = vscode.workspace.getConfiguration('claudeCode');
    const officialMode = officialCfg.get<string>('initialPermissionMode');
    if (officialMode && officialMode !== 'default' && validModes.includes(officialMode as PermissionMode)) {
      return officialMode as PermissionMode;
    }
    // Fallback: ~/.claude/settings.json → defaultMode (top-level field)
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as { defaultMode?: string };
      const mode = parsed.defaultMode;
      if (mode && validModes.includes(mode as PermissionMode)) {
        return mode as PermissionMode;
      }
    } catch { /* file absent or unreadable */ }
    return 'auto';
  }

  /** Mode a plan approval switches into, from `clawdCode.exitPlanModeFallback`. Invalid values yield `auto`. */
  getExitPlanApproveMode(): ApproveMode {
    const raw = vscode.workspace.getConfiguration('clawdCode').get<string>('exitPlanModeFallback');
    return pickEnum(raw, APPROVE_MODES, 'auto');
  }

  /** Mode offered as the new default after a plan approval, or `off`. Invalid values yield `auto`. */
  getOfferDefaultMode(): ApproveMode | 'off' {
    const raw = vscode.workspace.getConfiguration('clawdCode').get<string>('offerDefaultModeAfterPlan');
    return pickEnum<ApproveMode | 'off'>(raw, [...APPROVE_MODES, 'off'], 'auto');
  }

  /** Whether the CLI must be launched with `--allow-dangerously-skip-permissions`. */
  shouldAllowBypass(): boolean {
    const own = vscode.workspace.getConfiguration('clawdCode');
    const official = vscode.workspace.getConfiguration('claudeCode');
    return (
      own.get<boolean>('allowDangerouslySkipPermissions', false) === true ||
      official.get<boolean>('allowDangerouslySkipPermissions', false) === true ||
      this.getExitPlanApproveMode() === 'bypassPermissions' ||
      this.getOfferDefaultMode() === 'bypassPermissions' ||
      this.getDefaultPermissionMode() === 'bypassPermissions'
    );
  }

  /** Writes `clawdCode.defaultPermissionMode` in the narrowest scope that already holds a value, else global. */
  async setDefaultPermissionMode(mode: PermissionMode): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('clawdCode');
    const inspected = cfg.inspect<string>('defaultPermissionMode');
    let target = vscode.ConfigurationTarget.Global;
    if (inspected?.workspaceFolderValue !== undefined) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    } else if (inspected?.workspaceValue !== undefined) {
      target = vscode.ConfigurationTarget.Workspace;
    }
    await cfg.update('defaultPermissionMode', mode, target);
  }

  /** Reads the default model from ~/.claude/settings.json, or undefined if not set. */
  getDefaultModel(): string | undefined {
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as { model?: string };
      const model = parsed.model;
      if (model && typeof model === 'string') return model;
    } catch { /* file absent or unreadable */ }
    return undefined;
  }

  /** Subscribe to configuration changes. Returns a disposable. */
  onChange(handler: (settings: ExtensionSettingsValues) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCode')) {
        handler(this.read());
      }
    });
  }
}
