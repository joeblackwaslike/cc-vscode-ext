/**
 * Mock of the 'vscode' module for unit tests.
 *
 * Usage in test files:
 *   vi.mock('vscode', () => mockVscode);
 *
 * The mock is structured so each sub-namespace (window, workspace, commands, Uri, etc.)
 * contains vi.fn() spies that can be customised per test with mockReturnValue / mockImplementation.
 */
import { vi } from 'vitest';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUri(scheme: string, path: string) {
  return { scheme, path, fsPath: path, toString: () => `${scheme}://${path}` };
}

// ─── Mock Memento (globalState / workspaceState) ──────────────────────────────

export function createMockMemento() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => store.get(key) ?? defaultValue),
    update: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    keys: vi.fn(() => [...store.keys()]),
    setKeysForSync: vi.fn(),
    _store: store,
  };
}

// ─── Mock ExtensionContext ────────────────────────────────────────────────────

export function createMockContext() {
  const globalState = createMockMemento();
  const workspaceState = createMockMemento();
  return {
    globalState,
    workspaceState,
    subscriptions: [] as { dispose(): void }[],
    extensionUri: makeUri('file', '/mock/extension'),
    extensionPath: '/mock/extension',
    storagePath: '/mock/storage',
    globalStoragePath: '/mock/global-storage',
    logPath: '/mock/logs',
    asAbsolutePath: vi.fn((rel: string) => `/mock/extension/${rel}`),
    extension: { id: 'joeblackwaslike.clawd-code', packageJSON: {} },
  };
}

// ─── Core VS Code namespace mocks ────────────────────────────────────────────

export const mockVscode = {
  // window namespace
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      append: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      name: 'mock-channel',
    })),
    showInformationMessage: vi.fn(() => Promise.resolve(undefined)),
    showWarningMessage: vi.fn(() => Promise.resolve(undefined)),
    showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
    showQuickPick: vi.fn(() => Promise.resolve(undefined)),
    showInputBox: vi.fn(() => Promise.resolve(undefined)),
    createWebviewPanel: vi.fn(),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined as
      | undefined
      | { selection: unknown; document: { uri: ReturnType<typeof makeUri>; getText(): string } },
    visibleTextEditors: [] as unknown[],
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeVisibleTextEditors: vi.fn(() => ({ dispose: vi.fn() })),
    tabGroups: {
      all: [] as unknown[],
    },
    createTerminal: vi.fn(() => ({
      show: vi.fn(),
      sendText: vi.fn(),
      dispose: vi.fn(),
    })),
    // Terminal shell-integration API (VS Code ≥1.93). Default: no integration —
    // listeners never fire, so CommandRunner falls back to child_process capture.
    onDidChangeTerminalShellIntegration: vi.fn(() => ({ dispose: vi.fn() })),
    onDidEndTerminalShellExecution: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  },

  // workspace namespace
  workspace: {
    getConfiguration: vi.fn((_section?: string) => ({
      get: vi.fn((key: string, defaultValue?: unknown) => defaultValue),
      has: vi.fn(() => false),
      inspect: vi.fn(() => undefined),
      update: vi.fn(() => Promise.resolve()),
    })),
    workspaceFolders: undefined as undefined | Array<{ uri: ReturnType<typeof makeUri>; name: string }>,
    registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn(() =>
      Promise.resolve({ uri: makeUri('file', '/mock/doc'), getText: () => '' })
    ),
    findFiles: vi.fn(() => Promise.resolve([])),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    fs: {
      readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
      writeFile: vi.fn(() => Promise.resolve()),
      stat: vi.fn(() => Promise.resolve({ type: 1 })),
    },
    saveAll: vi.fn(() => Promise.resolve(true)),
  },

  // commands namespace
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(() => Promise.resolve()),
  },

  // Uri
  Uri: {
    file: vi.fn((path: string) => makeUri('file', path)),
    parse: vi.fn((str: string) => {
      const [scheme, rest] = str.split('://');
      return makeUri(scheme ?? 'file', rest ?? str);
    }),
    joinPath: vi.fn((base: ReturnType<typeof makeUri>, ...segments: string[]) =>
      makeUri(base.scheme, [base.path, ...segments].join('/'))
    ),
    from: vi.fn((components: { scheme: string; path: string }) =>
      makeUri(components.scheme, components.path)
    ),
  },

  // ViewColumn enum
  ViewColumn: {
    One: 1,
    Two: 2,
    Three: 3,
    Active: -1,
    Beside: -2,
  } as const,

  // EventEmitter
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),

  // Disposable
  Disposable: {
    from: vi.fn((...disposables: { dispose(): void }[]) => ({
      dispose: () => disposables.forEach((d) => d.dispose()),
    })),
  },

  // env
  env: {
    openExternal: vi.fn(() => Promise.resolve(true)),
    appName: 'Visual Studio Code',
    appRoot: '/mock/vscode',
    language: 'en',
    shell: '/bin/zsh',
    uriScheme: 'vscode',
    remoteName: undefined as string | undefined,
    clipboard: {
      readText: vi.fn(() => Promise.resolve('')),
      writeText: vi.fn(() => Promise.resolve()),
    },
  },

  // extensions
  extensions: {
    getExtension: vi.fn(() => undefined),
    all: [] as unknown[],
  },

  // FileType enum (used by workspace.fs.stat)
  FileType: {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  } as const,

  // ThemeColor, ThemeIcon
  ThemeColor: vi.fn((id: string) => ({ id })),
  ThemeIcon: vi.fn((id: string) => ({ id })),

  // MarkdownString
  MarkdownString: vi.fn((value?: string) => ({ value, isTrusted: false })),

  // Range / Position / Selection (lightweight stubs)
  Range: vi.fn((startLine: number, startChar: number, endLine: number, endChar: number) => ({
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
    isEmpty: startLine === endLine && startChar === endChar,
  })),
  Position: vi.fn((line: number, character: number) => ({ line, character })),
  Selection: vi.fn((anchorLine: number, anchorChar: number, activeLine: number, activeChar: number) => ({
    anchor: { line: anchorLine, character: anchorChar },
    active: { line: activeLine, character: activeChar },
    isEmpty: anchorLine === activeLine && anchorChar === activeChar,
  })),
};

/** Reset all mock function call history. Call in beforeEach(). */
export function resetMocks(): void {
  const resetFn = (obj: unknown): void => {
    if (obj && typeof obj === 'object') {
      for (const val of Object.values(obj as Record<string, unknown>)) {
        if (val && typeof val === 'function' && 'mockReset' in val) {
          (val as ReturnType<typeof vi.fn>).mockReset();
        } else {
          resetFn(val);
        }
      }
    }
  };
  resetFn(mockVscode);
}
