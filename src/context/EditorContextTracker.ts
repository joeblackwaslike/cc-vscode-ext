import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionSettings } from '../settings/ExtensionSettings';
import type { IdeContext, IdeSelection } from '../shared/ideTags';

/** Runs a command and resolves with its exit code. */
export type ExecFn = (cmd: string, args: string[], cwd: string) => Promise<{ code: number }>;

const DEFAULT_GIT_TIMEOUT_MS = 5000;

/** `ExecFn` over `child_process.execFile`; spawn failures and kills resolve with code -1. */
export const execFileCode: ExecFn = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: DEFAULT_GIT_TIMEOUT_MS }, (err) => {
      if (!err) return resolve({ code: 0 });
      resolve({ code: typeof err.code === 'number' ? err.code : -1 });
    });
  });

export interface EditorContextTrackerOptions {
  settings: Pick<ExtensionSettings, 'getAttachOpenFile' | 'getAttachSelection' | 'getRespectGitIgnore'>;
  exec: ExecFn;
  onChange: (ctx: IdeContext | null) => void;
  debounceMs?: number;
  /** How long `git check-ignore` may run before the file counts as not git-ignored. */
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
    x?.text === y?.text
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
        if (this.editor?.document !== doc) return;
        this.editor = undefined;
        this.schedule();
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
      this.opts.log?.(`EditorContextTracker: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (this.disposed || generation !== this.generation || sameContext(next, this.value)) return;
    this.value = next;
    this.opts.onChange(next);
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
      selection.text = editor.document.getText(sel);
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
    if (git.timedOut) this.ignored.delete(uri.fsPath);
    return git.ignored || excluded;
  }

  private async isGitIgnored(fsPath: string): Promise<{ ignored: boolean; timedOut: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.opts.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([
        this.opts.exec('git', ['check-ignore', '-q', fsPath], path.dirname(fsPath)),
        timeout,
      ]);
      if (result === 'timeout') return { ignored: false, timedOut: true };
      return { ignored: result.code === 0, timedOut: false };
    } catch {
      return { ignored: false, timedOut: false };
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
    } catch {
      return true;
    }
  }
}
