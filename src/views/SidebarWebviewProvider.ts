import * as vscode from 'vscode';
import type { HtmlBuilder } from './HtmlBuilder';
import type { ViewManager } from './ViewManager';
import type { ILogger } from '../process/ClaudeProcessManager';
import type { IWebview } from '../ipc/MessageBroker';
import { adaptWebview } from '../utils/webviewAdapter';

/**
 * WebviewViewProvider for the Claude Code sidebar panel.
 *
 * Registered with `window.registerWebviewViewProvider` for the view ID
 * `claude-vscode.sidebar.view`. VS Code calls `resolveWebviewView` whenever the
 * sidebar is made visible.
 */
export class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  static readonly VIEW_ID = 'claude-vscode.sidebar.view';

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly htmlBuilder: HtmlBuilder,
    private readonly viewManager: ViewManager,
    private readonly makeBroker: (webview: IWebview) => void,
    private readonly logger: ILogger,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview')],
    };

    webviewView.webview.html = this.htmlBuilder.build(webviewView.webview, { isSidebar: true });

    this.viewManager.register(webviewView.webview as never);
    this.makeBroker(adaptWebview(webviewView.webview));

    webviewView.onDidDispose(() => {
      this.viewManager.unregister(webviewView.webview as never);
      this.view = undefined;
      this.logger.info('SidebarWebviewProvider view disposed');
    });
  }

  /** Returns true if the sidebar view is currently resolved. */
  isActive(): boolean {
    return this.view !== undefined;
  }
}
