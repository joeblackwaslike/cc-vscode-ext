import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { AtMentionHandler } from '../../../src/mentions/AtMentionHandler';

describe('AtMentionHandler', () => {
  let handler: AtMentionHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new AtMentionHandler();
    mockVscode.window.activeTextEditor = undefined;
  });

  describe('getCurrentSelection()', () => {
    it('returns empty text when no active editor', () => {
      const result = handler.getCurrentSelection();
      expect(result.type).toBe('get_current_selection_response');
      expect(result.text).toBe('');
      expect(result.filePath).toBeUndefined();
      expect(result.startLine).toBeUndefined();
      expect(result.endLine).toBeUndefined();
    });

    it('returns empty text when selection is empty', () => {
      mockVscode.window.activeTextEditor = {
        selection: { isEmpty: true, start: { line: 5, character: 0 }, end: { line: 5, character: 0 } },
        document: {
          uri: { fsPath: '/workspace/src/index.ts' },
          getText: vi.fn(() => ''),
        },
      } as never;

      const result = handler.getCurrentSelection();
      expect(result.text).toBe('');
      expect(result.filePath).toBe('/workspace/src/index.ts');
      expect(result.startLine).toBeUndefined();
    });

    it('returns selected text and line range when selection is not empty', () => {
      const getText = vi.fn(() => 'const x = 1;');
      mockVscode.window.activeTextEditor = {
        selection: {
          isEmpty: false,
          start: { line: 3, character: 0 },
          end: { line: 5, character: 10 },
        },
        document: {
          uri: { fsPath: '/workspace/src/utils.ts' },
          getText,
        },
      } as never;

      const result = handler.getCurrentSelection();
      expect(result.text).toBe('const x = 1;');
      expect(result.filePath).toBe('/workspace/src/utils.ts');
      expect(result.startLine).toBe(3);
      expect(result.endLine).toBe(5);
    });

    it('calls document.getText with the selection', () => {
      const getText = vi.fn(() => 'selected text');
      const selection = { isEmpty: false, start: { line: 0, character: 0 }, end: { line: 1, character: 5 } };
      mockVscode.window.activeTextEditor = {
        selection,
        document: { uri: { fsPath: '/file.ts' }, getText },
      } as never;

      handler.getCurrentSelection();
      expect(getText).toHaveBeenCalledWith(selection);
    });
  });

  describe('notifyAtMentioned()', () => {
    it('posts an at_mentioned message to the webview', () => {
      const webview = { postMessage: vi.fn(() => Promise.resolve(true)) };
      handler.notifyAtMentioned(webview as never, '/workspace/src/index.ts');
      expect(webview.postMessage).toHaveBeenCalledWith({
        type: 'at_mentioned',
        filePath: '/workspace/src/index.ts',
      });
    });
  });
});
