import * as vscode from 'vscode';
import type { HtmlBuilder } from './HtmlBuilder';
import type { ViewManager } from './ViewManager';
import type { IWebview } from '../ipc/MessageBroker';
import { adaptWebview } from '../utils/webviewAdapter';
import type { SessionHistory } from '../sessions/SessionHistory';
import type { ILogger } from '../process/ClaudeProcessManager';

/**
 * Creates and manages `WebviewPanel` instances (the full-editor Clawd Code tab).
 *
 * Each call to `openNewPanel` creates a fresh panel. The panel is registered with
 * ViewManager on creation and unregistered when disposed.
 */
export class PanelWebviewProvider {
  private readonly panels = new Set<vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly htmlBuilder: HtmlBuilder,
    private readonly viewManager: ViewManager,
    private readonly makeBroker: (webview: IWebview) => void,
    private readonly sessionHistory: SessionHistory,
    private readonly logger: ILogger,
  ) {}

  openNewPanel(
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
  ): Promise<void> {
    this.createPanel({ isFullEditor: true }, viewColumn);
    return Promise.resolve();
  }

  reopenLastSession(
    viewColumn: vscode.ViewColumn = vscode.ViewColumn.Beside,
  ): Promise<void> {
    const lastId = this.sessionHistory.getLastClosed();
    if (lastId) {
      this.sessionHistory.clearLastClosed();
      this.createPanel({ isFullEditor: true }, viewColumn);
    }
    return Promise.resolve();
  }

  private createPanel(
    options: { isFullEditor?: boolean; isSidebar?: boolean },
    viewColumn: vscode.ViewColumn,
  ): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'clawd-vscode.editor',
      'Clawd Code',
      viewColumn,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'webview')],
      },
    );

    panel.webview.html = this.htmlBuilder.build(panel.webview, options);

    this.viewManager.register(panel.webview as never);
    this.makeBroker(adaptWebview(panel.webview));
    this.panels.add(panel);

    panel.onDidDispose(() => {
      this.viewManager.unregister(panel.webview as never);
      this.panels.delete(panel);
      this.logger.info('WebviewPanel disposed');
    });

    return panel;
  }

  dispose(): void {
    for (const panel of this.panels) {
      panel.dispose();
    }
    this.panels.clear();
  }
}
