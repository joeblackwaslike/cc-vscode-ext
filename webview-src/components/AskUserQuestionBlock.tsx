import { useEffect, useState } from 'react';
import type { ToolUseBlock } from '../lib/conversationModel';
import { OTHER_LABEL, deriveAskStatus, parseAskAnswers, readAskQuestions } from '../lib/permissions';
import type { AskQuestion, AskStatus } from '../lib/permissions';
import { useChannelPermissions } from '../store/sessionStore';

const STATUS_WORD: Record<AskStatus, string | undefined> = {
  answered: 'Answered',
  declined: 'Declined',
  'no-answer': 'No answer',
  'session-ended': 'Session ended',
  pending: 'Waiting for answer',
};

function splitAnswer(answer: string, question: AskQuestion) {
  const labels = new Set(question.options.map((o) => o.label));
  const tokens = answer === '' ? [] : answer.split(', ');
  const selected = tokens.filter((t) => labels.has(t));
  const typed = tokens.filter((t) => !labels.has(t)).join(', ');
  return { selected, typed };
}

/** Transcript review of an AskUserQuestion call: the questions, the chosen options and a status. */
export function AskUserQuestionBlock({ tool, channelId, running }: { tool: ToolUseBlock; channelId: string; running: boolean }) {
  const { permissions } = useChannelPermissions(channelId);
  const pending = permissions.pending.some((r) => r.toolUseId === tool.id);
  const status = deriveAskStatus({
    ...(tool.result && { result: tool.result }),
    pending,
    running,
    cancelled: permissions.decisions[tool.id] === 'cancelled',
  });
  const [expanded, setExpanded] = useState(status === 'pending');
  useEffect(() => {
    if (status === 'pending') setExpanded(true);
  }, [status]);

  const questions = readAskQuestions(tool.input);
  const answers =
    permissions.answers[tool.id] ?? (tool.result && !tool.result.isError ? parseAskAnswers(tool.result.text, questions) : {});
  const count = `${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`;
  const statusWord = STATUS_WORD[status];

  return (
    <div className="cc-ask-block" data-testid="ask-user-question-block">
      <button type="button" className="cc-ask-block-header" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
        <span className="cc-ask-block-title">{questions.length === 1 ? 'Question' : 'Questions'}</span>
        <span className="cc-ask-block-status">
          {statusWord ? `${statusWord} · ${count}` : count}
          <svg className="cc-ask-block-chevron" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="cc-ask-block-body">
          {questions.map((q) => {
            const answer = answers[q.question];
            const { selected, typed } = answer === undefined ? { selected: [], typed: '' } : splitAnswer(answer, q);
            const role = q.multiSelect ? 'checkbox' : 'radio';
            const options = [...q.options.map((o) => o.label), OTHER_LABEL];
            const anyChosen = selected.length > 0 || typed !== '';
            return (
              <div key={q.question} className="cc-ask-block-question">
                <div className="cc-ask-block-question-text">{q.question}</div>
                <div className="cc-ask-block-options" role={q.multiSelect ? 'group' : 'radiogroup'}>
                  {options.map((label, i) => {
                    const checked = label === OTHER_LABEL ? typed !== '' : selected.includes(label);
                    const rawDescription = q.options[i]?.description;
                    const description = rawDescription?.trim().toLowerCase() === label.trim().toLowerCase() ? undefined : rawDescription;
                    const state = checked ? ' cc-ask-block-option--selected' : anyChosen ? ' cc-ask-block-option--dim' : '';
                    return (
                      <div key={label} role={role} aria-checked={checked} className={`cc-ask-block-option${state}`}>
                        <span className="cc-ask-block-option-label">
                          {label}
                          {label === OTHER_LABEL && typed !== '' && <span className="cc-ask-typed-answer">{typed}</span>}
                        </span>
                        {description && <span className="cc-ask-block-option-description">{description}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
