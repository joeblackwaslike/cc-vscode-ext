import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ApproveMode, PermissionMode } from '../process/ProcessArgs';

const PERMISSION_MODES: readonly PermissionMode[] = ['auto', 'default', 'plan', 'acceptEdits', 'bypassPermissions'];

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

  private getUserLevel<T>(section: string, key: string): T | undefined {
    const inspected = vscode.workspace.getConfiguration(section).inspect<T>(key);
    return inspected?.globalValue ?? inspected?.defaultValue;
  }

  /**
   * Resolves the default permission mode to use for new conversations.
   * Priority: clawdCode VS Code setting → claudeCode VS Code setting (official ext) → ~/.claude/settings.json → 'auto'
   */
  getDefaultPermissionMode(): PermissionMode {
    return this.resolveDefaultPermissionMode(false);
  }

  private resolveDefaultPermissionMode(userLevelOnly: boolean): PermissionMode {
    const ownCfg = vscode.workspace.getConfiguration('clawdCode');
    const configured = userLevelOnly
      ? this.getUserLevel<string>('clawdCode', 'defaultPermissionMode')
      : ownCfg.get<string>('defaultPermissionMode');
    const inspected = ownCfg.inspect<string>('defaultPermissionMode');
    const isExplicit =
      inspected?.globalValue !== undefined || (!userLevelOnly && inspected?.workspaceValue !== undefined);
    if (configured && (isExplicit || configured !== 'auto') && PERMISSION_MODES.includes(configured as PermissionMode)) {
      return configured as PermissionMode;
    }
    // Fallback: official Claude Code extension's VS Code setting
    const officialMode = userLevelOnly
      ? this.getUserLevel<string>('claudeCode', 'initialPermissionMode')
      : vscode.workspace.getConfiguration('claudeCode').get<string>('initialPermissionMode');
    if (officialMode && officialMode !== 'default' && PERMISSION_MODES.includes(officialMode as PermissionMode)) {
      return officialMode as PermissionMode;
    }
    // Fallback: ~/.claude/settings.json → defaultMode (top-level field)
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as { defaultMode?: string };
      const mode = parsed.defaultMode;
      if (mode && PERMISSION_MODES.includes(mode as PermissionMode)) {
        return mode as PermissionMode;
      }
    } catch { /* file absent or unreadable */ }
    return 'auto';
  }

  /** Mode a plan approval switches into, from the user-level `clawdCode.exitPlanModeFallback`. Invalid values yield `auto`. */
  getExitPlanApproveMode(): ApproveMode {
    const raw = this.getUserLevel<string>('clawdCode', 'exitPlanModeFallback');
    return pickEnum(raw, APPROVE_MODES, 'auto');
  }

  /** Mode offered as the new default after a plan approval, or `off`, from the user-level setting. Invalid values yield `auto`. */
  getOfferDefaultMode(): ApproveMode | 'off' {
    const raw = this.getUserLevel<string>('clawdCode', 'offerDefaultModeAfterPlan');
    return pickEnum<ApproveMode | 'off'>(raw, [...APPROVE_MODES, 'off'], 'auto');
  }

  /** Whether the CLI must be launched with `--allow-dangerously-skip-permissions`. Only user-level consent counts; workspace settings cannot grant it. */
  shouldAllowBypass(): boolean {
    return (
      this.getUserLevel<boolean>('clawdCode', 'allowDangerouslySkipPermissions') === true ||
      this.getUserLevel<boolean>('claudeCode', 'allowDangerouslySkipPermissions') === true ||
      this.getExitPlanApproveMode() === 'bypassPermissions' ||
      this.getOfferDefaultMode() === 'bypassPermissions' ||
      this.resolveDefaultPermissionMode(true) === 'bypassPermissions'
    );
  }

  /** Writes `clawdCode.defaultPermissionMode` to workspace settings when the workspace already holds a value, else to user settings. */
  async setDefaultPermissionMode(mode: PermissionMode): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('clawdCode');
    const inspected = cfg.inspect<string>('defaultPermissionMode');
    const target = inspected?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
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
