interface Props {
  title: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}

/** A single conversation tab — ✻ + title + close. */
export function ConversationTab({ title, active, onSelect, onClose }: Props) {
  return (
    <div
      className={`cc-tab${active ? ' cc-tab--active' : ''}`}
      data-testid="conversation-tab"
      onClick={onSelect}
      title={title}
    >
      <span className="cc-tab__star">✻</span>
      <span className="cc-tab__title">{title}</span>
      <span
        className="cc-tab__close"
        title="Close conversation"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </span>
    </div>
  );
}
