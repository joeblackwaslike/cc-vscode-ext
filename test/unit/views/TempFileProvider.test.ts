import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { TempFileProvider } from '../../../src/views/TempFileProvider';

describe('TempFileProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVscode.EventEmitter.mockImplementation(() => ({
      event: vi.fn(),
      fire: vi.fn(),
      dispose: vi.fn(),
    }));
    // Uri.from returns a simple object whose toString() is deterministic
    mockVscode.Uri.from.mockImplementation((c: { scheme: string; path: string }) => ({
      scheme: c.scheme,
      path: c.path,
      toString: () => `${c.scheme}://${c.path}`,
    }));
  });

  function makeUri(scheme: string, path: string) {
    return { scheme, path, toString: () => `${scheme}://${path}` } as unknown as import('vscode').Uri;
  }

  it('provideTextDocumentContent returns empty string for an unknown URI', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const uri = makeUri('claw-vscode-left', '/test.ts');
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });

  it('setContent stores content and provideTextDocumentContent returns it', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const uri = makeUri('claw-vscode-left', '/test.ts');
    provider.setContent(uri, 'const x = 1;');
    expect(provider.provideTextDocumentContent(uri)).toBe('const x = 1;');
  });

  it('setContent fires the onDidChange emitter with the URI', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const emitter = mockVscode.EventEmitter.mock.results[0]?.value as { fire: ReturnType<typeof vi.fn> };
    const uri = makeUri('claw-vscode-left', '/test.ts');
    provider.setContent(uri, 'content');
    expect(emitter.fire).toHaveBeenCalledWith(uri);
  });

  it('deleteContent removes stored content', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const uri = makeUri('claw-vscode-left', '/test.ts');
    provider.setContent(uri, 'content');
    provider.deleteContent(uri);
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });

  it('makeUri returns a URI with the provider scheme', () => {
    const provider = new TempFileProvider('claw-vscode-right');
    provider.makeUri('/foo/bar.ts');
    expect(mockVscode.Uri.from).toHaveBeenCalledWith({ scheme: 'claw-vscode-right', path: '/foo/bar.ts' });
  });

  it('stores multiple URIs independently', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const uri1 = makeUri('claw-vscode-left', '/a.ts');
    const uri2 = makeUri('claw-vscode-left', '/b.ts');
    provider.setContent(uri1, 'aaa');
    provider.setContent(uri2, 'bbb');
    expect(provider.provideTextDocumentContent(uri1)).toBe('aaa');
    expect(provider.provideTextDocumentContent(uri2)).toBe('bbb');
  });

  it('setContent overwrites previously stored content', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const uri = makeUri('claw-vscode-left', '/test.ts');
    provider.setContent(uri, 'v1');
    provider.setContent(uri, 'v2');
    expect(provider.provideTextDocumentContent(uri)).toBe('v2');
  });

  it('dispose calls the emitter dispose', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const emitter = mockVscode.EventEmitter.mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
    provider.dispose();
    expect(emitter.dispose).toHaveBeenCalled();
  });

  it('dispose clears stored content', () => {
    const provider = new TempFileProvider('claw-vscode-left');
    const uri = makeUri('claw-vscode-left', '/test.ts');
    provider.setContent(uri, 'data');
    provider.dispose();
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });

  it('scheme is accessible as a property', () => {
    const provider = new TempFileProvider('claw-vscode-right');
    expect(provider.scheme).toBe('claw-vscode-right');
  });
});
