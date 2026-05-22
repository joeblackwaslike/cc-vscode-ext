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

  /** Subscribe to configuration changes. Returns a disposable. */
  onChange(handler: (settings: ExtensionSettingsValues) => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeCode')) {
        handler(this.read());
      }
    });
  }
}
