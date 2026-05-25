import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { HtmlBuilder } from '../../../src/views/HtmlBuilder';

describe('HtmlBuilder', () => {
  const NONCE = 'abc123def456';

  const CSP_SOURCE = 'vscode-resource:';

  const mockWebview = {
    asWebviewUri: vi.fn((uri: { toString(): string }) => ({ toString: () => `vscode-webview://ext/${uri.toString().split('/').slice(-2).join('/')}` })),
    cspSource: CSP_SOURCE,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebview.asWebviewUri.mockImplementation((uri: { toString(): string }) => {
      const parts = uri.toString().split('/');
      const webviewPath = parts.slice(-2).join('/');
      return { toString: () => `vscode-webview://ext/${webviewPath}` };
    });
    mockVscode.Uri.joinPath.mockImplementation((_base: unknown, ...segs: string[]) => ({
      toString: () => `/ext/${segs.join('/')}`,
    }));
  });

  function makeBuilder() {
    const extensionUri = { toString: () => '/ext' } as never;
    return new HtmlBuilder(extensionUri, () => NONCE);
  }

  it('returns a string starting with <!DOCTYPE html>', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toMatch(/^<!DOCTYPE html>/);
  });

  it('includes the nonce in the CSP meta tag', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toContain(`'nonce-${NONCE}'`);
  });

  it('includes the webview cspSource in the CSP', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toContain(CSP_SOURCE);
  });

  it('includes the script URI in a script tag with the nonce', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toContain(`nonce="${NONCE}"`);
    expect(html).toContain('type="module"');
  });

  it('includes the stylesheet link', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toContain('rel="stylesheet"');
  });

  it('contains the root div', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toContain('<div id="root">');
  });

  it('defaults window flags to false', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never);
    expect(html).toContain('window.IS_SIDEBAR = false');
    expect(html).toContain('window.IS_FULL_EDITOR = false');
    expect(html).toContain('window.IS_SESSION_LIST_ONLY = false');
  });

  it('sets IS_SIDEBAR=true when isSidebar option is true', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never, { isSidebar: true });
    expect(html).toContain('window.IS_SIDEBAR = true');
    expect(html).toContain('window.IS_FULL_EDITOR = false');
  });

  it('sets IS_FULL_EDITOR=true when isFullEditor option is true', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never, { isFullEditor: true });
    expect(html).toContain('window.IS_FULL_EDITOR = true');
    expect(html).toContain('window.IS_SIDEBAR = false');
  });

  it('sets IS_SESSION_LIST_ONLY=true when isSessionListOnly option is true', () => {
    const builder = makeBuilder();
    const html = builder.build(mockWebview as never, { isSessionListOnly: true });
    expect(html).toContain('window.IS_SESSION_LIST_ONLY = true');
  });

  it('calls asWebviewUri for both script and style assets', () => {
    const builder = makeBuilder();
    builder.build(mockWebview as never);
    expect(mockWebview.asWebviewUri).toHaveBeenCalledTimes(2);
  });

  it('uses joinPath to build the webview asset paths', () => {
    const builder = makeBuilder();
    builder.build(mockWebview as never);
    expect(mockVscode.Uri.joinPath).toHaveBeenCalledWith(
      expect.anything(),
      'webview',
      'index.js',
    );
    expect(mockVscode.Uri.joinPath).toHaveBeenCalledWith(
      expect.anything(),
      'webview',
      'index.css',
    );
  });

  it('generates a fresh nonce per build call', () => {
    let callCount = 0;
    const builder = new HtmlBuilder({ toString: () => '/ext' } as never, () => `nonce-${++callCount}`);
    const html1 = builder.build(mockWebview as never);
    const html2 = builder.build(mockWebview as never);
    expect(html1).toContain("'nonce-nonce-1'");
    expect(html2).toContain("'nonce-nonce-2'");
  });
});
