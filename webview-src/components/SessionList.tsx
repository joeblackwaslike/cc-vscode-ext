import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { SessionInfo, SessionGroup } from '../lib/ipc';
import { SessionGroupHeader, type SessionGroupHeaderHandle } from './SessionGroupHeader';
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

/**
 * What the currently-open context menu was opened on. Menu items are computed
 * fresh from this on every render (see `buildContextMenuItems`) rather than
 * frozen at open-time, so state changes made by an item's own `onSelect`
 * (e.g. arming the delete-group confirmation) are reflected immediately
 * without closing the menu.
 */
type ContextMenuDescriptor =
  | { kind: 'item'; targetIds: string[]; hasGroup: boolean }
  | { kind: 'group'; group: SessionGroup }
  | { kind: 'empty' };

interface ContextMenuState {
  x: number;
  y: number;
  descriptor: ContextMenuDescriptor;
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
  // Armed by a first "Delete Group" click (which stays open via `keepOpen`);
  // a second click on the resulting "Confirm delete…" row actually deletes.
  // Reset on menu close or re-open — see handleGroupContextMenu / onClose below.
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);
  // Inline "create group" row shown instead of window.prompt() — VS Code's real
  // webview host sandboxes the iframe without `allow-modals`, so prompt()/confirm()
  // silently no-op there. `pendingMoveIds` carries the sessions to move into the
  // group once it's created, for the "+ New Group…" flow from the Move-to-Group menu.
  const [creatingGroup, setCreatingGroup] = useState<{ pendingMoveIds: string[] | null } | null>(null);
  const [newGroupName, setNewGroupName] = useState('');

  // "+ New Group…" creates the group fire-and-forget (no ack message); once
  // the resulting broadcast adds a matching group we haven't seen before,
  // finish the move that was requested alongside it. Guarded by a timeout
  // (and cleared on unmount) so a create that never lands — host error, view
  // disposed mid-flight — can't leak into a later, unrelated group that
  // happens to share the same name.
  const pendingGroupMoveRef = useRef<{ name: string; sessionIds: string[] } | null>(null);
  const pendingGroupMoveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevGroupsRef = useRef<SessionGroup[]>(groups);
  // One imperative handle per rendered section header, keyed by section id, so
  // "Rename Group" in the context menu can drive the SAME rename-edit mode the
  // header already exposes for its own double-click, instead of duplicating it.
  const headerRefs = useRef(new Map<string, SessionGroupHeaderHandle>());

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

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setConfirmDeleteGroupId(null);
    // Closing the whole menu — for any reason: outside-click, Escape, or a
    // successful commit closing it explicitly (see commitCreateGroup) — also
    // exits an accordion-anchored create-group flow. Unlike the empty-space/
    // header trigger, the accordion has no top-of-list fallback to keep
    // showing it in once the menu is gone, so leaving `creatingGroup` set
    // here would silently resurrect a stale, already-abandoned input the
    // next time "Move to Group" is opened.
    setCreatingGroup((prev) => (prev?.pendingMoveIds ? null : prev));
  }, []);

  const startCreateGroup = useCallback((pendingMoveIds: string[] | null) => {
    setNewGroupName('');
    setCreatingGroup({ pendingMoveIds });
  }, []);

  const commitCreateGroup = useCallback(() => {
    const trimmed = newGroupName.trim();
    if (trimmed) {
      if (creatingGroup?.pendingMoveIds) {
        schedulePendingGroupMove({ name: trimmed, sessionIds: creatingGroup.pendingMoveIds });
        // The accordion-triggered create-then-move flow is now fully handed
        // off to the pending-move reconciliation effect — close the menu
        // rather than leaving the "Move to Group" accordion open on a row
        // that's just reverted back to "+ New Group…".
        closeContextMenu();
      }
      onCreateGroup(trimmed);
    }
    setCreatingGroup(null);
    setNewGroupName('');
  }, [newGroupName, creatingGroup, onCreateGroup, schedulePendingGroupMove, closeContextMenu]);

  const cancelCreateGroup = useCallback(() => {
    setCreatingGroup(null);
    setNewGroupName('');
  }, []);

  // Shared by both create-group render sites (the fixed top-of-list row and
  // the in-accordion row inside "Move to Group") — same state, same handlers,
  // kept as one JSX source so the two can't silently drift apart.
  const renderCreateGroupInput = useCallback(
    () => (
      <input
        autoFocus
        value={newGroupName}
        onChange={(e) => setNewGroupName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitCreateGroup();
          if (e.key === 'Escape') cancelCreateGroup();
        }}
        onBlur={commitCreateGroup}
        onClick={(e) => e.stopPropagation()}
        placeholder="New group name"
        data-testid="create-group-input"
        style={styles.renameInput}
      />
    ),
    [newGroupName, commitCreateGroup, cancelCreateGroup],
  );

  const buildMoveToGroupSubmenu = useCallback(
    (targetIds: string[]): ContextMenuItem[] => {
      const groupItems: ContextMenuItem[] = groups.map((g) => ({
        label: g.name,
        onSelect: () => onMoveToGroup(targetIds, g.id),
      }));
      // Triggered from this very accordion (not the empty-space/header "New
      // Group" flow, which has no in-place anchor) — swap the "+ New Group…"
      // row for the input in place instead of closing the menu and jumping
      // focus to a top-of-list row that may be scrolled far out of view.
      if (creatingGroup?.pendingMoveIds) {
        return [
          ...groupItems,
          {
            label: 'New group name',
            custom: renderCreateGroupInput(),
          },
        ];
      }
      return [
        ...groupItems,
        {
          label: '+ New Group…',
          keepOpen: true,
          onSelect: () => startCreateGroup(targetIds),
        },
      ];
    },
    [groups, onMoveToGroup, startCreateGroup, creatingGroup, renderCreateGroupInput],
  );

  const handleItemContextMenu = useCallback(
    (e: React.MouseEvent, session: SessionInfo) => {
      e.preventDefault();
      e.stopPropagation();
      const targetIds = selectedIds.has(session.id) && selectedIds.size > 0 ? [...selectedIds] : [session.id];
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        descriptor: { kind: 'item', targetIds, hasGroup: Boolean(session.groupId) },
      });
    },
    [selectedIds],
  );

  const handleGroupContextMenu = useCallback((e: React.MouseEvent, group: SessionGroup) => {
    // Re-opening the menu (on this group or any other) resets any armed
    // delete-confirmation from a previous open.
    setConfirmDeleteGroupId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, descriptor: { kind: 'group', group } });
  }, []);

  const handleEmptyContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setConfirmDeleteGroupId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, descriptor: { kind: 'empty' } });
  }, []);

  const buildContextMenuItems = useCallback(
    (descriptor: ContextMenuDescriptor): ContextMenuItem[] => {
      switch (descriptor.kind) {
        case 'item':
          return [
            { label: 'Move to Group', submenu: buildMoveToGroupSubmenu(descriptor.targetIds) },
            ...(descriptor.hasGroup
              ? [{ label: 'Remove from Group', onSelect: () => onMoveToGroup(descriptor.targetIds, null) }]
              : []),
          ];
        case 'group': {
          const { group } = descriptor;
          const items: ContextMenuItem[] = [
            {
              label: 'Rename Group',
              onSelect: () => headerRefs.current.get(group.id)?.startRename(),
            },
          ];
          if (confirmDeleteGroupId === group.id) {
            items.push({
              label: `Confirm delete "${group.name}"`,
              danger: true,
              onSelect: () => {
                onDeleteGroup(group.id);
                setConfirmDeleteGroupId(null);
              },
            });
          } else {
            items.push({
              label: 'Delete Group',
              keepOpen: true,
              onSelect: () => setConfirmDeleteGroupId(group.id),
            });
          }
          return items;
        }
        case 'empty':
          return [{ label: 'New Group', onSelect: () => startCreateGroup(null) }];
      }
    },
    [buildMoveToGroupSubmenu, onMoveToGroup, onDeleteGroup, confirmDeleteGroupId, startCreateGroup],
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
        {/* Only the empty-space/Ungrouped-header trigger (no in-place anchor)
            uses this fixed top row — the Move-to-Group accordion trigger
            renders its own input inline via buildMoveToGroupSubmenu instead,
            so it doesn't jump the viewport away from a scrolled session. */}
        {creatingGroup && creatingGroup.pendingMoveIds === null && (
          <div style={styles.createGroupRow}>{renderCreateGroupInput()}</div>
        )}

        {visible.length === 0 && !creatingGroup && <div style={styles.empty}>No past conversations</div>}

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
                  ref={(instance) => {
                    if (instance) headerRefs.current.set(section.id, instance);
                    else headerRefs.current.delete(section.id);
                  }}
                  name={section.name}
                  count={section.sessions.length}
                  collapsed={collapsedGroups.has(section.id)}
                  onToggle={() => toggleGroupCollapse(section.id)}
                  {...(group
                    ? {
                        onRenameCommit: (newName: string) => onRenameGroup(group.id, newName),
                        onContextMenu: (e: React.MouseEvent) => handleGroupContextMenu(e, group),
                      }
                    : {
                        onContextMenu: handleEmptyContextMenu,
                      })}
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
          items={buildContextMenuItems(contextMenu.descriptor)}
          onClose={closeContextMenu}
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
  createGroupRow: {
    padding: '6px 12px',
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
