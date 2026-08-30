import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { SidebarWebviewProvider } from '../../../src/views/SidebarWebviewProvider';

function makeMockWebviewView() {
  let disposeHandler: (() => void) | undefined;
  const webview = {
    html: '',
    options: {} as Record<string, unknown>,
    postMessage: vi.fn(() => Promise.resolve(true)),
    onDidReceiveMessage: vi.fn(),
  };
  return {
    webview,
    onDidDispose: vi.fn((handler: () => void) => {
      disposeHandler = handler;
      return { dispose: vi.fn() };
    }),
    _triggerDispose: () => disposeHandler?.(),
  };
}

describe('SidebarWebviewProvider', () => {
  const htmlBuilder = { build: vi.fn(() => '<html></html>') };
  const viewManager = { register: vi.fn(), unregister: vi.fn() };
  const makeBroker = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mockVscode.Uri.joinPath.mockReturnValue({ toString: () => '/ext/webview' } as never);
  });

  function makeProvider() {
    return new SidebarWebviewProvider(
      { toString: () => '/ext' } as never,
      htmlBuilder as never,
      viewManager as never,
      makeBroker,
      logger,
    );
  }

  it('VIEW_ID matches the manifest view ids', () => {
    expect(SidebarWebviewProvider.VIEW_ID).toBe('clawdVSCodeSidebar');
    expect(SidebarWebviewProvider.VIEW_ID_SECONDARY).toBe('clawdVSCodeSidebarSecondary');
  });

  it('isActive() returns false before resolveWebviewView', () => {
    const provider = makeProvider();
    expect(provider.isActive()).toBe(false);
  });

  it('resolveWebviewView() builds HTML with isSidebar=true', () => {
    const provider = makeProvider();
    const wv = makeMockWebviewView();
    provider.resolveWebviewView(wv as never, {} as never, {} as never);
    expect(htmlBuilder.build).toHaveBeenCalledWith(
      wv.webview,
      expect.objectContaining({ isSidebar: true }),
    );
  });

  it('resolveWebviewView() registers the webview with ViewManager', () => {
    const provider = makeProvider();
    const wv = makeMockWebviewView();
    provider.resolveWebviewView(wv as never, {} as never, {} as never);
    expect(viewManager.register).toHaveBeenCalledWith(wv.webview);
  });

  it('isActive() returns true after resolveWebviewView', () => {
    const provider = makeProvider();
    const wv = makeMockWebviewView();
    provider.resolveWebviewView(wv as never, {} as never, {} as never);
    expect(provider.isActive()).toBe(true);
  });

  it('dispose event unregisters from ViewManager', () => {
    const provider = makeProvider();
    const wv = makeMockWebviewView();
    provider.resolveWebviewView(wv as never, {} as never, {} as never);
    wv._triggerDispose();
    expect(viewManager.unregister).toHaveBeenCalledWith(wv.webview);
    expect(provider.isActive()).toBe(false);
  });
});
