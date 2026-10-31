import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { PermissionDecision, PermissionRequest } from '../../lib/ipc';
import { buildExitPlanDecision, exitPlanAutoLabel, formatPlanFeedback } from '../../lib/permissions';
import type { ExitPlanChoice, PlanComment } from '../../lib/permissions';

const QUOTE_MAX = 80;
const CHOICE_BY_KEY: Record<string, ExitPlanChoice> = { '1': 'auto', '2': 'manual', '3': 'keep-planning' };

interface Props {
  request: PermissionRequest;
  comments: PlanComment[];
  onRemoveComment: (id: string) => void;
  onDecision: (decision: PermissionDecision) => void;
}

function truncate(quote: string): string {
  return quote.length > QUOTE_MAX ? `${quote.slice(0, QUOTE_MAX)}…` : quote;
}

/** ExitPlanMode approval card: auto, manual or keep planning (with plan comments and free-text feedback). */
export function PlanApproval({ request, comments, onRemoveComment, onDecision }: Props) {
  const [feedback, setFeedback] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const hasFeedback = comments.length > 0 || feedback.trim() !== '';

  useEffect(() => { rootRef.current?.focus(); }, []);

  function choose(choice: ExitPlanChoice) {
    onDecision(buildExitPlanDecision(choice, request, formatPlanFeedback(comments, feedback)));
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const choice = CHOICE_BY_KEY[e.key];
    if (!choice || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    choose(choice);
  }

  return (
    <div className="cc-plan-approval" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="cc-plan-approval-title">{comments.length > 0 ? 'Continue planning' : 'Accept this plan?'}</div>
      <div className="cc-plan-approval-description">
        {comments.length === 0
          ? 'Select text in the preview to add comments'
          : `${comments.length === 1 ? '1 comment' : `${comments.length} comments`} will be included as feedback`}
      </div>
      {comments.length > 0 && (
        <div className="cc-plan-approval-comments">
          {comments.map((c) => (
            <div key={c.id} className="cc-plan-approval-comment">
              <span className="cc-plan-approval-quote">{truncate(c.quote)}</span>
              <span className="cc-plan-approval-comment-text">{c.text}</span>
              <button type="button" aria-label="Remove comment" onClick={() => onRemoveComment(c.id)}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="cc-plan-approval-options">
        <button type="button" onClick={() => choose('auto')}>
          <span className="cc-plan-approval-index">1</span> {exitPlanAutoLabel(request.priorMode)}
        </button>
        <button type="button" onClick={() => choose('manual')}>
          <span className="cc-plan-approval-index">2</span> Yes, and manually approve edits
        </button>
        <button type="button" onClick={() => choose('keep-planning')}>
          <span className="cc-plan-approval-index">3</span> {hasFeedback ? 'Send feedback and keep planning' : 'No, keep planning'}
        </button>
      </div>
      <input
        type="text"
        className="cc-plan-approval-feedback"
        aria-label="Feedback"
        placeholder="Tell Claude what to change"
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
      />
    </div>
  );
}
