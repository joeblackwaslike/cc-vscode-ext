import * as vscode from 'vscode';
import type { DiffManager } from '../diff/DiffManager';
import type { ProposedDiffTracker } from '../diff/ProposedDiffTracker';
import type { SessionHistory } from '../sessions/SessionHistory';
import type { TerminalLauncher } from '../terminal/TerminalLauncher';
import type { ILogger } from '../process/ClaudeProcessManager';

export interface IPanelOpener {
  openNewPanel(): Promise<void>;
  reopenLastSession(): Promise<void>;
}

export interface IViewFocuser {
  focusInput(): void;
}

/**
 * Registers all VS Code commands contributed by the extension.
 *
 * Returns the disposables so the extension can push them onto context.subscriptions.
 */
export class CommandRegistry {
  constructor(
    private readonly context: {
      readonly extensionPath: string;
    },
    private readonly panelOpener: IPanelOpener,
    private readonly diffManager: DiffManager,
    private readonly diffTracker: ProposedDiffTracker,
    private readonly sessionHistory: SessionHistory,
    private readonly terminalLauncher: TerminalLauncher,
    private readonly logger: ILogger,
  ) {}

  register(): vscode.Disposable[] {
    const r = vscode.commands.registerCommand;

    return [
      // ─── Panel / editor ───────────────────────────────────────────────
      r('claude-vscode.editor.open', () => this.panelOpener.openNewPanel()),
      r('claude-vscode.editor.openLast', () => this.panelOpener.reopenLastSession()),
      r('claude-vscode.primaryEditor.open', () => this.panelOpener.openNewPanel()),
      r('claude-vscode.window.open', () => this.panelOpener.openNewPanel()),
      r('claude-vscode.sidebar.open', () =>
        vscode.commands.executeCommand('claude-vscode.sidebar.view.focus'),
      ),
      r('claude-vscode.newConversation', () => this.panelOpener.openNewPanel()),
      r('claude-vscode.reopenClosedSession', () => {
        const lastId = this.sessionHistory.getLastClosed();
        if (lastId) {
          this.sessionHistory.clearLastClosed();
          return this.panelOpener.reopenLastSession();
        }
      }),

      // ─── Diff accept / reject ─────────────────────────────────────────
      r('claude-vscode.acceptProposedDiff', () => this.acceptActiveDiff()),
      r('claude-vscode.rejectProposedDiff', () => this.rejectActiveDiff()),
      r('claude-code.acceptProposedDiff', () => this.acceptActiveDiff()),
      r('claude-code.rejectProposedDiff', () => this.rejectActiveDiff()),

      // ─── Terminal ─────────────────────────────────────────────────────
      r('claude-vscode.terminal.open', () =>
        this.terminalLauncher.openClaudeTerminal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
      ),
      r('claude-vscode.terminal.open.keyboard', () =>
        this.terminalLauncher.openClaudeTerminal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
      ),

      // ─── Stubs for remaining commands ─────────────────────────────────
      r('claude-vscode.focus', () => undefined),
      r('claude-vscode.blur', () => undefined),
      r('claude-vscode.logout', () => undefined),
      r('claude-vscode.update', () => undefined),
      r('claude-vscode.insertAtMention', () => undefined),
      r('claude-code.insertAtMentioned', () => undefined),
      r('claude-vscode.installPlugin', () => undefined),
      r('claude-vscode.showLogs', () => this.logger.info('showLogs command invoked')),
      r('claude-vscode.openWalkthrough', () =>
        vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          'reference.claude-code-reference#claude-code-walkthrough',
        ),
      ),
      r('claude-vscode.createWorktree', () => undefined),
    ];
  }

  private acceptActiveDiff(): Promise<void> | void {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri && this.diffManager.hasDiff(uri)) {
      return this.diffManager.acceptDiff(uri);
    }
  }

  private rejectActiveDiff(): void {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri && this.diffManager.hasDiff(uri)) {
      this.diffManager.rejectDiff(uri);
    }
  }
}
