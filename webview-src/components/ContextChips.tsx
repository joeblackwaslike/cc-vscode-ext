import type { IdeContext } from '../lib/ipc';

interface Props {
  context: IdeContext | null;
  onDismiss: () => void;
}

const basename = (path: string): string => path.split(/[\\/]/).pop() || path;

/**
 * Chip row for the editor context the next send will carry. A selection chip
 * stands in for its file, so at most one chip shows.
 */
export function ContextChips({ context, onDismiss }: Props) {
  if (!context) return null;
  const { selection } = context;
  const kind = selection ? 'selection' : 'file';
  const label = selection
    ? `${basename(context.filePath)}:${selection.startLine}-${selection.endLine}`
    : basename(context.filePath);

  return (
    <div className="cc-context-chips">
      <span className="cc-context-chip" data-testid={`context-chip-${kind}`} title={context.filePath}>
        <span className="cc-context-chip__label">{label}</span>
        <button
          type="button"
          className="cc-context-chip__remove"
          aria-label={`Remove ${label} from context`}
          onClick={onDismiss}
        >
          ×
        </button>
      </span>
    </div>
  );
}
