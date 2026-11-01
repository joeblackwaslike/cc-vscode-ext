import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionSettings } from '../settings/ExtensionSettings';
import { MAX_SELECTION_CHARS, type IdeContext, type IdeSelection } from '../shared/ideTags';

/**
 * Result of running a command: its exit code, -1 when it could not be spawned,
 * and `killed` when it was stopped by a timeout or a signal before exiting.
 */
export interface ExecResult {
  code: number;
  killed?: boolean;
}

/** Runs a command and resolves with how it ended. */
export type ExecFn = (cmd: string, args: string[], cwd: string) => Promise<ExecResult>;

const DEFAULT_GIT_TIMEOUT_MS = 5000;

/** `ExecFn` over `child_process.execFile`, killing the command after 5 s. */
export const execFileCode: ExecFn = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: DEFAULT_GIT_TIMEOUT_MS }, (err) => {
      if (!err) return resolve({ code: 0 });
      if (err.killed || err.signal) return resolve({ code: -1, killed: true });
      resolve({ code: typeof err.code === 'number' ? err.code : -1 });
    });
  });

/** Exit codes whose meaning is settled: 1 = not ignored, 128 = not a repository, -1 = git missing. */
const SETTLED_NOT_IGNORED = new Set([1, 128, -1]);

export interface EditorContextTrackerOptions {
  settings: Pick<ExtensionSettings, 'getAttachOpenFile' | 'getAttachSelection' | 'getRespectGitIgnore'>;
  exec: ExecFn;
  onChange: (ctx: IdeContext | null) => void;
  debounceMs?: number;
  /** How long `git check-ignore` may run before the file counts as ignored for that computation. */
  gitTimeoutMs?: number;
  log?: (message: string) => void;
}

const WATCHED_SETTINGS = ['attachOpenFile', 'attachSelection', 'respectGitIgnore'].flatMap((key) => [
  `clawdCode.${key}`,
  `claudeCode.${key}`,
]);

function isFileEditor(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  return editor?.document.uri.scheme === 'file';
}

function sameContext(a: IdeContext | null, b: IdeContext | null): boolean {
  if (a === null || b === null) return a === b;
  const x = a.selection;
  const y = b.selection;
  return (
    a.filePath === b.filePath &&
    x?.startLine === y?.startLine &&
    x?.endLine === y?.endLine &&
    x?.text === y?.text &&
    x?.truncatedChars === y?.truncatedChars
  );
}

/** Whether any tab, including either side of a diff, still shows the document. */
function isShownInTab(uri: vscode.Uri): boolean {
  const key = uri.toString();
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => {
      const input = tab.input as { uri?: vscode.Uri; original?: vscode.Uri; modified?: vscode.Uri } | undefined;
      return [input?.uri, input?.original, input?.modified].some((u) => u?.toString() === key);
    })
  );
}

/** Escapes VS Code glob metacharacters so the path matches only itself. */
function escapeGlob(p: string): string {
  return p.replace(/[[\]*?{}]/g, '[$&]');
}

/**
 * Follows the last active `file` editor and its selection, and reports the
 * IDE context to offer the composer, with the attach and git-ignore settings
 * already applied. Changes are debounced and only reported when the value differs.
 */
export class EditorContextTracker implements vscode.Disposable {
  private editor: vscode.TextEditor | undefined;
  private value: IdeContext | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private disposed = false;
  private readonly ignored = new Map<string, Promise<boolean>>();
  private readonly disposables: vscode.Disposable[];

  constructor(private readonly opts: EditorContextTrackerOptions) {
    const gitignoreWatcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
    const resetIgnored = (): void => {
      this.ignored.clear();
      this.schedule();
    };
    this.disposables = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (isFileEditor(editor)) this.track(editor);
      }),
      vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
        if (textEditor === vscode.window.activeTextEditor && isFileEditor(textEditor)) {
          this.track(textEditor);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        this.ignored.delete(doc.uri.fsPath);
        if (this.editor?.document === doc) this.untrack();
      }),
      vscode.window.tabGroups.onDidChangeTabs(() => {
        if (this.editor && !isShownInTab(this.editor.document.uri)) this.untrack();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('files.exclude')) resetIgnored();
        else if (WATCHED_SETTINGS.some((s) => e.affectsConfiguration(s))) this.schedule();
      }),
      gitignoreWatcher.onDidChange(resetIgnored),
      gitignoreWatcher.onDidCreate(resetIgnored),
      gitignoreWatcher.onDidDelete(resetIgnored),
      gitignoreWatcher,
    ];
    const active = vscode.window.activeTextEditor;
    if (isFileEditor(active)) this.track(active);
  }

  /** The last reported context, or null when there is none. */
  current(): IdeContext | null {
    return this.value;
  }

  /**
   * Re-checks a context that is about to be sent. With `respectGitIgnore` on,
   * the ignore answer for the path is refreshed and the selected text is dropped
   * when the file is ignored or excluded now, or when git does not answer in time.
   */
  async sanitize(context: IdeContext): Promise<IdeContext> {
    const sel = context.selection;
    if (sel?.text === undefined || !this.opts.settings.getRespectGitIgnore()) return context;
    this.ignored.delete(context.filePath);
    if (!(await this.isIgnored(vscode.Uri.file(context.filePath)))) return context;
    return { filePath: context.filePath, selection: { startLine: sel.startLine, endLine: sel.endLine } };
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }

  private track(editor: vscode.TextEditor): void {
    this.editor = editor;
    this.schedule();
  }

  private untrack(): void {
    this.editor = undefined;
    this.schedule();
  }

  private schedule(): void {
    this.generation++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs ?? 300);
  }

  private async flush(): Promise<void> {
    const generation = this.generation;
    let next: IdeContext | null;
    try {
      next = await this.compute(this.editor);
    } catch (err) {
      this.log(err);
      return;
    }
    if (this.disposed || generation !== this.generation || sameContext(next, this.value)) return;
    this.value = next;
    try {
      this.opts.onChange(next);
    } catch (err) {
      this.log(err);
    }
  }

  private log(err: unknown): void {
    this.opts.log?.(`EditorContextTracker: ${err instanceof Error ? err.message : String(err)}`);
  }

  private async compute(editor: vscode.TextEditor | undefined): Promise<IdeContext | null> {
    if (!editor) return null;
    const { settings } = this.opts;
    const filePath = editor.document.uri.fsPath;
    const sel = editor.selection;
    if (sel.isEmpty || !settings.getAttachSelection()) {
      return settings.getAttachOpenFile() ? { filePath } : null;
    }
    const endsAtLineStart = sel.end.character === 0 && sel.end.line > sel.start.line;
    const selection: IdeSelection = {
      startLine: sel.start.line + 1,
      endLine: endsAtLineStart ? sel.end.line : sel.end.line + 1,
    };
    if (!(settings.getRespectGitIgnore() && (await this.isIgnored(editor.document.uri)))) {
      const text = editor.document.getText(sel);
      selection.text = text.slice(0, MAX_SELECTION_CHARS);
      if (text.length > MAX_SELECTION_CHARS) selection.truncatedChars = text.length - MAX_SELECTION_CHARS;
    }
    return { filePath, selection };
  }

  private isIgnored(uri: vscode.Uri): Promise<boolean> {
    let result = this.ignored.get(uri.fsPath);
    if (!result) {
      result = this.probeIgnored(uri);
      this.ignored.set(uri.fsPath, result);
    }
    return result;
  }

  private async probeIgnored(uri: vscode.Uri): Promise<boolean> {
    const [git, excluded] = await Promise.all([this.isGitIgnored(uri.fsPath), this.isExcluded(uri)]);
    if (!git.settled) this.ignored.delete(uri.fsPath);
    return git.ignored || excluded;
  }

  /**
   * Runs `git check-ignore`. A timeout or kill means git is present but did not
   * answer, so the file counts as ignored. Only settled answers may be cached.
   */
  private async isGitIgnored(fsPath: string): Promise<{ ignored: boolean; settled: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.opts.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        this.opts.exec('git', ['check-ignore', '-q', fsPath], path.dirname(fsPath)),
        timeout,
      ]);
      if (result === 'timeout' || result.killed) return { ignored: true, settled: false };
      if (result.code === 0) return { ignored: true, settled: true };
      if (SETTLED_NOT_IGNORED.has(result.code)) return { ignored: false, settled: true };
      // Unrecognized exit code: fail closed rather than guessing it means "not ignored".
      return { ignored: true, settled: false };
    } catch (err) {
      this.log(err);
      return { ignored: true, settled: false };
    } finally {
      clearTimeout(timer);
    }
  }

  /** True when `files.exclude` hides the file; any probe failure counts as excluded. */
  private async isExcluded(uri: vscode.Uri): Promise<boolean> {
    try {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return false;
      const relative = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, escapeGlob(relative)),
        undefined,
        1
      );
      return found.length === 0;
    } catch (err) {
      this.log(err);
      return true;
    }
  }
}
