import type { IdeChip } from '../../src/shared/ideTags';

const basename = (path: string): string => path.split(/[\\/]/).pop() || path;

const chipLabel = (chip: IdeChip): string =>
  chip.kind === 'selection'
    ? `${basename(chip.path)}:${chip.startLine}-${chip.endLine}`
    : basename(chip.path);

const chipAria = (chip: IdeChip): string =>
  chip.kind === 'selection'
    ? `Selected lines ${chip.startLine}-${chip.endLine} of ${chip.path}`
    : `Opened file: ${chip.path}`;

/** A user message turn: right-aligned bubble plus muted chips for any editor context it carried. */
export function UserTurn({ text, ide }: { text: string; ide?: IdeChip[] | undefined }) {
  return (
    <div className="cc-user" data-testid="chat-message-user">
      {text && <div className="cc-user__bubble">{text}</div>}
      {ide && ide.length > 0 && (
        <div className="cc-context-chips cc-context-chips--history" role="list">
          {ide.map((chip, i) => (
            <span
              key={i}
              role="listitem"
              aria-label={chipAria(chip)}
              className="cc-context-chip cc-context-chip--history"
              data-testid={`history-chip-${chip.kind}`}
              title={chip.path}
            >
              <span className="cc-context-chip__label">{chipLabel(chip)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
