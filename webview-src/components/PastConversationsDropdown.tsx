import { useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '../lib/ipc';

interface Props {
  sessions: SessionInfo[];
  onOpen: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

/** Rounded "Past conversations" button that opens an inline session picker. */
export function PastConversationsDropdown({ sessions, onOpen, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const visible = sessions.filter((s) => !s.hidden);

  return (
    <div className="cc-past-wrap" ref={wrapRef}>
      <button
        className="cc-past"
        data-testid="past-conversations-button"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Past conversations</span>
        <span className="cc-past__chev">▾</span>
      </button>
      {open && (
        <div className="cc-past-menu" data-testid="past-conversations-menu">
          {visible.length === 0 && <div className="cc-past-menu__empty">No past conversations</div>}
          {visible.map((s) => (
            <div
              key={s.id}
              className="cc-past-menu__item"
              onClick={() => {
                onOpen(s.id);
                setOpen(false);
              }}
            >
              <span className="cc-past-menu__dot" data-state={s.state} />
              <span className="cc-past-menu__title">{s.title || 'Untitled'}</span>
              <span
                className="cc-past-menu__del"
                title="Delete conversation"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
              >
                ×
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
