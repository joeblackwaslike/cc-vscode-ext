import { useState } from 'react';
import { useRunOutputs } from './RunOutputContext';

const COLLAPSE_AT = 15;

/**
 * Inline output panel for a run command, mounted via a portal directly under its
 * code block. Mirrors {@link ToolResult}'s collapse behaviour. Renders nothing
 * until its execId has state (i.e. the user has clicked Run).
 */
export function CommandOutput({ execId }: { execId: string }) {
  const { outputs } = useRunOutputs();
  const [expanded, setExpanded] = useState(false);
  const state = outputs.get(execId);
  if (!state) return null;

  const text = state.chunks.map((c) => c.text).join('');
  const lines = text.replace(/\n$/, '').split('\n');
  const overflow = lines.length > COLLAPSE_AT;
  const shown = expanded ? lines : lines.slice(0, COLLAPSE_AT);
  const isError = state.exitCode !== undefined && state.exitCode !== 0;

  const header = state.running
    ? 'Running…'
    : state.exitCode === undefined
      ? 'Done'
      : `exit ${state.exitCode}`;

  return (
    <div className={`cc-tool__out cc-cmd-out${isError ? ' cc-tool__out--error' : ''}`}>
      <div className={`cc-cmd-out__hd${isError ? ' cc-cmd-out__hd--err' : ''}`}>{header}</div>
      <pre className="cc-tool__text">{shown.join('\n')}</pre>
      {overflow && (
        <button className="cc-tool__collapse" onClick={() => setExpanded((e) => !e)}>
          {expanded ? '▾ Show less' : `▸ Show ${lines.length - COLLAPSE_AT} more lines`}
        </button>
      )}
    </div>
  );
}
