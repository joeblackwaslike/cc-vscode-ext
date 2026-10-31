import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { PermissionDecision, PermissionRequest } from '../../lib/ipc';
import { renderMarkdown } from '../../lib/markdown';
import {
  ASK_DECLINE_MESSAGE,
  OTHER_LABEL,
  buildAskAnswerDecision,
  buildAskAnswers,
  isQuestionAnswered,
  ownValue,
  readAskQuestions,
} from '../../lib/permissions';
import type { QuestionSelection } from '../../lib/permissions';

const AUTO_ADVANCE_MS = 300;
const EMPTY_SELECTION: QuestionSelection = { selected: [], otherText: '' };

interface Props {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => void;
}

/** Tabbed AskUserQuestion form: radio/checkbox options, free-text "Other", previews and keyboard navigation. */
export function AskUserQuestionForm({ request, onDecision }: Props) {
  const questions = readAskQuestions(request.input);
  const [activeTab, setActiveTab] = useState(0);
  const [selections, setSelections] = useState<Record<string, QuestionSelection>>({});
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [folded, setFolded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const question = questions[activeTab];
  const selection = (question && ownValue(selections, question.question)) || EMPTY_SELECTION;
  const optionLabels = question ? [...question.options.map((o) => o.label), OTHER_LABEL] : [];
  const hasPreviews = !!question && !question.multiSelect && question.options.some((o) => o.preview);
  const otherSelected = selection.selected.includes(OTHER_LABEL);
  const allAnswered = questions.length > 0 && questions.every((q) => isQuestionAnswered(ownValue(selections, q.question)));
  const preview = hasPreviews ? question.options[focusedIndex]?.preview : undefined;

  useEffect(() => {
    if (!folded) panelRef.current?.querySelector<HTMLElement>('[role=radio],[role=checkbox]')?.focus();
  }, [activeTab, folded]);

  useEffect(() => {
    if (otherSelected) otherInputRef.current?.focus();
  }, [otherSelected]);

  function goToTab(index: number) {
    clearTimeout(advanceTimer.current);
    setConfirming(null);
    setFocusedIndex(0);
    setActiveTab(index);
  }

  function updateSelection(next: QuestionSelection) {
    if (!question) return;
    setSelections((prev) => ({ ...prev, [question.question]: next }));
  }

  function pick(label: string) {
    if (!question) return;
    if (question.multiSelect) {
      const selected = selection.selected.includes(label)
        ? selection.selected.filter((l) => l !== label)
        : [...selection.selected, label];
      updateSelection({ ...selection, selected });
      return;
    }
    updateSelection({ ...selection, selected: [label] });
    clearTimeout(advanceTimer.current);
    if (hasPreviews || label === OTHER_LABEL || activeTab >= questions.length - 1) return;
    setConfirming(label);
    advanceTimer.current = setTimeout(() => goToTab(activeTab + 1), AUTO_ADVANCE_MS);
  }

  function submit() {
    if (!allAnswered) return;
    onDecision(buildAskAnswerDecision(request.input, buildAskAnswers(questions, selections)));
  }

  function moveFocus(delta: number) {
    const items = panelRef.current?.querySelectorAll<HTMLElement>('[role=radio],[role=checkbox]');
    if (!items?.length) return;
    const current = Array.from(items).indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, current + delta))]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || !question) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const next = activeTab + (e.key === 'ArrowRight' ? 1 : -1);
      if (next >= 0 && next < questions.length) {
        e.preventDefault();
        goToTab(next);
      }
    } else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const label = optionLabels[Number(e.key) - 1];
      if (label) pick(label);
    } else if (e.key === 'Enter' && (target.getAttribute('role') === 'radio' || target.getAttribute('role') === 'checkbox')) {
      e.preventDefault();
      submit();
    }
  }

  const decline = () => onDecision({ behavior: 'deny', message: ASK_DECLINE_MESSAGE });

  return (
    <div className="cc-ask" onKeyDown={onKeyDown}>
      <div className="cc-ask-tabs" role="tablist">
        {questions.map((q, i) => (
          <button
            key={q.question}
            type="button"
            role="tab"
            aria-selected={i === activeTab}
            className={`cc-ask-tab${isQuestionAnswered(ownValue(selections, q.question)) ? ' cc-ask-tab--answered' : ''}`}
            onClick={() => goToTab(i)}
          >
            {q.header}
          </button>
        ))}
        <button type="button" className="cc-ask-fold" aria-label="Fold" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="cc-ask-close" aria-label="Decline" onClick={decline}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {!folded && question && (
        <div className="cc-ask-body" ref={panelRef}>
          <div className="cc-ask-question">{question.question}</div>
          <div className="cc-ask-options" role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.question}>
            {optionLabels.map((label, i) => {
              const checked = selection.selected.includes(label);
              const rawDescription = question.options[i]?.description;
              const description = rawDescription?.trim().toLowerCase() === label.trim().toLowerCase() ? undefined : rawDescription;
              return (
                <button
                  key={label}
                  type="button"
                  role={question.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={checked}
                  className={`cc-ask-option${checked ? ' cc-ask-option--selected' : ''}${confirming === label ? ' cc-ask-option--confirming' : ''}`}
                  onFocus={() => setFocusedIndex(i)}
                  onClick={() => pick(label)}
                >
                  <span className="cc-ask-option-label">{label}</span>
                  {description && <span className="cc-ask-option-description">{description}</span>}
                </button>
              );
            })}
          </div>
          {otherSelected && (
            <input
              ref={otherInputRef}
              className="cc-ask-other-input"
              type="text"
              placeholder="Type your answer…"
              value={selection.otherText}
              onChange={(e) => updateSelection({ ...selection, otherText: e.target.value })}
            />
          )}
          {preview && (
            <div className="cc-ask-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(preview) }} />
          )}
          <button type="button" className="cc-ask-submit" disabled={!allAnswered} onClick={submit}>
            Submit answers
          </button>
          <div className="cc-ask-hint">Esc to cancel</div>
        </div>
      )}
    </div>
  );
}
