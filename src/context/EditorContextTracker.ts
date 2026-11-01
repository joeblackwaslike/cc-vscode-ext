import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionSettings } from '../settings/ExtensionSettings';
import type { IdeContext, IdeSelection } from '../shared/ideTags';

/** Runs a command and resolves with its exit code. */
export type ExecFn = (cmd: string, args: string[], cwd: string) => Promise<{ code: number }>;

/** `ExecFn` over `child_process.execFile`; spawn failures resolve with code -1. */
export const execFileCode: ExecFn = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd }, (err) => {
      if (!err) return resolve({ code: 0 });
      resolve({ code: typeof err.code === 'number' ? err.code : -1 });
    });
  });

export interface EditorContextTrackerOptions {
  settings: Pick<ExtensionSettings, 'getAttachOpenFile' | 'getAttachSelection' | 'getRespectGitIgnore'>;
  exec: ExecFn;
  onChange: (ctx: IdeContext | null) => void;
  debounceMs?: number;
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
        if (e.affectsConfiguration('files.exclude')) this.ignored.clear();
        if (e.affectsConfiguration('files.exclude') || WATCHED_SETTINGS.some((s) => e.affectsConfiguration(s))) {
          this.schedule();
        }
      }),
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
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }

  private track(editor: vscode.TextEditor): void {
    this.editor = editor;
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.opts.debounceMs ?? 300);
  }

  private async flush(): Promise<void> {
    const generation = ++this.generation;
    const next = await this.compute(this.editor);
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
    const dir = path.dirname(uri.fsPath);
    const gitIgnored = this.opts
      .exec('git', ['check-ignore', '-q', uri.fsPath], dir)
      .then(({ code }) => code === 0, () => false);
    const excluded = vscode.workspace.getWorkspaceFolder(uri)
      ? Promise.resolve(
          vscode.workspace.findFiles(new vscode.RelativePattern(dir, path.basename(uri.fsPath)), undefined, 1)
        ).then((found) => found.length === 0, () => false)
      : Promise.resolve(false);
    const [ignored, hidden] = await Promise.all([gitIgnored, excluded]);
    return ignored || hidden;
  }
}
