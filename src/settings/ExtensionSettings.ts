import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { PermissionMode } from '../process/ProcessArgs';

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
   * Priority: VS Code setting → ~/.claude/settings.json → 'auto'
   */
  getDefaultPermissionMode(): PermissionMode {
    const validModes: PermissionMode[] = ['auto', 'default', 'plan', 'acceptEdits', 'bypassPermissions'];
    const cfg = vscode.workspace.getConfiguration('clawdCode');
    const configured = cfg.get<string>('defaultPermissionMode');
    if (configured && configured !== 'auto' && validModes.includes(configured as PermissionMode)) {
      return configured as PermissionMode;
    }
    // Fallback: ~/.claude/settings.json → permissions.defaultMode
    try {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as { permissions?: { defaultMode?: string } };
      const mode = parsed.permissions?.defaultMode;
      if (mode && validModes.includes(mode as PermissionMode)) {
        return mode as PermissionMode;
      }
    } catch { /* file absent or unreadable */ }
    return 'auto';
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
