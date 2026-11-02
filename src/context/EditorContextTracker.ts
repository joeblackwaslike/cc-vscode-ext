import { execFile } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionSettings } from '../settings/ExtensionSettings';
import { MAX_SELECTION_CHARS, type IdeContext, type IdeSelection } from '../shared/ideTags';

/**
 * Result of running a command: its exit code, -1 when the binary is not
 * installed, `killed` when it was stopped by a timeout or a signal before
 * exiting, and its stderr when it exited with a non-zero code.
 */
export interface ExecResult {
  code: number;
  killed?: boolean;
  stderr?: string;
}

/** Runs a command and resolves with how it ended. */
export type ExecFn = (cmd: string, args: string[], cwd: string) => Promise<ExecResult>;

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

/**
 * `ExecFn` over `child_process.execFile` in the C locale, killing the command
 * after 5 s. Rejects when the binary exists but cannot be spawned, and when the
 * working directory is gone, since Node reports that as ENOENT too.
 */
export const execFileCode: ExecFn = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, LC_ALL: 'C' };
    execFile(cmd, args, { cwd, env, timeout: DEFAULT_PROBE_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (!err) return resolve({ code: 0 });
      if (err.killed || err.signal) return resolve({ code: -1, killed: true });
      if (typeof err.code === 'number') return resolve({ code: err.code, stderr: String(stderr) });
      if (err.code === 'ENOENT' && existsSync(cwd)) return resolve({ code: -1 });
      reject(err);
    });
  });

/** Exit codes that settle "not ignored": 1 = not ignored, -1 = git not installed. */
const SETTLED_NOT_IGNORED = new Set([1, -1]);
const NOT_A_REPOSITORY = /not a git repository/i;

interface ProbeResult {
  ignored: boolean;
  /** False when the answer must not be cached, because the probe failed or did not finish. */
  settled: boolean;
}

const UNSETTLED: ProbeResult = { ignored: true, settled: false };

/** Resolves with `'timeout'` when `promise` does not settle within `ms`. */
async function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export interface EditorContextTrackerOptions {
  settings: Pick<ExtensionSettings, 'getAttachOpenFile' | 'getAttachSelection' | 'getRespectGitIgnore'>;
  exec: ExecFn;
  onChange: (ctx: IdeContext | null) => void;
  debounceMs?: number;
  /** How long `git check-ignore` may run before the file counts as ignored for that computation. */
  gitTimeoutMs?: number;
  /** How long the `files.exclude` probe may run before the file counts as excluded for that computation. */
  excludeTimeoutMs?: number;
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
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (this.editor?.document === document) this.schedule();
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
   * Re-checks a context that is about to be sent against the current settings.
   * A selection is dropped when `attachSelection` is off, and a context without
   * one becomes null when `attachOpenFile` is off. With `respectGitIgnore` on,
   * the ignore answer for the path is refreshed and the selected text is dropped
   * when the file is ignored or excluded now, or when the check does not answer.
   */
  async sanitize(context: IdeContext): Promise<IdeContext | null> {
    const { settings } = this.opts;
    const sel = settings.getAttachSelection() ? context.selection : undefined;
    if (!sel) {
      if (!settings.getAttachOpenFile()) return null;
      return context.selection ? { filePath: context.filePath } : context;
    }
    if (sel.text === undefined || !settings.getRespectGitIgnore()) return context;
    this.ignored.delete(context.filePath);
    const ignored = await this.isIgnored(vscode.Uri.file(context.filePath));
    if (!settings.getAttachSelection()) {
      return settings.getAttachOpenFile() ? { filePath: context.filePath } : null;
    }
    if (!settings.getRespectGitIgnore() || !ignored) return context;
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
    try {
      this.opts.onChange(next);
    } catch (err) {
      this.log(err);
      return;
    }
    this.value = next;
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
    if (!git.settled || !excluded.settled) this.ignored.delete(uri.fsPath);
    return git.ignored || excluded.ignored;
  }

  /**
   * Runs `git check-ignore`. Only exit 0 (ignored), exit 1 (not ignored), a
   * missing git, and exit 128 for a folder outside any repository are settled.
   * Anything else, including a timeout, a kill, a spawn failure or another
   * exit-128 error, counts as ignored and is not cached.
   */
  private async isGitIgnored(fsPath: string): Promise<ProbeResult> {
    try {
      const result = await withTimeout(
        this.opts.exec('git', ['check-ignore', '-q', fsPath], path.dirname(fsPath)),
        this.opts.gitTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
      );
      if (result === 'timeout') return this.unsettled(fsPath, 'git check-ignore timed out');
      if (result.killed) return this.unsettled(fsPath, 'git check-ignore was killed');
      if (result.code === 0) return { ignored: true, settled: true };
      if (SETTLED_NOT_IGNORED.has(result.code)) return { ignored: false, settled: true };
      if (result.code === 128 && NOT_A_REPOSITORY.test(result.stderr ?? '')) return { ignored: false, settled: true };
      const firstLine = result.stderr?.split('\n', 1)[0] ?? '';
      return this.unsettled(fsPath, `git check-ignore exit ${result.code}: ${firstLine}`);
    } catch (err) {
      this.log(err);
      return UNSETTLED;
    }
  }

  /** Logs why a probe for `fsPath` could not be settled, and withholds the text for that computation. */
  private unsettled(fsPath: string, reason: string): ProbeResult {
    this.log(`${fsPath}: ${reason}`);
    return UNSETTLED;
  }

  /** Whether `files.exclude` hides the file; a failed or hung probe counts as excluded and is not cached. */
  private async isExcluded(uri: vscode.Uri): Promise<ProbeResult> {
    try {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) return { ignored: false, settled: true };
      const relative = path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).join('/');
      const found = await withTimeout(
        vscode.workspace.findFiles(new vscode.RelativePattern(folder, escapeGlob(relative)), undefined, 1),
        this.opts.excludeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
      );
      if (found === 'timeout') return this.unsettled(uri.fsPath, 'exclude probe timed out');
      return { ignored: found.length === 0, settled: true };
    } catch (err) {
      this.log(err);
      return UNSETTLED;
    }
  }
}
