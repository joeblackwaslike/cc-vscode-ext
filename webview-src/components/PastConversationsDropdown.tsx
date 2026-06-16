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
          {visible.map((s) => {
            const label = s.title || 'Untitled';
            const openSession = () => {
              onOpen(s.id);
              setOpen(false);
            };
            return (
              // Nested delete control rules out a <button> wrapper; use
              // role="button" + keyboard activation, delete is a real button.
              <div
                key={s.id}
                className="cc-past-menu__item"
                role="button"
                tabIndex={0}
                aria-label={`Open conversation: ${label}`}
                onClick={openSession}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openSession();
                  }
                }}
              >
                <span className="cc-past-menu__dot" data-state={s.state} />
                <span className="cc-past-menu__title">{label}</span>
                <button
                  type="button"
                  className="cc-past-menu__del"
                  aria-label={`Delete conversation: ${label}`}
                  title="Delete conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
