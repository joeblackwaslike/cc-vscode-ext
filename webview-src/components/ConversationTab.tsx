import { useState, type KeyboardEvent } from 'react';

interface Props {
  title: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}

/** A single conversation tab — double-click title to rename inline. */
export function ConversationTab({ title, active, onSelect, onClose, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    const t = draft.trim();
    if (t && t !== title) onRename(t);
    setEditing(false);
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
  };

  return (
    <div
      className={`cc-tab${active ? ' cc-tab--active' : ''}`}
      data-testid="conversation-tab"
      role="tab"
      tabIndex={0}
      aria-selected={active}
      aria-label={title}
      onClick={onSelect}
      onKeyDown={onTabKeyDown}
      title={editing ? undefined : title}
    >
      <span className="cc-tab__star">✻</span>
      {editing ? (
        <input
          className="cc-tab__rename"
          value={draft}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commit}
        />
      ) : (
        <span className="cc-tab__title" onDoubleClick={startEdit}>{title}</span>
      )}
      <button
        type="button"
        className="cc-tab__close"
        aria-label={`Close conversation: ${title}`}
        title="Close conversation"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        ×
      </button>
    </div>
  );
}
