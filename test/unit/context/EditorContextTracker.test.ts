import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { EditorContextTracker } from '../../../src/context/EditorContextTracker';

type Listener = (arg: unknown) => void;
interface FakeSelection {
  start: { line: number; character: number };
  end: { line: number; character: number };
  isEmpty: boolean;
}
interface FakeEditor {
  document: { uri: { scheme: string; fsPath: string }; getText: ReturnType<typeof vi.fn> };
  selection: FakeSelection;
}

function sel(sl: number, sc: number, el: number, ec: number): FakeSelection {
  return {
    start: { line: sl, character: sc },
    end: { line: el, character: ec },
    isEmpty: sl === el && sc === ec,
  };
}

const EMPTY = sel(0, 0, 0, 0);

function makeEditor(fsPath: string, scheme = 'file', text = 'picked text'): FakeEditor {
  return {
    document: { uri: { scheme, fsPath }, getText: vi.fn(() => text) },
    selection: EMPTY,
  };
}

type ListenerKey = 'active' | 'selection' | 'close' | 'config' | 'gitChange' | 'gitCreate' | 'gitDelete';
let listeners: Record<ListenerKey, Listener>;
let disposers: ReturnType<typeof vi.fn>[];
let flags: { openFile: boolean; selection: boolean; gitIgnore: boolean };
let exec: ReturnType<typeof vi.fn>;
let onChange: ReturnType<typeof vi.fn>;
let log: ReturnType<typeof vi.fn>;
let tracker: EditorContextTracker;

const WS = { uri: { fsPath: '/ws' }, name: 'ws' };

const settings = {
  getAttachOpenFile: () => flags.openFile,
  getAttachSelection: () => flags.selection,
  getRespectGitIgnore: () => flags.gitIgnore,
};

function capture(key: ListenerKey) {
  return (fn: Listener) => {
    listeners[key] = fn;
    const dispose = vi.fn();
    disposers.push(dispose);
    return { dispose };
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function drain(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function setActive(editor: FakeEditor | undefined): void {
  mockVscode.window.activeTextEditor = editor as never;
  listeners.active(editor);
}

function select(editor: FakeEditor, selection: FakeSelection): void {
  editor.selection = selection;
  listeners.selection({ textEditor: editor, selections: [selection] });
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(300);
  await drain();
}

function create(): EditorContextTracker {
  tracker = new EditorContextTracker({ settings, exec: exec as never, onChange, log });
  return tracker;
}

let watcherDispose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.clearAllMocks();
  listeners = {} as typeof listeners;
  disposers = [];
  flags = { openFile: true, selection: true, gitIgnore: true };
  exec = vi.fn(async () => ({ code: 1 }));
  onChange = vi.fn();
  log = vi.fn();
  mockVscode.window.activeTextEditor = undefined;
  const { window, workspace } = mockVscode;
  window.onDidChangeActiveTextEditor.mockImplementation(capture('active') as never);
  window.onDidChangeTextEditorSelection.mockImplementation(capture('selection') as never);
  workspace.onDidCloseTextDocument.mockImplementation(capture('close') as never);
  workspace.onDidChangeConfiguration.mockImplementation(capture('config') as never);
  watcherDispose = vi.fn();
  workspace.createFileSystemWatcher.mockImplementation(
    () =>
      ({
        onDidChange: vi.fn(capture('gitChange')),
        onDidCreate: vi.fn(capture('gitCreate')),
        onDidDelete: vi.fn(capture('gitDelete')),
        dispose: watcherDispose,
      }) as never
  );
  workspace.findFiles.mockResolvedValue([{ fsPath: 'found' }]);
  workspace.getWorkspaceFolder.mockImplementation(((uri: { fsPath: string }) =>
    uri.fsPath.startsWith('/ws/') ? WS : undefined) as never);
  create();
});

afterEach(() => {
  tracker.dispose();
  vi.useRealTimers();
});

describe('EditorContextTracker', () => {
  it('ignores editors whose document is not a file', async () => {
    setActive(makeEditor('extension-output-1', 'output'));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(tracker.current()).toBeNull();
  });

  it('ignores selection changes from an editor that is not active', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    await settle();
    const b = makeEditor('/ws/b.ts');
    select(b, sel(1, 0, 2, 4));
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tracker.current()).toEqual({ filePath: '/ws/a.ts' });
  });

  it('collapses a burst of events within 300 ms into one onChange', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    for (let line = 1; line <= 5; line++) select(a, sel(0, 0, line, 3));
    await vi.advanceTimersByTimeAsync(299);
    expect(onChange).not.toHaveBeenCalled();
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      filePath: '/ws/a.ts',
      selection: { startLine: 1, endLine: 6, text: 'picked text' },
    });
  });

  it('does not re-post an identical value', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    await settle();
    select(a, sel(3, 2, 3, 2));
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  const withSelection = { filePath: '/ws/a.ts', selection: { startLine: 3, endLine: 4, text: 'picked text' } };
  it.each([
    [true, true, { filePath: '/ws/a.ts' }, withSelection],
    [false, true, null, withSelection],
    [true, false, { filePath: '/ws/a.ts' }, { filePath: '/ws/a.ts' }],
    [false, false, null, null],
  ] as const)(
    'attachOpenFile=%s attachSelection=%s yields the spec table result',
    async (openFile, selection, nothingSelected, textSelected) => {
      flags.openFile = openFile;
      flags.selection = selection;
      const a = makeEditor('/ws/a.ts');
      setActive(a);
      await settle();
      expect(tracker.current()).toStrictEqual(nothingSelected);
      select(a, sel(2, 0, 3, 5));
      await settle();
      expect(tracker.current()).toStrictEqual(textSelected);
    }
  );

  it('withholds text but keeps the lines for a git-ignored file when respectGitIgnore is on', async () => {
    exec.mockResolvedValue({ code: 0 });
    const a = makeEditor('/ws/dist/a.js');
    setActive(a);
    select(a, sel(0, 0, 1, 2));
    await settle();
    expect(tracker.current()).toStrictEqual({
      filePath: '/ws/dist/a.js',
      selection: { startLine: 1, endLine: 2 },
    });
    expect(exec).toHaveBeenCalledWith('git', ['check-ignore', '-q', '/ws/dist/a.js'], '/ws/dist');
  });

  it('includes text for a git-ignored file when respectGitIgnore is off', async () => {
    flags.gitIgnore = false;
    exec.mockResolvedValue({ code: 0 });
    const a = makeEditor('/ws/dist/a.js');
    setActive(a);
    select(a, sel(0, 0, 1, 2));
    await settle();
    expect(tracker.current()?.selection?.text).toBe('picked text');
  });

  it.each([
    ['rejects', () => exec.mockRejectedValue(new Error('spawn git ENOENT'))],
    ['exits 128', () => exec.mockResolvedValue({ code: 128 })],
  ])('treats a file as not ignored when git %s', async (_label, arrange) => {
    arrange();
    const a = makeEditor('/tmp/a.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(tracker.current()?.selection?.text).toBe('picked text');
  });

  it('treats a file as excluded when the findFiles probe returns nothing', async () => {
    mockVscode.workspace.findFiles.mockResolvedValue([]);
    const a = makeEditor('/ws/hidden/a.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(tracker.current()?.selection).toStrictEqual({ startLine: 1, endLine: 1 });
    expect(mockVscode.workspace.findFiles).toHaveBeenCalledWith(
      { base: WS, pattern: 'hidden/a.ts' },
      undefined,
      1
    );
  });

  it('detects a file under an excluded directory by anchoring the probe at the workspace folder', async () => {
    const excludeNodeModules = (p: { base: unknown; pattern: string }) =>
      p.base === WS && p.pattern.split('/').includes('node_modules') ? [] : [{ fsPath: 'found' }];
    mockVscode.workspace.findFiles.mockImplementation((async (p: { base: unknown; pattern: string }) =>
      excludeNodeModules(p)) as never);
    const a = makeEditor('/ws/node_modules/pkg/index.js');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(tracker.current()?.selection).toStrictEqual({ startLine: 1, endLine: 1 });
    expect(mockVscode.workspace.findFiles).toHaveBeenCalledWith(
      { base: WS, pattern: 'node_modules/pkg/index.js' },
      undefined,
      1
    );
  });

  it('escapes glob characters in the probe path', async () => {
    const a = makeEditor('/ws/src/a[1]{x}*?.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(mockVscode.workspace.findFiles).toHaveBeenCalledWith(
      { base: WS, pattern: 'src/a[[]1[]][{]x[}][*][?].ts' },
      undefined,
      1
    );
  });

  it('skips the exclude probe outside the workspace but still runs git', async () => {
    const a = makeEditor('/elsewhere/a.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(mockVscode.workspace.findFiles).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledWith('git', ['check-ignore', '-q', '/elsewhere/a.ts'], '/elsewhere');
    expect(tracker.current()?.selection?.text).toBe('picked text');
  });

  it.each([
    ['rejects', 0],
    ['rejects', 1],
    ['throws', 0],
    ['throws', 1],
  ])('withholds text when findFiles %s and git exits %i', async (how, gitCode) => {
    exec.mockResolvedValue({ code: gitCode });
    if (how === 'rejects') mockVscode.workspace.findFiles.mockRejectedValue(new Error('search failed'));
    else
      mockVscode.workspace.findFiles.mockImplementation(() => {
        throw new Error('search failed');
      });
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(tracker.current()?.selection).toStrictEqual({ startLine: 1, endLine: 1 });
  });

  it.each(['gitChange', 'gitCreate', 'gitDelete'] as const)(
    'clears the ignore cache and recomputes on a .gitignore %s',
    async (key) => {
      expect(mockVscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith('**/.gitignore');
      const a = makeEditor('/ws/a.ts');
      setActive(a);
      select(a, sel(0, 0, 0, 4));
      await settle();
      expect(tracker.current()?.selection?.text).toBe('picked text');
      exec.mockResolvedValue({ code: 0 });
      listeners[key]({});
      await settle();
      expect(exec).toHaveBeenCalledTimes(2);
      expect(tracker.current()?.selection).toStrictEqual({ startLine: 1, endLine: 1 });
    }
  );

  it('treats a git check that times out as not ignored, still applies the probe, and does not cache it', async () => {
    exec.mockReturnValue(new Promise(() => {}));
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(onChange).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(5000);
    await drain();
    expect(tracker.current()?.selection?.text).toBe('picked text');

    mockVscode.workspace.findFiles.mockResolvedValue([]);
    select(a, sel(0, 0, 0, 5));
    await settle();
    await vi.advanceTimersByTimeAsync(5000);
    await drain();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(tracker.current()?.selection).toStrictEqual({ startLine: 1, endLine: 1 });
  });

  it('drops a result that finishes after a newer event arrived', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    await settle();
    const git = deferred<{ code: number }>();
    exec.mockReturnValue(git.promise);
    select(a, sel(0, 0, 0, 4));
    await settle();
    listeners.close(a.document);
    git.resolve({ code: 1 });
    await drain();
    expect(onChange.mock.calls.some(([ctx]) => ctx?.selection)).toBe(false);
    await settle();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(tracker.current()).toBeNull();
  });

  it('stops posting and disposes its listeners and watcher on dispose', async () => {
    setActive(makeEditor('/ws/a.ts'));
    tracker.dispose();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(disposers.length).toBe(7);
    for (const d of disposers) expect(d).toHaveBeenCalled();
    expect(watcherDispose).toHaveBeenCalled();
  });

  it('logs a failed compute and keeps the previous value', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    await settle();
    a.document.getText.mockImplementation(() => {
      throw new Error('boom');
    });
    select(a, sel(0, 0, 0, 4));
    await settle();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(tracker.current()).toEqual({ filePath: '/ws/a.ts' });
  });

  it('keeps the last file context when focus moves to a non-file editor', async () => {
    setActive(makeEditor('/ws/a.ts'));
    await settle();
    setActive(makeEditor('output:1', 'output'));
    setActive(undefined);
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(tracker.current()).toEqual({ filePath: '/ws/a.ts' });
  });

  it('clears the context when the tracked document closes', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    await settle();
    listeners.close(a.document);
    await settle();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(tracker.current()).toBeNull();
  });

  it('reports endLine N for a selection ending at column 0 of line N+1', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    select(a, sel(2, 0, 5, 0));
    await settle();
    expect(tracker.current()?.selection).toMatchObject({ startLine: 3, endLine: 5 });
  });

  it('gives no selection for an empty selection', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    select(a, sel(4, 2, 4, 2));
    await settle();
    expect(tracker.current()).toStrictEqual({ filePath: '/ws/a.ts' });
  });

  it('caches the ignore result per path until the document closes', async () => {
    const a = makeEditor('/ws/a.ts');
    setActive(a);
    select(a, sel(0, 0, 0, 1));
    await settle();
    select(a, sel(0, 0, 0, 2));
    await settle();
    expect(exec).toHaveBeenCalledTimes(1);
    listeners.close(a.document);
    setActive(a);
    select(a, sel(0, 0, 0, 3));
    await settle();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('recomputes when an attach setting changes', async () => {
    setActive(makeEditor('/ws/a.ts'));
    await settle();
    flags.openFile = false;
    listeners.config({ affectsConfiguration: (s: string) => s === 'claudeCode.attachOpenFile' });
    await settle();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('picks up the editor that is already active at construction', async () => {
    tracker.dispose();
    mockVscode.window.activeTextEditor = makeEditor('/ws/start.ts') as never;
    create();
    await settle();
    expect(tracker.current()).toEqual({ filePath: '/ws/start.ts' });
  });
});
