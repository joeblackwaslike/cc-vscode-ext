import * as vscode from 'vscode';
import type { DiffManager } from '../diff/DiffManager';
import type { ProposedDiffTracker } from '../diff/ProposedDiffTracker';
import type { SessionHistory } from '../sessions/SessionHistory';
import type { TerminalLauncher } from '../terminal/TerminalLauncher';
import type { ILogger } from '../process/ClaudeProcessManager';

/**
 * The original Anthropic Claude Code extension. Claw Code is a drop-in
 * replacement, so when this extension is NOT installed we also expose its
 * `claude-code.*` command IDs (below) for keybinding/workflow compatibility.
 * When it IS installed it owns those IDs — re-registering them throws
 * `command '…' already exists` and crash-loops the extension host.
 */
const CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code';

/** Original command IDs we alias when the real extension is absent → our handler. */
const COMPAT_COMMAND_ALIASES: ReadonlyArray<[legacyId: string, ourId: string]> = [
  ['claude-code.acceptProposedDiff', 'claw-vscode.acceptProposedDiff'],
  ['claude-code.rejectProposedDiff', 'claw-vscode.rejectProposedDiff'],
  ['claude-code.insertAtMentioned', 'claw-vscode.insertAtMention'],
];

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

    const disposables: vscode.Disposable[] = [
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
      // Canonical IDs. The original `claude-code.*` IDs are aliased onto these
      // conditionally below (only when the real extension is absent) — see
      // COMPAT_COMMAND_ALIASES.
      r('claw-vscode.acceptProposedDiff', () => this.acceptActiveDiff()),
      r('claw-vscode.rejectProposedDiff', () => this.rejectActiveDiff()),

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
      r('claw-vscode.installPlugin', () => undefined),
      r('claw-vscode.showLogs', () => this.logger.info('showLogs command invoked')),
      r('claw-vscode.openWalkthrough', () =>
        vscode.commands.executeCommand(
          'workbench.action.openWalkthrough',
          'reference.claw-code#claw-code-walkthrough',
        ),
      ),
      r('claw-vscode.createWorktree', () => undefined),
    ];

    // Drop-in compatibility: when the official Anthropic.claude-code extension
    // is NOT installed, also expose its command IDs so existing keybindings and
    // saved workflows keep working against Claw Code. When it IS installed we
    // must NOT register them — it owns those IDs and a duplicate registerCommand
    // throws `command '…' already exists`, which crash-loops the extension host.
    // Registered at runtime only (not contributed in package.json), which is all
    // that keybindings / executeCommand-by-id need.
    if (!vscode.extensions.getExtension(CLAUDE_CODE_EXTENSION_ID)) {
      for (const [legacyId, ourId] of COMPAT_COMMAND_ALIASES) {
        disposables.push(r(legacyId, () => vscode.commands.executeCommand(ourId)));
      }
    }

    return disposables;
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
