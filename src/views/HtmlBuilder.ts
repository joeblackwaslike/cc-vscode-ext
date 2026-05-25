import * as vscode from 'vscode';
import { generateNonce } from '../utils/nonce';

export interface WebviewHtmlOptions {
  isSidebar?: boolean;
  isFullEditor?: boolean;
  isSessionListOnly?: boolean;
}

/**
 * Builds the HTML document loaded into each webview panel/view.
 *
 * Uses a nonce-based CSP so only our bundled scripts can run. The nonce is
 * freshly generated for every call, satisfying VS Code's security recommendations.
 */
export class HtmlBuilder {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly nonceFn: () => string = generateNonce,
  ) {}

  build(
    webview: vscode.Webview,
    options: WebviewHtmlOptions = {},
  ): string {
    const nonce = this.nonceFn();

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'index.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'webview', 'index.css'),
    );

    const { isSidebar = false, isFullEditor = false, isSessionListOnly = false } = options;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; connect-src *;">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body>
  <pre id="claude-error"></pre>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.IS_SIDEBAR = ${isSidebar};
    window.IS_FULL_EDITOR = ${isFullEditor};
    window.IS_SESSION_LIST_ONLY = ${isSessionListOnly};
  </script>
  <script nonce="${nonce}" src="${scriptUri}" type="module"></script>
</body>
</html>`;
  }
}
