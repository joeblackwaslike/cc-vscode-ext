import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { PanelWebviewProvider } from '../../../src/views/PanelWebviewProvider';

function makeMockPanel() {
  let disposeHandler: (() => void) | undefined;
  const webview = { html: '', postMessage: vi.fn(() => Promise.resolve(true)), onDidReceiveMessage: vi.fn() };
  const panel = {
    webview,
    onDidDispose: vi.fn((handler: () => void) => { disposeHandler = handler; return { dispose: vi.fn() }; }),
    dispose: vi.fn(() => disposeHandler?.()),
    reveal: vi.fn(),
  };
  return panel;
}

describe('PanelWebviewProvider', () => {
  const htmlBuilder = { build: vi.fn(() => '<html></html>') };
  const viewManager = { register: vi.fn(), unregister: vi.fn() };
  const makeBroker = vi.fn();
  const sessionHistory = {
    getLastClosed: vi.fn(() => undefined as string | undefined),
    clearLastClosed: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockVscode.Uri.joinPath.mockReturnValue({ toString: () => '/ext/webview' } as never);
    mockVscode.window.createWebviewPanel.mockReturnValue(makeMockPanel());
  });

  function makeProvider() {
    return new PanelWebviewProvider(
      { toString: () => '/ext' } as never,
      htmlBuilder as never,
      viewManager as never,
      makeBroker,
      sessionHistory as never,
      logger,
    );
  }

  it('openNewPanel() creates a WebviewPanel', async () => {
    const provider = makeProvider();
    await provider.openNewPanel();
    expect(mockVscode.window.createWebviewPanel).toHaveBeenCalledOnce();
  });

  it('openNewPanel() builds HTML for the panel webview', async () => {
    const provider = makeProvider();
    await provider.openNewPanel();
    expect(htmlBuilder.build).toHaveBeenCalled();
  });

  it('openNewPanel() registers the webview with ViewManager', async () => {
    const provider = makeProvider();
    await provider.openNewPanel();
    expect(viewManager.register).toHaveBeenCalled();
  });

  it('panel disposal unregisters from ViewManager', async () => {
    const panel = makeMockPanel();
    mockVscode.window.createWebviewPanel.mockReturnValue(panel);

    const provider = makeProvider();
    await provider.openNewPanel();
    panel.dispose();

    expect(viewManager.unregister).toHaveBeenCalled();
  });

  it('reopenLastSession() returns undefined when no last session', async () => {
    sessionHistory.getLastClosed.mockReturnValue(undefined);
    const provider = makeProvider();
    const result = await provider.reopenLastSession();
    expect(result).toBeUndefined();
    expect(mockVscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it('reopenLastSession() creates a panel when last session exists', async () => {
    sessionHistory.getLastClosed.mockReturnValue('session-1');
    const provider = makeProvider();
    await provider.reopenLastSession();
    expect(mockVscode.window.createWebviewPanel).toHaveBeenCalled();
    expect(sessionHistory.clearLastClosed).toHaveBeenCalled();
  });

  it('dispose() closes all panels', async () => {
    const panel1 = makeMockPanel();
    const panel2 = makeMockPanel();
    mockVscode.window.createWebviewPanel
      .mockReturnValueOnce(panel1)
      .mockReturnValueOnce(panel2);

    const provider = makeProvider();
    await provider.openNewPanel();
    await provider.openNewPanel();
    provider.dispose();

    expect(panel1.dispose).toHaveBeenCalled();
    expect(panel2.dispose).toHaveBeenCalled();
  });
});
