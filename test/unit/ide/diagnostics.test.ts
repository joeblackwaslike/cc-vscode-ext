import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import {
  createDiagnosticsCollector,
  MAX_DIAGNOSTIC_FILES,
  MAX_DIAGNOSTICS_PER_FILE,
} from '../../../src/ide/diagnostics';

const WITHHELD_NOTE = 'Diagnostics withheld: the file is git-ignored, excluded, or could not be verified.';

function uriOf(path: string, scheme = 'file') {
  return { scheme, path, fsPath: path, toString: () => `${scheme}://${path}` };
}

function diag(overrides: Record<string, unknown> = {}) {
  return {
    message: 'boom',
    severity: 0,
    range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } },
    source: 'ts',
    code: 2322,
    ...overrides,
  };
}

let isWithheld: ReturnType<typeof vi.fn>;
let all: Array<[ReturnType<typeof uriOf>, unknown[]]>;
const collect = () => createDiagnosticsCollector({ isWithheld: isWithheld as never });

beforeEach(() => {
  vi.clearAllMocks();
  isWithheld = vi.fn(async () => false);
  all = [];
  mockVscode.workspace.textDocuments = [];
  mockVscode.languages.getDiagnostics.mockImplementation(((uri?: unknown) =>
    uri === undefined
      ? all
      : (all.find(([u]) => u.toString() === String(uri))?.[1] ?? [])) as never);
});

describe('createDiagnosticsCollector', () => {
  it('maps severity names, ranges, source and code', async () => {
    all = [
      [
        uriOf('/ws/a.ts'),
        [
          diag(),
          diag({ severity: 1, code: { value: 'no-x', target: {} } }),
          diag({ severity: 2, code: 'str' }),
          diag({ severity: 3, source: undefined, code: undefined }),
        ],
      ],
    ];
    const [block] = await collect()(undefined);
    const [entry] = JSON.parse(block!.text);
    expect(entry.uri).toBe('file:///ws/a.ts');
    expect(entry.diagnostics.map((d: { severity: string }) => d.severity)).toEqual([
      'Error',
      'Warning',
      'Information',
      'Hint',
    ]);
    expect(entry.diagnostics[0]).toEqual({
      message: 'boom',
      severity: 'Error',
      range: { start: { line: 1, character: 2 }, end: { line: 3, character: 4 } },
      source: 'ts',
      code: 2322,
    });
    expect(entry.diagnostics[1].code).toBe('no-x');
    expect(entry.diagnostics[2].code).toBe('str');
  });

  it('reports linesInFile for open documents and omits it otherwise', async () => {
    all = [
      [uriOf('/ws/open.ts'), [diag()]],
      [uriOf('/ws/closed.ts'), [diag()]],
    ];
    mockVscode.workspace.textDocuments = [{ uri: uriOf('/ws/open.ts'), lineCount: 42 }] as never;
    const entries = JSON.parse((await collect()(undefined))[0]!.text);
    expect(entries[0].linesInFile).toBe(42);
    expect('linesInFile' in entries[1]).toBe(false);
  });

  it('uri filters to one file', async () => {
    all = [
      [uriOf('/ws/a.ts'), [diag()]],
      [uriOf('/ws/b.ts'), [diag({ message: 'only b' })]],
    ];
    const entries = JSON.parse((await collect()('file:///ws/b.ts'))[0]!.text);
    expect(entries).toHaveLength(1);
    expect(entries[0].diagnostics[0].message).toBe('only b');
  });

  it('a malformed uri returns [] as JSON', async () => {
    mockVscode.Uri.parse.mockImplementationOnce((() => {
      throw new Error('bad uri');
    }) as never);
    const blocks = await collect()('::not a uri');
    expect(blocks).toEqual([{ type: 'text', text: '[]' }]);
  });

  it('a non-file scheme returns [] as JSON', async () => {
    const blocks = await collect()('https://example.com/x');
    expect(blocks).toEqual([{ type: 'text', text: '[]' }]);
    expect(mockVscode.languages.getDiagnostics).not.toHaveBeenCalled();
  });

  it('withheld file is omitted and a second text block states the count', async () => {
    all = [
      [uriOf('/ws/ok.ts'), [diag()]],
      [uriOf('/ws/secret.ts'), [diag()]],
      [uriOf('/ws/secret2.ts'), [diag()]],
    ];
    isWithheld.mockImplementation(async (u: { path: string }) => u.path.includes('secret'));
    const blocks = await collect()(undefined);
    const entries = JSON.parse(blocks[0]!.text);
    expect(entries.map((e: { uri: string }) => e.uri)).toEqual(['file:///ws/ok.ts']);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.text).toContain('2');
    expect(blocks[1]!.text).toMatch(/withheld/i);
  });

  it('an explicit uri that is withheld returns [] plus the withheld sentence', async () => {
    all = [[uriOf('/ws/secret.ts'), [diag()]]];
    isWithheld.mockResolvedValue(true);
    const blocks = await collect()('file:///ws/secret.ts');
    expect(blocks).toEqual([
      { type: 'text', text: '[]' },
      { type: 'text', text: WITHHELD_NOTE },
    ]);
  });

  it('isWithheld rejecting counts as withheld', async () => {
    all = [[uriOf('/ws/a.ts'), [diag()]]];
    isWithheld.mockRejectedValue(new Error('probe blew up'));
    const blocks = await collect()(undefined);
    expect(JSON.parse(blocks[0]!.text)).toEqual([]);
    expect(blocks).toHaveLength(2);
  });

  it('caps files at MAX_DIAGNOSTIC_FILES and diagnostics per file at MAX_DIAGNOSTICS_PER_FILE with a note of how many were cut', async () => {
    all = Array.from({ length: MAX_DIAGNOSTIC_FILES + 5 }, (_, i) => [
      uriOf(`/ws/f${i}.ts`),
      Array.from({ length: i === 0 ? MAX_DIAGNOSTICS_PER_FILE + 7 : 1 }, () => diag()),
    ]) as never;
    const blocks = await collect()(undefined);
    const entries = JSON.parse(blocks[0]!.text);
    expect(entries).toHaveLength(MAX_DIAGNOSTIC_FILES);
    expect(entries[0].diagnostics).toHaveLength(MAX_DIAGNOSTICS_PER_FILE);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.text).toContain('5 files');
    expect(blocks[1]!.text).toContain('7 diagnostics');
  });

  it('non-file schemes are dropped from the all-files form', async () => {
    all = [
      [uriOf('/ws/a.ts'), [diag()]],
      [uriOf('out', 'output'), [diag()]],
    ];
    const blocks = await collect()(undefined);
    expect(JSON.parse(blocks[0]!.text)).toHaveLength(1);
    expect(blocks).toHaveLength(1);
  });

  it('skips files with zero diagnostics in the all-files form', async () => {
    all = [
      [uriOf('/ws/clean.ts'), []],
      [uriOf('/ws/a.ts'), [diag()]],
    ];
    expect(JSON.parse((await collect()(undefined))[0]!.text)).toHaveLength(1);
  });
});
