import * as vscode from 'vscode';

/**
 * TextDocumentContentProvider for in-memory "virtual" files used by the diff editor.
 *
 * Two instances are registered — one for the left (original) side and one for the right
 * (proposed) side — with distinct URI schemes (`claw-vscode-left` / `claw-vscode-right`).
 * When a diff is opened, the webview places content here so VS Code can display it as a
 * read-only virtual document in the diff editor.
 */
export class TempFileProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange = this._onDidChange.event;

  constructor(readonly scheme: string) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  deleteContent(uri: vscode.Uri): void {
    this.contents.delete(uri.toString());
  }

  /** Build a URI for this provider's scheme with the given path. */
  makeUri(path: string): vscode.Uri {
    return vscode.Uri.from({ scheme: this.scheme, path });
  }

  dispose(): void {
    this._onDidChange.dispose();
    this.contents.clear();
  }
}
