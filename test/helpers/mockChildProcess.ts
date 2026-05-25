/**
 * Mock child_process.spawn for unit tests.
 *
 * Usage:
 *   vi.mock('child_process', () => ({ spawn: mockSpawn }));
 *
 * The returned mock process exposes:
 *   - stdin.write / stdin.end  (writable side)
 *   - stdout.on / stdout.emit  (readable side — emit 'data' to feed the parser)
 *   - stderr.on
 *   - kill / on / emit         (process-level events)
 */
import { vi } from 'vitest';
import { EventEmitter } from 'events';

export interface MockChildProcess {
  pid: number;
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    writable: boolean;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => boolean;
  /** Simulate the process emitting a line of NDJSON on stdout. */
  emitStdout(line: string): void;
  /** Simulate the process exiting. */
  emitClose(code: number): void;
  /** Simulate an error event. */
  emitError(err: Error): void;
}

export function createMockProcess(pid = 12345): MockChildProcess {
  const processEmitter = new EventEmitter();
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  const proc: MockChildProcess = {
    pid,
    stdin: {
      write: vi.fn((_data: unknown, cb?: (err?: Error | null) => void) => { cb?.(); return true; }),
      end: vi.fn(),
      writable: true,
    },
    stdout: stdoutEmitter,
    stderr: stderrEmitter,
    kill: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      processEmitter.on(event, listener);
      return proc;
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      processEmitter.off(event, listener);
      return proc;
    }),
    emit: (event: string, ...args: unknown[]) => processEmitter.emit(event, ...args),
    emitStdout(line: string) {
      stdoutEmitter.emit('data', Buffer.from(line + '\n'));
    },
    emitClose(code: number) {
      processEmitter.emit('close', code);
    },
    emitError(err: Error) {
      processEmitter.emit('error', err);
    },
  };

  return proc;
}

/** Returns a vi.fn() that acts as spawn(), returning the given mock process. */
export function createMockSpawn(proc?: MockChildProcess) {
  const mockProcess = proc ?? createMockProcess();
  return { spawn: vi.fn(() => mockProcess), mockProcess };
}
