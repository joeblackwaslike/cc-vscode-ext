import * as vscode from 'vscode';

/**
 * Opens the claude CLI in a VS Code integrated terminal.
 *
 * Used by the `claw-vscode.terminal.open` command and by the `open_terminal`
 * and `open_claude_in_terminal` IPC messages.
 */
export class TerminalLauncher {
  constructor(private readonly binaryProvider: () => Promise<string>) {}

  /** Open an integrated terminal with the claude CLI running. */
  async openClaudeTerminal(cwd?: string): Promise<vscode.Terminal> {
    const binaryPath = await this.binaryProvider();
    const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: 'Claw Code',
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
      name: 'Claw Code Terminal',
      ...(resolvedCwd !== undefined ? { cwd: resolvedCwd } : {}),
    });
    terminal.show();
    return terminal;
  }
}
