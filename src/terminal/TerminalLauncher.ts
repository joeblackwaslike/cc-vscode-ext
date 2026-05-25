import * as vscode from 'vscode';
import { resolveBinaryPath } from '../utils/platform';

/**
 * Opens the claude CLI in a VS Code integrated terminal.
 *
 * Used by the `claude-vscode.terminal.open` command and by the `open_terminal`
 * and `open_claude_in_terminal` IPC messages.
 */
export class TerminalLauncher {
  constructor(private readonly extensionPath: string) {}

  /** Open an integrated terminal with the claude CLI running. */
  openClaudeTerminal(cwd?: string): vscode.Terminal {
    const binaryPath = resolveBinaryPath(this.extensionPath);
    const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'Claude Code',
      ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
    });
    terminal.sendText(binaryPath);
    terminal.show();
    return terminal;
  }

  /** Open a plain integrated terminal without running claude. */
  openTerminal(cwd?: string): vscode.Terminal {
    const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'Claude Code Terminal',
      ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
    });
    terminal.show();
    return terminal;
  }
}
