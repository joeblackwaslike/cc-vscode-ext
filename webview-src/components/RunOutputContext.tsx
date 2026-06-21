import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { postMessage } from '../lib/ipc';
import { useMessages } from '../hooks/useMessages';

/** Buffered output for one inline command run, keyed by execId. */
export interface RunOutputState {
  chunks: { stream: 'stdout' | 'stderr'; text: string }[];
  exitCode?: number;
  running: boolean;
}

// Two contexts so that components which only run commands (MarkdownText) don't
// re-render on every streamed output chunk — only the output panels do. The
// runCommand reference is stable; the outputs map changes per chunk.
const OutputsContext = createContext<Map<string, RunOutputState> | null>(null);
const RunCommandContext = createContext<((command: string) => string) | null>(null);

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
    <RunCommandContext.Provider value={runCommand}>
      <OutputsContext.Provider value={outputs}>{children}</OutputsContext.Provider>
    </RunCommandContext.Provider>
  );
}

/** The stable command runner — does not change as output streams in. */
export function useRunCommand(): (command: string) => string {
  const ctx = useContext(RunCommandContext);
  if (!ctx) throw new Error('useRunCommand must be used within a RunOutputProvider');
  return ctx;
}

/** The output map — changes per streamed chunk. */
export function useOutputs(): Map<string, RunOutputState> {
  const ctx = useContext(OutputsContext);
  if (!ctx) throw new Error('useOutputs must be used within a RunOutputProvider');
  return ctx;
}
