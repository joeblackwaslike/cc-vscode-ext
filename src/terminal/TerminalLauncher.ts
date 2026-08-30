import * as vscode from 'vscode';

/**
 * Quote a filesystem path so a shell runs it as a single command. The
 * first-run download lives in VS Code global storage, which on macOS contains
 * a space (`Application Support`); sending it raw to `terminal.sendText` would
 * split it on the space and fail to launch.
 */
export function shellQuote(path: string): string {
  if (process.platform === 'win32') {
    // PowerShell/cmd: wrap in double quotes and invoke via the call operator so
    // a quoted path is executed rather than printed.
    return `& "${path.replace(/"/g, '""')}"`;
  }
  // POSIX single-quote escaping: ' → '\'' — safe for spaces and metacharacters.
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/**
 * Opens the claude CLI in a VS Code integrated terminal.
 *
 * Used by the `clawd-vscode.terminal.open` command and by the `open_terminal`
 * and `open_claude_in_terminal` IPC messages.
 */
export class TerminalLauncher {
  constructor(private readonly binaryProvider: () => Promise<string>) {}

  /** Open an integrated terminal with the claude CLI running. */
  async openClaudeTerminal(cwd?: string): Promise<vscode.Terminal> {
    const binaryPath = await this.binaryProvider();
    const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'Clawd Code',
      ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
    });
    terminal.sendText(shellQuote(binaryPath));
    terminal.show();
    return terminal;
  }

  /** Open a plain integrated terminal without running claude. */
  openTerminal(cwd?: string): vscode.Terminal {
    const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'Clawd Code Terminal',
      ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
    });
    terminal.show();
    return terminal;
  }
}
