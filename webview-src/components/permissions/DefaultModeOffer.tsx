import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { PermissionMode } from '../../lib/ipc';

interface Props {
  mode: PermissionMode;
  currentDefault: PermissionMode;
  onAnswer: (accept: boolean) => void;
}

/** Offers to save the mode just approved as the default; Escape counts as No. */
export function DefaultModeOffer({ mode, currentDefault, onAnswer }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { rootRef.current?.focus(); }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') onAnswer(false);
    else if (e.key === '1') onAnswer(true);
    else if (e.key === '2') onAnswer(false);
    else return;
    e.preventDefault();
  }

  return (
    <div className="cc-plan-approval" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="cc-plan-approval-title">{`Set ${mode} as your default mode?`}</div>
      <div className="cc-plan-approval-options">
        <button type="button" onClick={() => onAnswer(true)}>
          <span className="cc-plan-approval-index">1</span> {`Yes, set ${mode} as my default`}
        </button>
        <button type="button" onClick={() => onAnswer(false)}>
          <span className="cc-plan-approval-index">2</span> {`No, keep ${currentDefault}`}
        </button>
      </div>
    </div>
  );
}
