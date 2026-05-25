import { basename } from 'path';
import type * as vscode from 'vscode';
import type { TempFileProvider } from '../views/TempFileProvider';
import type { ProposedDiffTracker } from './ProposedDiffTracker';
import type { OpenDiffMessage } from '../types/ipc';

interface DiffRecord {
  channelId: string;
  filePath: string;
  leftUri: vscode.Uri;
}

/**
 * Manages proposed diff sessions: opens the VS Code diff editor for Claude's file edits,
 * applies accepted changes to disk, and cleans up virtual documents on accept/reject.
 */
export class DiffManager {
  private readonly openDiffs = new Map<string, DiffRecord>();

  constructor(
    private readonly leftProvider: TempFileProvider,
    private readonly rightProvider: TempFileProvider,
    private readonly diffTracker: ProposedDiffTracker,
    private readonly executeCommand: (cmd: string, ...args: unknown[]) => Thenable<unknown>,
    private readonly writeFile: (uri: vscode.Uri, content: Uint8Array) => Thenable<void>,
    private readonly fileUri: (path: string) => vscode.Uri,
  ) {}

  async openDiff(msg: OpenDiffMessage, viewColumn?: vscode.ViewColumn): Promise<void> {
    const leftUri = this.leftProvider.makeUri(msg.filePath);
    const rightUri = this.rightProvider.makeUri(msg.filePath);

    this.leftProvider.setContent(leftUri, msg.oldContent);
    this.rightProvider.setContent(rightUri, msg.newContent);
    this.diffTracker.trackDiff(rightUri);

    this.openDiffs.set(rightUri.toString(), {
      channelId: msg.channelId,
      filePath: msg.filePath,
      leftUri,
    });

    const title = `${basename(msg.filePath)}: Proposed Changes`;
    await this.executeCommand('vscode.diff', leftUri, rightUri, title, { viewColumn });
  }

  async acceptDiff(rightUri: vscode.Uri): Promise<void> {
    const record = this.openDiffs.get(rightUri.toString());
    if (!record) return;

    const content = this.rightProvider.provideTextDocumentContent(rightUri);
    await this.writeFile(this.fileUri(record.filePath), new TextEncoder().encode(content));

    this._cleanup(rightUri, record);
  }

  rejectDiff(rightUri: vscode.Uri): void {
    const record = this.openDiffs.get(rightUri.toString());
    if (!record) return;
    this._cleanup(rightUri, record);
  }

  hasDiff(rightUri: vscode.Uri): boolean {
    return this.openDiffs.has(rightUri.toString());
  }

  private _cleanup(rightUri: vscode.Uri, record: DiffRecord): void {
    this.leftProvider.deleteContent(record.leftUri);
    this.rightProvider.deleteContent(rightUri);
    this.diffTracker.untrackDiff(rightUri);
    this.openDiffs.delete(rightUri.toString());
  }
}
