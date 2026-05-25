import * as vscode from 'vscode';
import type { GetCurrentSelectionResponseMessage, AtMentionedMessage } from '../types/ipc';

export interface IPostable {
  postMessage(msg: AtMentionedMessage): Thenable<boolean>;
}

/**
 * Handles @ mention interactions between the editor and the webview.
 *
 * - `getCurrentSelection()` reads the active editor's selected text and location
 *   so the webview can pre-fill an @ mention with file context.
 * - `notifyAtMentioned()` pushes an `at_mentioned` message to the webview so it can
 *   show the file in the mention dropdown.
 */
export class AtMentionHandler {
  /**
   * Returns the current editor selection as a response message.
   * Returns empty text and undefined location if there is no active editor or selection.
   */
  getCurrentSelection(): GetCurrentSelectionResponseMessage {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return {
        type: 'get_current_selection_response',
        text: '',
        filePath: editor?.document.uri.fsPath,
        startLine: undefined,
        endLine: undefined,
      };
    }

    const { selection, document } = editor;
    return {
      type: 'get_current_selection_response',
      text: document.getText(selection),
      filePath: document.uri.fsPath,
      startLine: selection.start.line,
      endLine: selection.end.line,
    };
  }

  /** Send an `at_mentioned` message to the webview with the given file path. */
  notifyAtMentioned(webview: IPostable, filePath: string): void {
    void webview.postMessage({ type: 'at_mentioned', filePath });
  }
}
