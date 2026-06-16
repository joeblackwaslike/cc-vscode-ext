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
      r('claw-vscode.editor.open', () => this.panelOpener.openNewPanel()),
      r('claw-vscode.editor.openLast', () => this.panelOpener.reopenLastSession()),
      r('claw-vscode.primaryEditor.open', () => this.panelOpener.openNewPanel()),
      r('claw-vscode.window.open', () => this.panelOpener.openNewPanel()),
      r('claw-vscode.sidebar.open', () =>
        vscode.commands.executeCommand('clawVSCodeSidebarSecondary.focus'),
      ),
      r('claw-vscode.newConversation', () => this.panelOpener.openNewPanel()),
      r('claw-vscode.reopenClosedSession', () => {
        const lastId = this.sessionHistory.getLastClosed();
        if (lastId) {
          this.sessionHistory.clearLastClosed();
          return this.panelOpener.reopenLastSession();
        }
      }),

      // ─── Diff accept / reject ─────────────────────────────────────────
      r('claw-vscode.acceptProposedDiff', () => this.acceptActiveDiff()),
      r('claw-vscode.rejectProposedDiff', () => this.rejectActiveDiff()),
      r('claude-code.acceptProposedDiff', () => this.acceptActiveDiff()),
      r('claude-code.rejectProposedDiff', () => this.rejectActiveDiff()),

      // ─── Terminal ─────────────────────────────────────────────────────
      r('claw-vscode.terminal.open', () =>
        this.terminalLauncher.openClaudeTerminal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
      ),
      r('claw-vscode.terminal.open.keyboard', () =>
        this.terminalLauncher.openClaudeTerminal(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
      ),

      // ─── Stubs for remaining commands ─────────────────────────────────
      r('claw-vscode.focus', () => undefined),
      r('claw-vscode.blur', () => undefined),
      r('claw-vscode.logout', () => undefined),
      r('claw-vscode.update', () => undefined),
      r('claw-vscode.insertAtMention', () => undefined),
      r('claude-code.insertAtMentioned', () => undefined),
      r('claw-vscode.installPlugin', () => undefined),
      r('claw-vscode.showLogs', () => this.logger.info('showLogs command invoked')),
      r('claw-vscode.openWalkthrough', () =>
        vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          'reference.claw-code#claude-code-walkthrough',
        ),
      ),
      r('claw-vscode.createWorktree', () => undefined),
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
