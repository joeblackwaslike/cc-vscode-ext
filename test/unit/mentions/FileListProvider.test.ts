import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { FileListProvider } from '../../../src/mentions/FileListProvider';

function makeFolder(fsPath: string, name = 'workspace') {
  return { uri: { fsPath, toString: () => `file://${fsPath}` }, name };
}

function makeUri(fsPath: string) {
  return { fsPath, toString: () => `file://${fsPath}` };
}

describe('FileListProvider', () => {
  let provider: FileListProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new FileListProvider();

    // Default: single workspace folder at /workspace
    mockVscode.workspace.workspaceFolders = [makeFolder('/workspace')] as never;

    // RelativePattern stub
    mockVscode.RelativePattern = vi.fn((_folder: unknown, _pattern: string) => ({ pattern: _pattern })) as never;
  });

  it('returns empty array when no workspace folders', async () => {
    mockVscode.workspace.workspaceFolders = undefined;
    const files = await provider.listFiles('');
    expect(files).toEqual([]);
  });

  it('returns all files when query is empty', async () => {
    mockVscode.workspace.findFiles.mockResolvedValue([
      makeUri('/workspace/src/index.ts'),
      makeUri('/workspace/src/utils.ts'),
    ]);

    const files = await provider.listFiles('');
    expect(files).toEqual(['src/index.ts', 'src/utils.ts']);
  });

  it('filters files by query substring (case-insensitive)', async () => {
    mockVscode.workspace.findFiles.mockResolvedValue([
      makeUri('/workspace/src/index.ts'),
      makeUri('/workspace/src/utils.ts'),
      makeUri('/workspace/test/index.test.ts'),
    ]);

    const files = await provider.listFiles('index');
    expect(files).toEqual(['src/index.ts', 'test/index.test.ts']);
  });

  it('is case-insensitive in query matching', async () => {
    mockVscode.workspace.findFiles.mockResolvedValue([
      makeUri('/workspace/src/MyComponent.tsx'),
    ]);

    const files = await provider.listFiles('mycomponent');
    expect(files).toEqual(['src/MyComponent.tsx']);
  });

  it('returns empty array when no files match the query', async () => {
    mockVscode.workspace.findFiles.mockResolvedValue([
      makeUri('/workspace/src/index.ts'),
    ]);

    const files = await provider.listFiles('nonexistent');
    expect(files).toEqual([]);
  });

  it('passes the correct exclude glob to findFiles', async () => {
    mockVscode.workspace.findFiles.mockResolvedValue([]);
    await provider.listFiles('');
    expect(mockVscode.workspace.findFiles).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('node_modules'),
      100,
    );
  });

  it('uses the correct workspace folder to compute relative paths', async () => {
    mockVscode.workspace.workspaceFolders = [makeFolder('/project')] as never;
    mockVscode.workspace.findFiles.mockResolvedValue([
      makeUri('/project/src/app.ts'),
    ]);

    const files = await provider.listFiles('');
    expect(files).toEqual(['src/app.ts']);
  });
});
