import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { SessionInfo, SessionGroup } from '../lib/ipc';
import { SessionGroupHeader } from './SessionGroupHeader';
import { SessionContextMenu, type ContextMenuItem } from './SessionContextMenu';

interface Props {
  sessions: SessionInfo[];
  groups: SessionGroup[];
  activeSessionId: string | undefined;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onNew: () => void;
  onCreateGroup: (name: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onMoveToGroup: (sessionIds: string[], groupId: string | null) => void;
}

/** Synthetic bucket id for sessions with no group, or a groupId that no longer resolves. */
const UNGROUPED_ID = '__ungrouped__';

/**
 * How long to wait for a "+ New Group…" create to land before giving up on
 * the pending move. Matches `ControlRequestManager`'s 10s control-request
 * timeout elsewhere in this codebase.
 */
const PENDING_GROUP_MOVE_TIMEOUT_MS = 10_000;

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface Section {
  id: string;
  name: string;
  sessions: SessionInfo[];
  isGroup: boolean;
}

export function SessionList({
  sessions,
  groups,
  activeSessionId,
  onSelect,
  onDelete,
  onRename,
  onNew,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveToGroup,
}: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // "+ New Group…" creates the group fire-and-forget (no ack message); once
  // the resulting broadcast adds a matching group we haven't seen before,
  // finish the move that was requested alongside it. Guarded by a timeout
  // (and cleared on unmount) so a create that never lands — host error, view
  // disposed mid-flight — can't leak into a later, unrelated group that
  // happens to share the same name.
  const pendingGroupMoveRef = useRef<{ name: string; sessionIds: string[] } | null>(null);
  const pendingGroupMoveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevGroupsRef = useRef<SessionGroup[]>(groups);

  const clearPendingGroupMove = useCallback(() => {
    pendingGroupMoveRef.current = null;
    if (pendingGroupMoveTimeoutRef.current !== null) {
      clearTimeout(pendingGroupMoveTimeoutRef.current);
      pendingGroupMoveTimeoutRef.current = null;
    }
  }, []);

  const schedulePendingGroupMove = useCallback(
    (pending: { name: string; sessionIds: string[] }) => {
      clearPendingGroupMove();
      pendingGroupMoveRef.current = pending;
      pendingGroupMoveTimeoutRef.current = setTimeout(() => {
        pendingGroupMoveRef.current = null;
        pendingGroupMoveTimeoutRef.current = null;
      }, PENDING_GROUP_MOVE_TIMEOUT_MS);
    },
    [clearPendingGroupMove],
  );

  useEffect(() => clearPendingGroupMove, [clearPendingGroupMove]);

  useEffect(() => {
    const pending = pendingGroupMoveRef.current;
    if (pending) {
      const prevIds = new Set(prevGroupsRef.current.map((g) => g.id));
      const newGroup = groups.find((g) => !prevIds.has(g.id) && g.name === pending.name);
      if (newGroup) {
        onMoveToGroup(pending.sessionIds, newGroup.id);
        clearPendingGroupMove();
      }
    }
    prevGroupsRef.current = groups;
  }, [groups, onMoveToGroup, clearPendingGroupMove]);

  const visible = sessions.filter((s) => !s.hidden);
  const groupIds = new Set(groups.map((g) => g.id));

  const bucketed = new Map<string, SessionInfo[]>();
  for (const g of groups) bucketed.set(g.id, []);
  bucketed.set(UNGROUPED_ID, []);
  for (const s of visible) {
    // A groupId pointing at a group that no longer exists is treated as
    // ungrouped, defensively — never crash on stale data.
    const gid = s.groupId && groupIds.has(s.groupId) ? s.groupId : UNGROUPED_ID;
    bucketed.get(gid)?.push(s);
  }

  const sections: Section[] = [
    ...groups.map((g) => ({ id: g.id, name: g.name, sessions: bucketed.get(g.id) ?? [], isGroup: true })),
    { id: UNGROUPED_ID, name: 'Ungrouped', sessions: bucketed.get(UNGROUPED_ID) ?? [], isGroup: false },
  ];

  const flatVisibleOrder = sections.flatMap((sec) =>
    collapsedGroups.has(sec.id) ? [] : sec.sessions.map((s) => s.id),
  );

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handleItemClick = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          return next;
        });
        setLastClickedId(sessionId);
        return;
      }
      if (e.shiftKey && lastClickedId) {
        const startIdx = flatVisibleOrder.indexOf(lastClickedId);
        const endIdx = flatVisibleOrder.indexOf(sessionId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [from, to] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          setSelectedIds(new Set(flatVisibleOrder.slice(from, to + 1)));
          setLastClickedId(sessionId);
          return;
        }
      }
      setSelectedIds(new Set());
      setLastClickedId(sessionId);
      onSelect(sessionId);
    },
    [lastClickedId, flatVisibleOrder, onSelect],
  );

  const buildMoveToGroupSubmenu = useCallback(
    (targetIds: string[]): ContextMenuItem[] => [
      ...groups.map((g) => ({
        label: g.name,
        onSelect: () => onMoveToGroup(targetIds, g.id),
      })),
      {
        label: '+ New Group…',
        onSelect: () => {
          const name = window.prompt('New group name');
          const trimmed = name?.trim();
          if (trimmed) {
            schedulePendingGroupMove({ name: trimmed, sessionIds: targetIds });
            onCreateGroup(trimmed);
          }
        },
      },
    ],
    [groups, onMoveToGroup, onCreateGroup, schedulePendingGroupMove],
  );

  const handleItemContextMenu = useCallback(
    (e: React.MouseEvent, session: SessionInfo) => {
      e.preventDefault();
      e.stopPropagation();
      const targetIds = selectedIds.has(session.id) && selectedIds.size > 0 ? [...selectedIds] : [session.id];
      const items: ContextMenuItem[] = [
        { label: 'Move to Group', submenu: buildMoveToGroupSubmenu(targetIds) },
        ...(session.groupId
          ? [{ label: 'Remove from Group', onSelect: () => onMoveToGroup(targetIds, null) }]
          : []),
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [selectedIds, buildMoveToGroupSubmenu, onMoveToGroup],
  );

  const handleGroupContextMenu = useCallback(
    (e: React.MouseEvent, group: SessionGroup) => {
      const items: ContextMenuItem[] = [
        {
          label: 'Rename Group',
          onSelect: () => {
            const name = window.prompt('Rename group', group.name);
            const trimmed = name?.trim();
            if (trimmed && trimmed !== group.name) onRenameGroup(group.id, trimmed);
          },
        },
        {
          label: 'Delete Group',
          onSelect: () => {
            if (window.confirm(`Delete group "${group.name}"? Sessions inside it will become ungrouped.`)) {
              onDeleteGroup(group.id);
            }
          },
        },
      ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [onRenameGroup, onDeleteGroup],
  );

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: 'New Group',
            onSelect: () => {
              const name = window.prompt('New group name');
              const trimmed = name?.trim();
              if (trimmed) onCreateGroup(trimmed);
            },
          },
        ],
      });
    },
    [onCreateGroup],
  );

  const renderItem = (session: SessionInfo) => (
    <SessionItem
      key={session.id}
      session={session}
      active={session.id === activeSessionId}
      selected={selectedIds.has(session.id)}
      renaming={renamingId === session.id}
      renameValue={renameValue}
      onClick={(e) => handleItemClick(e, session.id)}
      onContextMenu={(e) => handleItemContextMenu(e, session)}
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
  );

  return (
    <div data-testid="session-list" style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerTitle}>Past Conversations</span>
        <button data-testid="new-session-button" style={styles.newButton} onClick={onNew} title="New conversation">
          +
        </button>
      </div>

      <div style={styles.scrollArea} data-testid="session-list-scroll" onContextMenu={handleEmptyContextMenu}>
        {visible.length === 0 && <div style={styles.empty}>No past conversations</div>}

        {visible.length > 0 &&
          sections.map((section) => {
            // No groups exist at all — render a flat list, matching pre-groups behavior.
            if (!section.isGroup && groups.length === 0) {
              return section.sessions.map(renderItem);
            }
            const group = section.isGroup ? groups.find((g) => g.id === section.id) : undefined;
            return (
              <div
                key={section.id}
                data-testid={section.isGroup ? 'session-group-section' : 'session-ungrouped-section'}
              >
                <SessionGroupHeader
                  name={section.name}
                  count={section.sessions.length}
                  collapsed={collapsedGroups.has(section.id)}
                  onToggle={() => toggleGroupCollapse(section.id)}
                  {...(group
                    ? {
                        onRenameCommit: (newName: string) => onRenameGroup(group.id, newName),
                        onContextMenu: (e: React.MouseEvent) => handleGroupContextMenu(e, group),
                      }
                    : {})}
                />
                {!collapsedGroups.has(section.id) && section.sessions.map(renderItem)}
              </div>
            );
          })}
      </div>

      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

interface ItemProps {
  session: SessionInfo;
  active: boolean;
  selected: boolean;
  renaming: boolean;
  renameValue: string;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

function SessionItem({
  session,
  active,
  selected,
  renaming,
  renameValue,
  onClick,
  onContextMenu,
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
      data-session-id={session.id}
      data-selected={selected}
      style={{
        ...styles.item,
        ...(active ? styles.itemActive : {}),
        ...(selected ? styles.itemSelected : {}),
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
  scrollArea: {
    flex: 1,
    overflowY: 'auto',
    minHeight: 0,
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
  itemSelected: {
    boxShadow: 'inset 0 0 0 1px var(--vscode-focusBorder)',
    background: 'var(--vscode-list-inactiveSelectionBackground)',
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
