import type * as vscode from 'vscode';
import type { IWebview } from '../ipc/MessageBroker';

/**
 * Adapts a VS Code `Webview` (or `WebviewView.webview`) to the `IWebview`
 * interface consumed by `MessageBroker`.
 *
 * VS Code's `onDidReceiveMessage` is an `Event<any>` (returns a `Disposable`)
 * rather than the simple callback-returning-disposable shape we use in tests.
 */
export function adaptWebview(webview: vscode.Webview): IWebview {
  return {
    postMessage: (msg) => webview.postMessage(msg),
    onDidReceiveMessage: (handler) => webview.onDidReceiveMessage(handler),
  };
}
