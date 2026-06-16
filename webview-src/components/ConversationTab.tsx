import type { KeyboardEvent } from 'react';

interface Props {
  title: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** A single conversation tab — ✻ + title + close. */
export function ConversationTab({ title, active, onSelect, onClose }: Props) {
  // The tab carries a nested close control, so it can't be a <button> (no nested
  // buttons). Use role="tab" + keyboard activation instead; close is a real button.
  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
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
      title={title}
    >
      <span className="cc-tab__star">✻</span>
      <span className="cc-tab__title">{title}</span>
      <button
        type="button"
        className="cc-tab__close"
        aria-label={`Close conversation: ${title}`}
        title="Close conversation"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
