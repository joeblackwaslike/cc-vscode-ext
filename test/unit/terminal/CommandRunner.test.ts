import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockVscode } from '../../helpers/mockVscode';

vi.mock('vscode', () => mockVscode);

import { CommandRunner, stripAnsi } from '../../../src/terminal/CommandRunner';
import type { ToWebviewMessage } from '../../../src/types/ipc';

// A 0ms shell-integration timeout drives every test down the fallback path
// (the mock terminal never reports shell integration).
const TIMEOUT = 0;

describe('stripAnsi', () => {
  it('removes CSI color/cursor sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
    expect(stripAnsi('\x1b[2J\x1b[Hcleared')).toBe('cleared');
  });

  it('removes OSC title sequences (BEL and ST terminated)', () => {
    expect(stripAnsi('\x1b]0;my title\x07done')).toBe('done');
    expect(stripAnsi('\x1b]0;t\x1b\\done')).toBe('done');
  });

  it('leaves plain text untouched', () => {
    expect(stripAnsi('hello world\n')).toBe('hello world\n');
  });
});

describe('CommandRunner (fallback path)', () => {
  let posted: ToWebviewMessage[];
  let mockTerminal: { show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> };

  const collect = (m: ToWebviewMessage) => {
    posted.push(m);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    posted = [];
    mockTerminal = { show: vi.fn(), sendText: vi.fn() };
    mockVscode.window.createTerminal.mockReturnValue(mockTerminal);
    mockVscode.workspace.workspaceFolders = undefined;
  });

  it('opens a dedicated "Clawd Code Run" terminal and shows it', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'hi\n', stderr: '' });
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    await runner.run('e1', 'echo hi');
    expect(mockVscode.window.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Clawd Code Run' }),
    );
    expect(mockTerminal.show).toHaveBeenCalled();
  });

  it('streams captured stdout and a clean exit code', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: 'hi\n', stderr: '' });
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    await runner.run('e1', 'echo hi');
    expect(execFn).toHaveBeenCalledWith('echo hi', {});
    expect(posted).toContainEqual({ type: 'run_command_output', execId: 'e1', chunk: 'hi\n', stream: 'stdout' });
    expect(posted).toContainEqual({ type: 'run_command_done', execId: 'e1', exitCode: 0 });
  });

  it('posts a non-executing comment banner to the terminal (no double run)', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    await runner.run('e1', 'rm -rf build');
    expect(mockTerminal.sendText).toHaveBeenCalledWith('# (ran via fallback)\n# rm -rf build');
  });

  it('comments EVERY line of a multi-line command so none execute live', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    await runner.run('e1', 'echo one\nrm -rf x\necho two');
    const sent = mockTerminal.sendText.mock.calls[0]?.[0] as string;
    // No line may reach the shell as a live (uncommented) command.
    for (const line of sent.split('\n')) {
      expect(line.startsWith('#')).toBe(true);
    }
  });

  it('captures stderr and a non-zero exit code on failure', async () => {
    const execFn = vi.fn().mockRejectedValue({ stdout: '', stderr: 'no such file\n', code: 2 });
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    await runner.run('e1', 'ls /nope');
    expect(posted).toContainEqual({ type: 'run_command_output', execId: 'e1', chunk: 'no such file\n', stream: 'stderr' });
    expect(posted).toContainEqual({ type: 'run_command_done', execId: 'e1', exitCode: 2 });
  });

  it('passes the resolved cwd through to execFn', async () => {
    const execFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    await runner.run('e1', 'pwd', '/my/project');
    expect(execFn).toHaveBeenCalledWith('pwd', { cwd: '/my/project' });
  });

  it('rejects a second concurrent run while one is in flight', async () => {
    let release: (v: { stdout: string; stderr: string }) => void = () => {};
    const execFn = vi.fn(
      () => new Promise<{ stdout: string; stderr: string }>((res) => { release = res; }),
    );
    const runner = new CommandRunner(collect, execFn, TIMEOUT);
    const first = runner.run('e1', 'sleep 1');
    // Let e1 advance past the SI timeout into its in-flight exec.
    await new Promise((r) => setTimeout(r, 5));
    expect(execFn).toHaveBeenCalledTimes(1);
    await runner.run('e2', 'echo hi'); // hits the busy guard
    expect(posted).toContainEqual({ type: 'run_command_done', execId: 'e2', exitCode: undefined });
    expect(execFn).toHaveBeenCalledTimes(1); // e2 did not execute
    release({ stdout: '', stderr: '' });
    await first;
  });
});

describe('CommandRunner (shell-integration path)', () => {
  let posted: ToWebviewMessage[];
  const collect = (m: ToWebviewMessage) => {
    posted.push(m);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    posted = [];
    mockVscode.workspace.workspaceFolders = undefined;
  });

  it('streams executeCommand output (ANSI-stripped) and the exit code', async () => {
    const execution = {
      read: async function* () {
        yield 'line1\n';
        yield '\x1b[32mgreen\x1b[0m line2\n'; // color codes must be stripped
      },
    };
    const shellIntegration = { executeCommand: vi.fn(() => execution) };
    const mockTerminal = { show: vi.fn(), sendText: vi.fn(), shellIntegration };
    mockVscode.window.createTerminal.mockReturnValue(mockTerminal);
    // Fire the end event synchronously with our execution + a clean exit code.
    mockVscode.window.onDidEndTerminalShellExecution.mockImplementation(
      (listener: (e: { execution: unknown; exitCode: number }) => void) => {
        listener({ execution, exitCode: 0 });
        return { dispose: vi.fn() };
      },
    );
    const execFn = vi.fn();

    const runner = new CommandRunner(collect, execFn);
    await runner.run('e1', 'echo hi');

    expect(shellIntegration.executeCommand).toHaveBeenCalledWith('echo hi');
    expect(execFn).not.toHaveBeenCalled(); // fallback must NOT run
    expect(posted).toContainEqual({ type: 'run_command_output', execId: 'e1', chunk: 'line1\n', stream: 'stdout' });
    expect(posted).toContainEqual({ type: 'run_command_output', execId: 'e1', chunk: 'green line2\n', stream: 'stdout' });
    expect(posted).toContainEqual({ type: 'run_command_done', execId: 'e1', exitCode: 0 });
  });
});
