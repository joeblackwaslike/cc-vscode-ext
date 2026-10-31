import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { ToolUseBlock } from '../lib/conversationModel';
import { postMessage } from '../lib/ipc';
import { renderMarkdown } from '../lib/markdown';
import { deriveExitPlanStatus } from '../lib/permissions';
import type { ExitPlanStatus } from '../lib/permissions';
import { useChannelPermissions } from '../store/sessionStore';

const RESULT_LINE: Record<ExitPlanStatus, string | undefined> = {
  approved: 'User approved the plan',
  stayed: 'Stayed in plan mode',
  'session-ended': 'Session ended',
  pending: undefined,
};

interface PendingComment { quote: string }

/** Transcript view of an ExitPlanMode call: the plan, a link to its file, selection comments and the outcome. */
export function ExitPlanModeBlock({ tool, channelId, running }: { tool: ToolUseBlock; channelId: string; running: boolean }) {
  const { permissions, dispatch } = useChannelPermissions(channelId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<PendingComment | null>(null);
  const [text, setText] = useState('');

  const request = permissions.pending.find((r) => r.toolUseId === tool.id);
  const pending = request !== undefined;
  const status = deriveExitPlanStatus({ ...(tool.result && { result: tool.result }), pending, running });
  // Streamed tool-use arguments can be incomplete; the pending request carries the full input.
  const field = (key: string) => {
    const own = tool.input[key];
    if (typeof own === 'string') return own;
    const fromRequest = request?.input[key];
    return typeof fromRequest === 'string' ? fromRequest : '';
  };
  const plan = field('plan');
  const planFilePath = field('planFilePath');
  const fileName = planFilePath.split(/[\\/]/).pop();
  const resultLine = RESULT_LINE[status];

  function onMouseUp(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.cc-plan-block-popover')) return;
    const sel = window.getSelection();
    const quote = sel?.toString().trim() ?? '';
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!quote || !range) {
      setDraft(null);
      return;
    }
    if (!pending || !dispatch || !bodyRef.current?.contains(range.commonAncestorContainer)) return;
    setDraft({ quote });
    setText('');
  }

  function submit() {
    if (!dispatch || !draft || !text.trim()) return;
    dispatch({
      type: 'COMMENT_ADDED',
      channelId,
      toolUseId: tool.id,
      comment: { id: crypto.randomUUID(), quote: draft.quote, text: text.trim() },
    });
    setDraft(null);
  }

  return (
    <div className="cc-plan-block" data-testid="exit-plan-mode-block">
      <div className="cc-plan-block-header">
        <span className="cc-plan-block-title">{plan ? "Claude's Plan" : 'Plan Mode'}</span>
        {fileName && (
          <a
            href="#"
            className="cc-plan-block-file"
            onClick={(e) => {
              e.preventDefault();
              postMessage({ type: 'open_file', filePath: planFilePath });
            }}
          >
            {fileName}
          </a>
        )}
      </div>
      {plan && (
        <div
          ref={bodyRef}
          className="cc-plan-block-body cc-markdown"
          onMouseUp={onMouseUp}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(plan) }}
        />
      )}
      {pending && draft && (
        <div className="cc-plan-block-popover">
          <input
            type="text"
            aria-label="Comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(null);
              }
            }}
            autoFocus
          />
          <button type="button" onClick={submit}>Add comment</button>
          <button type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}
      {resultLine && <div className="cc-plan-block-result">{resultLine}</div>}
    </div>
  );
}
