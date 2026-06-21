import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { postMessage } from '../lib/ipc';
import { useMessages } from '../hooks/useMessages';

/** Buffered output for one inline command run, keyed by execId. */
export interface RunOutputState {
  chunks: { stream: 'stdout' | 'stderr'; text: string }[];
  exitCode?: number;
  running: boolean;
}

interface RunOutputContextValue {
  outputs: Map<string, RunOutputState>;
  /** Posts a `run_command` and returns the execId correlating its output. */
  runCommand: (command: string) => string;
}

const RunOutputContext = createContext<RunOutputContextValue | null>(null);

/**
 * Holds all inline command outputs in one map and registers a single message
 * subscription for the streamed `run_command_output` / `run_command_done`
 * events. State lives here (not in the per-block panel) so it survives the
 * `dangerouslySetInnerHTML` rebuilds that occur while an assistant message
 * streams — the output panels are disposable portal views keyed by execId.
 */
export function RunOutputProvider({ children }: { children: ReactNode }) {
  const [outputs, setOutputs] = useState<Map<string, RunOutputState>>(() => new Map());

  useMessages(
    useCallback((msg) => {
      if (msg.type === 'run_command_output') {
        setOutputs((prev) => {
          const next = new Map(prev);
          const cur = next.get(msg.execId) ?? { chunks: [], running: true };
          next.set(msg.execId, {
            ...cur,
            chunks: [...cur.chunks, { stream: msg.stream, text: msg.chunk }],
          });
          return next;
        });
      } else if (msg.type === 'run_command_done') {
        setOutputs((prev) => {
          const next = new Map(prev);
          const cur = next.get(msg.execId) ?? { chunks: [], running: false };
          next.set(msg.execId, {
            ...cur,
            running: false,
            ...(msg.exitCode !== undefined ? { exitCode: msg.exitCode } : {}),
          });
          return next;
        });
      }
    }, []),
  );

  const runCommand = useCallback((command: string): string => {
    const execId = crypto.randomUUID();
    setOutputs((prev) => new Map(prev).set(execId, { chunks: [], running: true }));
    postMessage({ type: 'run_command', execId, command });
    return execId;
  }, []);

  return (
    <RunOutputContext.Provider value={{ outputs, runCommand }}>
      {children}
    </RunOutputContext.Provider>
  );
}

export function useRunOutputs(): RunOutputContextValue {
  const ctx = useContext(RunOutputContext);
  if (!ctx) throw new Error('useRunOutputs must be used within a RunOutputProvider');
  return ctx;
}
