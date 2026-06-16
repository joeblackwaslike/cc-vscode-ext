import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProposedDiffTracker } from '../../../src/diff/ProposedDiffTracker';
import type * as vscode from 'vscode';

function makeUri(str: string) {
  return { toString: () => str } as unknown as vscode.Uri;
}

function makeEditor(uriStr: string) {
  return { document: { uri: makeUri(uriStr) } } as unknown as vscode.TextEditor;
}

describe('ProposedDiffTracker', () => {
  let setContext: ReturnType<typeof vi.fn>;
  let tracker: ProposedDiffTracker;

  beforeEach(() => {
    setContext = vi.fn(() => Promise.resolve());
    tracker = new ProposedDiffTracker(setContext);
  });

  it('isProposedDiff returns false for untracked URI', () => {
    expect(tracker.isProposedDiff(makeUri('claw-vscode-right:///test.ts'))).toBe(false);
  });

  it('trackDiff makes isProposedDiff return true', () => {
    const uri = makeUri('claw-vscode-right:///test.ts');
    tracker.trackDiff(uri);
    expect(tracker.isProposedDiff(uri)).toBe(true);
  });

  it('untrackDiff makes isProposedDiff return false', () => {
    const uri = makeUri('claw-vscode-right:///test.ts');
    tracker.trackDiff(uri);
    tracker.untrackDiff(uri);
    expect(tracker.isProposedDiff(uri)).toBe(false);
  });

  it('untrackDiff is a no-op for unknown URI', () => {
    expect(() => tracker.untrackDiff(makeUri('unknown://x'))).not.toThrow();
  });

  it('tracks multiple URIs independently', () => {
    const a = makeUri('claw-vscode-right:///a.ts');
    const b = makeUri('claw-vscode-right:///b.ts');
    tracker.trackDiff(a);
    expect(tracker.isProposedDiff(a)).toBe(true);
    expect(tracker.isProposedDiff(b)).toBe(false);
  });

  it('updateContextKey sets context to true when active editor is a tracked diff', () => {
    const uri = makeUri('claw-vscode-right:///test.ts');
    tracker.trackDiff(uri);
    tracker.updateContextKey(makeEditor('claw-vscode-right:///test.ts'));
    expect(setContext).toHaveBeenCalledWith('claw-vscode.viewingProposedDiff', true);
  });

  it('updateContextKey sets context to false when active editor is not a tracked diff', () => {
    tracker.updateContextKey(makeEditor('file:///test.ts'));
    expect(setContext).toHaveBeenCalledWith('claw-vscode.viewingProposedDiff', false);
  });

  it('updateContextKey sets context to false when active editor is undefined', () => {
    tracker.updateContextKey(undefined);
    expect(setContext).toHaveBeenCalledWith('claw-vscode.viewingProposedDiff', false);
  });

  it('updateContextKey reflects untrack — sets false after diff closed', () => {
    const uri = makeUri('claw-vscode-right:///test.ts');
    tracker.trackDiff(uri);
    tracker.untrackDiff(uri);
    tracker.updateContextKey(makeEditor('claw-vscode-right:///test.ts'));
    expect(setContext).toHaveBeenCalledWith('claw-vscode.viewingProposedDiff', false);
  });
});
