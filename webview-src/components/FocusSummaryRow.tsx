import { ToolCall } from './ToolCall';
import type { ToolUseBlock } from '../lib/conversationModel';

interface Props {
  tools: ToolUseBlock[];
  /** True only when this group belongs to the actively-streaming turn. */
  running: boolean;
  expanded: boolean;
  onToggle: () => void;
}

/** Collapsed summary for a folded run of routine tool calls, expandable to the real ToolCall list. */
export function FocusSummaryRow({ tools, running, expanded, onToggle }: Props) {
  const last = tools[tools.length - 1];
  const isRunning = running && last !== undefined && !last.result;
  const names = tools.map((t) => t.name).join(', ');
  const summary = isRunning
    ? `Running ${last.name}…`
    : `Used ${tools.length} tool(s) (${names})`;

  return (
    <div className="cc-focus-group" data-testid="focus-summary-row">
      <button
        type="button"
        className="cc-focus-group__toggle"
        onClick={onToggle}
        data-testid="focus-summary-toggle"
      >
        <span className="cc-focus-group__chev">{expanded ? '▾' : '▸'}</span>
        <span>{summary}</span>
      </button>
      {expanded && (
        <div className="cc-focus-group__body">
          {tools.map((tool, i) => (
            <ToolCall key={tool.id || i} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
