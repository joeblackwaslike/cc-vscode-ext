import { useEffect, useState } from 'react';
import type { ToolUseBlock } from '../lib/conversationModel';
import { OTHER_LABEL, deriveAskStatus, ownValue, parseAskAnswers, readAskQuestions } from '../lib/permissions';
import type { AskQuestion, AskStatus } from '../lib/permissions';
import { useChannelPermissions } from '../store/sessionStore';

const STATUS_WORD: Record<AskStatus, string | undefined> = {
  answered: 'Answered',
  declined: 'Declined',
  'no-answer': 'No answer',
  'session-ended': 'Session ended',
  pending: 'Waiting for answer',
};

/**
 * Splits a flattened answer back into chosen option labels and typed "Other" text.
 * A single-select answer is one value: either exactly an option label or typed text.
 * A multi-select answer is `", "`-joined, so known labels are consumed longest first
 * (labels may themselves contain commas); anything between them is typed text. A typed
 * answer that spells out `, <option label>` stays ambiguous because only the flattened
 * string is stored.
 */
export function splitAnswer(answer: string, question: AskQuestion) {
  if (answer === '') return { selected: [] as string[], typed: '' };
  const labels = question.options.map((o) => o.label);
  if (!question.multiSelect) {
    return labels.includes(answer) ? { selected: [answer], typed: '' } : { selected: [] as string[], typed: answer };
  }
  const byLength = [...labels].sort((a, b) => b.length - a.length);
  const startsWithLabel = (s: string) => byLength.find((l) => s === l || s.startsWith(`${l}, `));
  const selected: string[] = [];
  const typed: string[] = [];
  let rest = answer;
  while (rest !== '') {
    const hit = startsWithLabel(rest);
    if (hit) {
      selected.push(hit);
      rest = rest === hit ? '' : rest.slice(hit.length + 2);
      continue;
    }
    let cut = -1;
    for (let i = rest.indexOf(', '); i >= 0; i = rest.indexOf(', ', i + 1)) {
      if (startsWithLabel(rest.slice(i + 2))) {
        cut = i;
        break;
      }
    }
    typed.push(cut < 0 ? rest : rest.slice(0, cut));
    rest = cut < 0 ? '' : rest.slice(cut + 2);
  }
  return { selected, typed: typed.join(', ') };
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
            const answer = ownValue(answers, q.question);
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
