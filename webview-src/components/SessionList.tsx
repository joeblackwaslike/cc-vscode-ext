import React, { useState } from 'react';
import type { SessionInfo } from '../lib/ipc';

interface Props {
  sessions: SessionInfo[];
  activeSessionId: string | undefined;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onNew: () => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  onNew,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const visible = sessions.filter((s) => !s.hidden);

  return (
    <div data-testid="session-list" style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Past Conversations</span>
        <button data-testid="new-session-button" style={styles.newButton} onClick={onNew} title="New conversation">
          +
        </button>
      </div>

      {visible.length === 0 && (
        <div style={styles.empty}>No past conversations</div>
      )}

      {visible.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          renaming={renamingId === session.id}
          renameValue={renameValue}
          onSelect={() => onSelect(session.id)}
          onDelete={() => onDelete(session.id)}
          onStartRename={() => {
            setRenamingId(session.id);
            setRenameValue(session.title ?? '');
          }}
          onRenameChange={setRenameValue}
          onRenameCommit={() => {
            if (renameValue.trim()) onRename(session.id, renameValue.trim());
            setRenamingId(null);
          }}
          onRenameCancel={() => setRenamingId(null)}
        />
      ))}
    </div>
  );
}

interface ItemProps {
  session: SessionInfo;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onDelete: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function SessionItem({
  session,
  active,
  renaming,
  renameValue,
  onSelect,
  onDelete,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: ItemProps) {
  const stateColor =
    session.state === 'running'
      ? 'var(--cc-accent)'
      : session.state === 'error'
        ? 'var(--vscode-testing-iconFailed)'
        : 'var(--vscode-descriptionForeground)';

  return (
    <div
      data-testid="session-item"
      style={{ ...styles.item, ...(active ? styles.itemActive : {}) }}
      onClick={onSelect}
    >
      <span style={{ ...styles.stateDot, background: stateColor }} />
      {renaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameCommit();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={() => onRenameCommit()}
          onClick={(e) => e.stopPropagation()}
          style={styles.renameInput}
        />
      ) : (
        <span style={styles.title} onDoubleClick={onStartRename}>
          {session.title ?? 'Untitled'}
        </span>
      )}
      <button
        style={styles.deleteButton}
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
      >
        ×
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: '1px solid var(--vscode-editorWidget-border)',
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--vscode-sideBarSectionHeader-foreground)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  newButton: {
    background: 'none',
    border: 'none',
    color: 'var(--vscode-foreground)',
    fontSize: '18px',
    cursor: 'pointer',
    lineHeight: 1,
    padding: '0 4px',
  },
  empty: {
    padding: '24px 16px',
    fontSize: '13px',
    color: 'var(--vscode-descriptionForeground)',
    textAlign: 'center',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid transparent',
  },
  itemActive: {
    background: 'var(--vscode-list-activeSelectionBackground)',
    color: 'var(--vscode-list-activeSelectionForeground)',
  },
  stateDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: '13px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  renameInput: {
    flex: 1,
    fontSize: '13px',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '3px',
    padding: '1px 4px',
    outline: 'none',
  },
  deleteButton: {
    background: 'none',
    border: 'none',
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '16px',
    cursor: 'pointer',
    opacity: 0,
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
};
