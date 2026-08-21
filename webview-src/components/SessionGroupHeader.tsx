import React, { useState } from 'react';

interface Props {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Omit for the synthetic "Ungrouped" bucket — it isn't a real, renamable group. */
  onRenameCommit?: (newName: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/** Collapsible sidebar section header — chevron, name (double-click to rename), member count. */
export function SessionGroupHeader({ name, count, collapsed, onToggle, onRenameCommit, onContextMenu }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== name) onRenameCommit?.(trimmed);
    setRenaming(false);
  };

  return (
    <div
      data-testid="session-group-header"
      style={styles.header}
      onClick={onToggle}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(e);
      }}
    >
      <span style={styles.chevron}>{collapsed ? '▸' : '▾'}</span>
      {renaming ? (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          style={styles.renameInput}
        />
      ) : (
        <span
          style={styles.name}
          onDoubleClick={(e) => {
            if (!onRenameCommit) return;
            e.stopPropagation();
            setValue(name);
            setRenaming(true);
          }}
        >
          {name}
        </span>
      )}
      <span style={styles.count}>{count}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--vscode-sideBarSectionHeader-foreground)',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    userSelect: 'none',
  },
  chevron: {
    fontSize: '9px',
    opacity: 0.7,
    flexShrink: 0,
  },
  name: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  count: {
    color: 'var(--cc-muted, var(--vscode-descriptionForeground))',
    fontWeight: 400,
  },
  renameInput: {
    flex: 1,
    fontSize: '11px',
    textTransform: 'none',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '3px',
    padding: '1px 4px',
    outline: 'none',
  },
};
