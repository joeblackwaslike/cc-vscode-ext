import * as vscode from 'vscode';
import { Logger } from './logging/Logger';
import { ExtensionSettings } from './settings/ExtensionSettings';
import { SettingsWatcher } from './settings/SettingsWatcher';
import { SessionStorage } from './sessions/SessionStorage';
import { SessionHistory } from './sessions/SessionHistory';
import { SessionManager } from './sessions/SessionManager';
import { ChannelRouter } from './process/ChannelRouter';
import { ClaudeProcessManager } from './process/ClaudeProcessManager';
import { TempFileProvider } from './views/TempFileProvider';
import { HtmlBuilder } from './views/HtmlBuilder';
import { ViewManager } from './views/ViewManager';
import { PanelWebviewProvider } from './views/PanelWebviewProvider';
import { SidebarWebviewProvider } from './views/SidebarWebviewProvider';
import { SessionListProvider } from './views/SessionListProvider';
import { ProposedDiffTracker } from './diff/ProposedDiffTracker';
import { DiffManager } from './diff/DiffManager';
import { MessageBroker } from './ipc/MessageBroker';
import { CommandRegistry } from './commands/CommandRegistry';
import { AtMentionHandler } from './mentions/AtMentionHandler';
import { TerminalLauncher } from './terminal/TerminalLauncher';
import { AuthManager } from './auth/AuthManager';
import { WorktreeManager } from './worktree/WorktreeManager';
import { FileListProvider } from './mentions/FileListProvider';
import { adaptWebview } from './utils/webviewAdapter';

export function activate(context: vscode.ExtensionContext): void {
  // ─── Core services ──────────────────────────────────────────────────────────

  const logger = new Logger('Claw Code');
  const settings = new ExtensionSettings();
  const settingsWatcher = new SettingsWatcher(settings);

  // ─── Session layer ──────────────────────────────────────────────────────────

  const storage = new SessionStorage(context.globalState);
  const sessionHistory = new SessionHistory(storage);
  const sessionManager = new SessionManager(storage, sessionHistory);

  // ─── Process layer ──────────────────────────────────────────────────────────

  const channelRouter = new ChannelRouter();
  const processManager = new ClaudeProcessManager(
    context.extensionPath,
    channelRouter,
    logger,
  );

  // ─── Diff system ────────────────────────────────────────────────────────────

  const leftProvider = new TempFileProvider('claw-vscode-left');
  const rightProvider = new TempFileProvider('claw-vscode-right');

  const diffTracker = new ProposedDiffTracker(
    (key, value) => vscode.commands.executeCommand('setContext', key, value),
  );

  const diffManager = new DiffManager(
    leftProvider,
    rightProvider,
    diffTracker,
    vscode.commands.executeCommand.bind(vscode.commands),
    vscode.workspace.fs.writeFile.bind(vscode.workspace.fs),
    vscode.Uri.file.bind(vscode.Uri),
  );

  // ─── View layer ─────────────────────────────────────────────────────────────

  const viewManager = new ViewManager(sessionManager);
  const htmlBuilder = new HtmlBuilder(context.extensionUri);

  // ─── IPC broker factory ──────────────────────────────────────────────────────
  // Each webview (panel, sidebar, session list) gets its own MessageBroker so
  // that messages from that webview are routed correctly.

  const vscBridge = {
    openFile: async (filePath: string, line?: number) => {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
      const opts = line !== undefined ? { selection: new vscode.Range(line, 0, line, 0) } : undefined;
      await vscode.window.showTextDocument(doc, opts);
    },
    openUrl: async (url: string) => {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
    openFolder: async (folderPath: string, newWindow = false) => {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folderPath), newWindow);
    },
    openNewConversationTab: async () => {
      await vscode.commands.executeCommand('claw-vscode.editor.open');
    },
  };

  const makeBroker = (webview: ReturnType<typeof adaptWebview>): void => {
    new MessageBroker(
      processManager,
      sessionManager,
      diffManager,
      viewManager,
      channelRouter,
      webview,
      logger,
      { authManager, worktreeManager, atMentionHandler, fileListProvider, vscode: vscBridge, terminalLauncher },
    );
  };

  const panelProvider = new PanelWebviewProvider(
    context.extensionUri,
    htmlBuilder,
    viewManager,
    makeBroker,
    sessionHistory,
    logger,
  );

  const sidebarProvider = new SidebarWebviewProvider(
    context.extensionUri,
    htmlBuilder,
    viewManager,
    makeBroker,
    logger,
  );

  const sessionListProvider = new SessionListProvider(
    context.extensionUri,
    htmlBuilder,
    viewManager,
    makeBroker,
    logger,
  );

  // ─── Feature modules ────────────────────────────────────────────────────────

  const terminalLauncher = new TerminalLauncher(context.extensionPath);
  const authManager = new AuthManager();
  const atMentionHandler = new AtMentionHandler();
  const worktreeManager = new WorktreeManager();
  const fileListProvider = new FileListProvider();

  // ─── Context keys ───────────────────────────────────────────────────────────

  void vscode.commands.executeCommand('setContext', 'claw-vscode.sessionsListEnabled', true);
  void vscode.commands.executeCommand('setContext', 'claw-vscode.primaryEditorEnabled', true);
  void vscode.commands.executeCommand('setContext', 'claw-vscode.lastClosedWasSession', false);
  void vscode.commands.executeCommand('setContext', 'claw-vscode.viewingProposedDiff', false);
  void vscode.commands.executeCommand('setContext', 'claw-code.viewingProposedDiff', false);

  // ─── Active editor tracking for diff context key ────────────────────────────

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      diffTracker.updateContextKey(editor);
    }),
  );

  // ─── Register text document content providers ───────────────────────────────

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('claw-vscode-left', leftProvider),
    vscode.workspace.registerTextDocumentContentProvider('claw-vscode-right', rightProvider),
  );

  // ─── Register webview view providers ────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarWebviewProvider.VIEW_ID, sidebarProvider),
    vscode.window.registerWebviewViewProvider(
      SidebarWebviewProvider.VIEW_ID_SECONDARY,
      sidebarProvider,
    ),
    vscode.window.registerWebviewViewProvider(SessionListProvider.VIEW_ID, sessionListProvider),
  );

  // ─── Commands ───────────────────────────────────────────────────────────────

  const commandRegistry = new CommandRegistry(
    { extensionPath: context.extensionPath },
    panelProvider,
    diffManager,
    diffTracker,
    sessionHistory,
    terminalLauncher,
    logger,
  );

  context.subscriptions.push(...commandRegistry.register());

  // ─── Settings watcher ────────────────────────────────────────────────────────

  context.subscriptions.push(settingsWatcher);

  // ─── Disposables ────────────────────────────────────────────────────────────

  context.subscriptions.push(
    { dispose: () => processManager.dispose() },
    { dispose: () => panelProvider.dispose() },
    { dispose: () => leftProvider.dispose() },
    { dispose: () => rightProvider.dispose() },
    logger,
  );

  logger.info('Claw Code extension activated');


}

export function deactivate(): void {
  // Cleanup is handled by context.subscriptions disposables registered in activate()
}
