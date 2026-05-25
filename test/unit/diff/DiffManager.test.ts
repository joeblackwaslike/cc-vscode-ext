import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiffManager } from '../../../src/diff/DiffManager';
import type * as vscode from 'vscode';
import type { OpenDiffMessage } from '../../../src/types/ipc';

function makeUri(str: string) {
  return { toString: () => str } as unknown as vscode.Uri;
}

describe('DiffManager', () => {
  const leftUri = makeUri('left:///src/index.ts');
  const rightUri = makeUri('right:///src/index.ts');
  const targetFileUri = makeUri('file:///workspace/src/index.ts');

  const mockLeft = {
    makeUri: vi.fn(() => leftUri),
    setContent: vi.fn(),
    deleteContent: vi.fn(),
    provideTextDocumentContent: vi.fn(() => 'old content'),
    scheme: 'claude-vscode-left',
  };
  const mockRight = {
    makeUri: vi.fn(() => rightUri),
    setContent: vi.fn(),
    deleteContent: vi.fn(),
    provideTextDocumentContent: vi.fn(() => 'proposed content'),
    scheme: 'claude-vscode-right',
  };
  const mockTracker = {
    trackDiff: vi.fn(),
    untrackDiff: vi.fn(),
  };
  const executeCommand = vi.fn(() => Promise.resolve());
  const writeFile = vi.fn(() => Promise.resolve());
  const fileUri = vi.fn(() => targetFileUri);

  function makeManager() {
    return new DiffManager(
      mockLeft as never,
      mockRight as never,
      mockTracker as never,
      executeCommand,
      writeFile,
      fileUri,
    );
  }

  const msg: OpenDiffMessage = {
    type: 'open_diff',
    filePath: 'src/index.ts',
    oldContent: 'old content',
    newContent: 'proposed content',
    channelId: 'ch-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRight.provideTextDocumentContent.mockReturnValue('proposed content');
    mockLeft.makeUri.mockReturnValue(leftUri);
    mockRight.makeUri.mockReturnValue(rightUri);
    fileUri.mockReturnValue(targetFileUri);
  });

  describe('openDiff()', () => {
    it('stores left and right content in providers', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      expect(mockLeft.setContent).toHaveBeenCalledWith(leftUri, 'old content');
      expect(mockRight.setContent).toHaveBeenCalledWith(rightUri, 'proposed content');
    });

    it('tracks the right URI in the diff tracker', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      expect(mockTracker.trackDiff).toHaveBeenCalledWith(rightUri);
    });

    it('executes vscode.diff with left/right URIs and a title', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      expect(executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        leftUri,
        rightUri,
        'index.ts: Proposed Changes',
        expect.objectContaining({}),
      );
    });

    it('passes viewColumn to the diff command', async () => {
      const manager = makeManager();
      await manager.openDiff(msg, 2 as vscode.ViewColumn);
      expect(executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        leftUri,
        rightUri,
        expect.any(String),
        { viewColumn: 2 },
      );
    });

    it('marks the diff as open via hasDiff()', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      expect(manager.hasDiff(rightUri)).toBe(true);
    });
  });

  describe('acceptDiff()', () => {
    it('writes proposed content to the actual file', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      await manager.acceptDiff(rightUri);

      expect(writeFile).toHaveBeenCalledWith(
        targetFileUri,
        expect.any(Uint8Array),
      );
      const written = writeFile.mock.calls[0]?.[1] as Uint8Array;
      expect(new TextDecoder().decode(written)).toBe('proposed content');
    });

    it('deletes content from both providers', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      await manager.acceptDiff(rightUri);

      expect(mockLeft.deleteContent).toHaveBeenCalledWith(leftUri);
      expect(mockRight.deleteContent).toHaveBeenCalledWith(rightUri);
    });

    it('untracks the right URI from the diff tracker', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      await manager.acceptDiff(rightUri);

      expect(mockTracker.untrackDiff).toHaveBeenCalledWith(rightUri);
    });

    it('removes the diff from hasDiff after accept', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      await manager.acceptDiff(rightUri);

      expect(manager.hasDiff(rightUri)).toBe(false);
    });

    it('is a no-op for unknown rightUri', async () => {
      const manager = makeManager();
      await expect(manager.acceptDiff(makeUri('right:///unknown.ts'))).resolves.toBeUndefined();
      expect(writeFile).not.toHaveBeenCalled();
    });
  });

  describe('rejectDiff()', () => {
    it('does NOT write to the file', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      manager.rejectDiff(rightUri);

      expect(writeFile).not.toHaveBeenCalled();
    });

    it('deletes content from both providers', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      manager.rejectDiff(rightUri);

      expect(mockLeft.deleteContent).toHaveBeenCalledWith(leftUri);
      expect(mockRight.deleteContent).toHaveBeenCalledWith(rightUri);
    });

    it('untracks the right URI from the diff tracker', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      manager.rejectDiff(rightUri);

      expect(mockTracker.untrackDiff).toHaveBeenCalledWith(rightUri);
    });

    it('removes the diff from hasDiff after reject', async () => {
      const manager = makeManager();
      await manager.openDiff(msg);
      manager.rejectDiff(rightUri);

      expect(manager.hasDiff(rightUri)).toBe(false);
    });

    it('is a no-op for unknown rightUri', () => {
      const manager = makeManager();
      expect(() => manager.rejectDiff(makeUri('right:///unknown.ts'))).not.toThrow();
    });
  });
});
