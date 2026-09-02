import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Watches ~/.claude/handoffs/<sessionId>.md for the anti-compact plugin's
 * PreCompact handoff file. Fires onHandoff once when the file appears or
 * changes, then disposes itself — anti-compact writes the file exactly once
 * per compaction event.
 */
export class HandoffWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private fired = false;

  constructor(
    sessionId: string,
    private readonly onHandoff: (content: string) => void,
  ) {
    const dir = path.join(os.homedir(), '.claude', 'handoffs');
    const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), `${sessionId}.md`);
    // ignoreCreateEvents=false, ignoreChangeEvents=false, ignoreDeleteEvents=true
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, true);
    const handler = (uri: vscode.Uri) => { this.handleFile(uri); };
    this.watcher.onDidCreate(handler);
    this.watcher.onDidChange(handler);

    // Handle the race: file may have been written before the watcher registered.
    const filePath = path.join(dir, `${sessionId}.md`);
    if (fs.existsSync(filePath)) {
      this.handleFile(vscode.Uri.file(filePath));
    }
  }

  private handleFile(uri: vscode.Uri): void {
    if (this.fired) return;
    this.fired = true;
    try {
      const content = fs.readFileSync(uri.fsPath, 'utf8');
      this.onHandoff(content);
    } catch {
      // File disappeared between the existence check and the read — ignore.
    }
    this.watcher.dispose();
  }

  dispose(): void {
    this.watcher.dispose();
  }
}
