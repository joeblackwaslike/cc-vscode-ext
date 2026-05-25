import type * as vscode from 'vscode';

/**
 * Tracks which open editors are showing proposed diffs (the right-side virtual document).
 *
 * When a diff is accepted or rejected, the corresponding URI is untracked. The tracker
 * drives the `claude-vscode.viewingProposedDiff` context key so the accept/reject
 * editor-title buttons are only visible when a proposed diff is active.
 */
export class ProposedDiffTracker {
  private readonly proposedUris = new Set<string>();

  constructor(
    private readonly setContext: (key: string, value: boolean) => Thenable<unknown>,
  ) {}

  /** Register a right-side proposed-diff URI as open. */
  trackDiff(uri: vscode.Uri): void {
    this.proposedUris.add(uri.toString());
  }

  /** Remove a proposed-diff URI (called after accept or reject). */
  untrackDiff(uri: vscode.Uri): void {
    this.proposedUris.delete(uri.toString());
  }

  /** Returns true if the given URI is a currently-open proposed diff. */
  isProposedDiff(uri: vscode.Uri): boolean {
    return this.proposedUris.has(uri.toString());
  }

  /**
   * Update the `claude-vscode.viewingProposedDiff` context key based on the active editor.
   * Call this from the `onDidChangeActiveTextEditor` listener.
   */
  updateContextKey(activeEditor: vscode.TextEditor | undefined): void {
    const viewing = activeEditor !== undefined && this.isProposedDiff(activeEditor.document.uri);
    void this.setContext('claude-vscode.viewingProposedDiff', viewing);
  }
}
