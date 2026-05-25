import * as vscode from 'vscode';
import type { ExtensionSettings } from './ExtensionSettings';

type SettingsChangeHandler = (settings: ReturnType<ExtensionSettings['read']>) => void;

/**
 * Watches for changes to claudeCode.* configuration and fires registered handlers.
 *
 * Wraps `workspace.onDidChangeConfiguration` with a section-scoped filter so
 * callers only receive notifications when the extension's own settings change.
 */
export class SettingsWatcher {
  private readonly disposable: vscode.Disposable;
  private readonly handlers: SettingsChangeHandler[] = [];

  constructor(private readonly settings: ExtensionSettings) {
    this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('claudeCode')) {
        const current = this.settings.read();
        for (const handler of this.handlers) {
          handler(current);
        }
      }
    });
  }

  /** Register a handler to call when claudeCode settings change. */
  onChange(handler: SettingsChangeHandler): void {
    this.handlers.push(handler);
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
