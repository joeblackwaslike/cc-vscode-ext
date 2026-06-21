import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import type { ToWebviewMessage } from '../types/ipc';

const execAsync = promisify(exec);

type ExecFn = (
  cmd: string,
  opts?: { cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

type PostFn = (msg: ToWebviewMessage) => void;

/** Thrown-exec errors carry the captured streams + exit code on the error object. */
interface ExecError {
  stdout?: string;
  stderr?: string;
  code?: number;
  message?: string;
}

const TERMINAL_NAME = 'Claw Code Run';
const SHELL_INTEGRATION_TIMEOUT_MS = 5000;

/**
 * Strips ANSI CSI/SGR and OSC escape sequences from shell-integration output.
 * The `execution.read()` stream is raw terminal data — cursor moves, color
 * codes, and title-setting OSC sequences — which we don't want in the panel.
 */
export function stripAnsi(text: string): string {
  /* eslint-disable no-control-regex */
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') // CSI ... final byte
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC ... BEL/ST terminated
    .replace(/\x1b[@-Z\\-_]/g, ''); // lone two-byte escapes
  /* eslint-enable no-control-regex */
}

/**
 * Runs a shell command from a code block's play button.
 *
 * Primary path: a real, visible integrated terminal via the shell-integration
 * API (`shellIntegration.executeCommand` + `execution.read()`), so the user
 * sees the command run AND its output streams into the inline panel.
 *
 * Fallback (shell integration unavailable within the timeout): capture via
 * `child_process.exec` and stream the buffered result, plus a comment banner in
 * the terminal for visibility — never a live re-run (avoids double side effects).
 *
 * `execFn` is injectable so the fallback path is unit-testable, mirroring
 * {@link ../worktree/WorktreeManager}.
 */
export class CommandRunner {
  private terminal: vscode.Terminal | undefined;
  private terminalCwd: string | undefined;
  private busy = false;

  constructor(
    private readonly post: PostFn,
    private readonly execFn: ExecFn = execAsync,
    private readonly shellIntegrationTimeoutMs: number = SHELL_INTEGRATION_TIMEOUT_MS,
  ) {}

  async run(execId: string, command: string, cwd?: string): Promise<void> {
    if (this.busy) {
      this.post({
        type: 'run_command_output',
        execId,
        chunk: 'A command is already running — wait for it to finish.\n',
        stream: 'stderr',
      });
      this.post({ type: 'run_command_done', execId, exitCode: undefined });
      return;
    }
    this.busy = true;
    const disposables: vscode.Disposable[] = [];
    try {
      const resolvedCwd = cwd ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const terminal = this.getTerminal(resolvedCwd);
      terminal.show();

      const shellIntegration = await this.waitForShellIntegration(terminal, disposables);
      if (shellIntegration) {
        await this.runWithShellIntegration(execId, command, shellIntegration, disposables);
      } else {
        await this.runFallback(execId, command, terminal, resolvedCwd);
      }
    } catch (err) {
      this.post({
        type: 'run_command_output',
        execId,
        chunk: err instanceof Error ? err.message : String(err),
        stream: 'stderr',
      });
      this.post({ type: 'run_command_done', execId, exitCode: 1 });
    } finally {
      this.busy = false;
      for (const d of disposables) d.dispose();
    }
  }

  /**
   * Reuse a single dedicated terminal; recreate it after the user closes it, or
   * when the requested cwd changes. Recreating on cwd change keeps the
   * shell-integration path consistent with the fallback path, which always runs
   * `execFn` in `resolvedCwd` — without this, a reused terminal would keep its
   * original cwd while the fallback honoured the new one.
   */
  private getTerminal(cwd?: string): vscode.Terminal {
    if (this.terminal && this.terminalCwd === cwd) return this.terminal;
    if (this.terminal) this.terminal.dispose();
    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      ...(cwd !== undefined ? { cwd } : {}),
    });
    const closeSub = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === terminal) {
        this.terminal = undefined;
        this.terminalCwd = undefined;
        closeSub.dispose();
      }
    });
    this.terminal = terminal;
    this.terminalCwd = cwd;
    return terminal;
  }

  /**
   * Resolves to the terminal's shell integration once available, or `undefined`
   * if it doesn't materialize within the timeout (→ fallback path).
   */
  private waitForShellIntegration(
    terminal: vscode.Terminal,
    disposables: vscode.Disposable[],
  ): Promise<vscode.TerminalShellIntegration | undefined> {
    if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), this.shellIntegrationTimeoutMs);
      const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === terminal) {
          clearTimeout(timer);
          resolve(e.shellIntegration);
        }
      });
      disposables.push(sub, { dispose: () => clearTimeout(timer) });
    });
  }

  private async runWithShellIntegration(
    execId: string,
    command: string,
    shellIntegration: vscode.TerminalShellIntegration,
    disposables: vscode.Disposable[],
  ): Promise<void> {
    const execution = shellIntegration.executeCommand(command);
    const exitCode = new Promise<number | undefined>((resolve) => {
      const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === execution) resolve(e.exitCode);
      });
      disposables.push(sub);
    });

    // Shell integration delivers a single combined stream — post it all as stdout.
    for await (const raw of execution.read()) {
      const chunk = stripAnsi(raw);
      if (chunk) this.post({ type: 'run_command_output', execId, chunk, stream: 'stdout' });
    }
    this.post({ type: 'run_command_done', execId, exitCode: await exitCode });
  }

  private async runFallback(
    execId: string,
    command: string,
    terminal: vscode.Terminal,
    cwd?: string,
  ): Promise<void> {
    // Visibility only — the captured output already streams to the panel, so we
    // must NOT execute the command a second time. Comment out EVERY line:
    // sendText preserves newlines, so a single `#` prefix would leave a
    // multi-line command's later lines to run live in the terminal.
    const banner = command
      .split(/\r?\n/)
      .map((line) => `# ${line}`)
      .join('\n');
    terminal.sendText(`# (ran via fallback)\n${banner}`);
    try {
      const { stdout, stderr } = await this.execFn(command, cwd !== undefined ? { cwd } : {});
      if (stdout) this.post({ type: 'run_command_output', execId, chunk: stdout, stream: 'stdout' });
      if (stderr) this.post({ type: 'run_command_output', execId, chunk: stderr, stream: 'stderr' });
      this.post({ type: 'run_command_done', execId, exitCode: 0 });
    } catch (err) {
      const e = err as ExecError;
      if (e.stdout) this.post({ type: 'run_command_output', execId, chunk: e.stdout, stream: 'stdout' });
      const errText = e.stderr || e.message || String(err);
      this.post({ type: 'run_command_output', execId, chunk: errText, stream: 'stderr' });
      this.post({ type: 'run_command_done', execId, exitCode: typeof e.code === 'number' ? e.code : 1 });
    }
  }
}
