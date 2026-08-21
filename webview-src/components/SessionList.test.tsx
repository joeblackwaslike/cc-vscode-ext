import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SessionList } from './SessionList';
import type { SessionInfo, SessionGroup } from '../lib/ipc';

function session(id: string, groupId?: string): SessionInfo {
  return {
    id,
    title: `Session ${id}`,
    state: 'idle',
    updatedAt: '2024-01-01T00:00:00Z',
    hidden: false,
    ...(groupId !== undefined ? { groupId } : {}),
  };
}

function baseProps() {
  return {
    activeSessionId: undefined,
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onNew: vi.fn(),
    onCreateGroup: vi.fn(),
    onRenameGroup: vi.fn(),
    onDeleteGroup: vi.fn(),
    onMoveToGroup: vi.fn(),
  };
}

describe('SessionList: grouped rendering', () => {
  test('sessions appear under the right group header; ungrouped section renders separately', () => {
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];
    const sessions = [session('s1'), session('s2', 'g1'), session('s3', 'g1'), session('s4', 'stale-group')];

    render(<SessionList {...baseProps()} sessions={sessions} groups={groups} />);

    const sections = screen.getAllByTestId(/session-(group|ungrouped)-section/);
    expect(sections).toHaveLength(2);

    const workSection = screen.getByTestId('session-group-section');
    expect(within(workSection).getByText('Work')).toBeInTheDocument();
    expect(within(workSection).getByText('2')).toBeInTheDocument(); // member count
    expect(within(workSection).getByText('Session s2')).toBeInTheDocument();
    expect(within(workSection).getByText('Session s3')).toBeInTheDocument();
    expect(within(workSection).queryByText('Session s1')).not.toBeInTheDocument();

    // s4 has a groupId that no longer resolves to a real group — treated as ungrouped.
    const ungroupedSection = screen.getByTestId('session-ungrouped-section');
    expect(within(ungroupedSection).getByText('Ungrouped')).toBeInTheDocument();
    expect(within(ungroupedSection).getByText('Session s1')).toBeInTheDocument();
    expect(within(ungroupedSection).getByText('Session s4')).toBeInTheDocument();
  });

  test('renders a flat list with no group sections when there are no groups', () => {
    const sessions = [session('s1'), session('s2')];
    render(<SessionList {...baseProps()} sessions={sessions} groups={[]} />);

    expect(screen.queryByTestId('session-group-section')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-ungrouped-section')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('session-item')).toHaveLength(2);
  });
});

describe('SessionList: collapse / expand', () => {
  test('clicking a group header hides its members; clicking again shows them', () => {
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];
    const sessions = [session('s1', 'g1')];
    render(<SessionList {...baseProps()} sessions={sessions} groups={groups} />);

    expect(screen.getByText('Session s1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Work'));
    expect(screen.queryByText('Session s1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Work'));
    expect(screen.getByText('Session s1')).toBeInTheDocument();
  });
});

describe('SessionList: multi-select', () => {
  test('ctrl-click toggles a single item in/out of the selection without opening it', () => {
    const onSelect = vi.fn();
    const sessions = [session('s1'), session('s2'), session('s3')];
    render(<SessionList {...baseProps()} onSelect={onSelect} sessions={sessions} groups={[]} />);

    const item2 = screen.getByText('Session s2').closest('[data-testid="session-item"]')!;
    fireEvent.click(item2, { ctrlKey: true });

    expect(item2).toHaveAttribute('data-selected', 'true');
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(item2, { ctrlKey: true });
    expect(item2).toHaveAttribute('data-selected', 'false');
  });

  test('shift-click selects the visible range between the anchor and the clicked item', () => {
    const sessions = [session('s1'), session('s2'), session('s3'), session('s4')];
    render(<SessionList {...baseProps()} sessions={sessions} groups={[]} />);

    const items = ['s1', 's2', 's3', 's4'].map(
      (id) => screen.getByText(`Session ${id}`).closest('[data-testid="session-item"]')!,
    );

    // Anchor: ctrl-click s1 so the plain range-select below doesn't fire onSelect for it.
    fireEvent.click(items[0]!, { ctrlKey: true });
    fireEvent.click(items[2]!, { shiftKey: true });

    expect(items[0]).toHaveAttribute('data-selected', 'true');
    expect(items[1]).toHaveAttribute('data-selected', 'true');
    expect(items[2]).toHaveAttribute('data-selected', 'true');
    expect(items[3]).toHaveAttribute('data-selected', 'false');
  });

  test('a plain click clears the selection and opens the session', () => {
    const onSelect = vi.fn();
    const sessions = [session('s1'), session('s2')];
    render(<SessionList {...baseProps()} onSelect={onSelect} sessions={sessions} groups={[]} />);

    const item1 = screen.getByText('Session s1').closest('[data-testid="session-item"]')!;
    const item2 = screen.getByText('Session s2').closest('[data-testid="session-item"]')!;

    fireEvent.click(item1, { ctrlKey: true });
    expect(item1).toHaveAttribute('data-selected', 'true');

    fireEvent.click(item2);
    expect(onSelect).toHaveBeenCalledWith('s2');
    expect(item1).toHaveAttribute('data-selected', 'false');
  });
});

describe('SessionList: context menu', () => {
  test('opens on right-click and closes on outside-click', () => {
    const sessions = [session('s1')];
    render(<SessionList {...baseProps()} sessions={sessions} groups={[]} />);

    const item = screen.getByText('Session s1').closest('[data-testid="session-item"]')!;
    fireEvent.contextMenu(item);
    expect(screen.getByTestId('session-context-menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('session-context-menu')).not.toBeInTheDocument();
  });

  test('closes on Escape', () => {
    const sessions = [session('s1')];
    render(<SessionList {...baseProps()} sessions={sessions} groups={[]} />);

    const item = screen.getByText('Session s1').closest('[data-testid="session-item"]')!;
    fireEvent.contextMenu(item);
    expect(screen.getByTestId('session-context-menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('session-context-menu')).not.toBeInTheDocument();
  });

  test('"Move to Group" calls onMoveToGroup with the correct session id array and group id', () => {
    const onMoveToGroup = vi.fn();
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];
    const sessions = [session('s1')];
    render(
      <SessionList {...baseProps()} onMoveToGroup={onMoveToGroup} sessions={sessions} groups={groups} />,
    );

    const item = screen.getByText('Session s1').closest('[data-testid="session-item"]')!;
    fireEvent.contextMenu(item);

    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Group/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }));

    expect(onMoveToGroup).toHaveBeenCalledWith(['s1'], 'g1');
  });

  test('right-clicking a session that is part of the current selection moves the whole selection', () => {
    const onMoveToGroup = vi.fn();
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];
    const sessions = [session('s1'), session('s2')];
    render(
      <SessionList {...baseProps()} onMoveToGroup={onMoveToGroup} sessions={sessions} groups={groups} />,
    );

    const item1 = screen.getByText('Session s1').closest('[data-testid="session-item"]')!;
    const item2 = screen.getByText('Session s2').closest('[data-testid="session-item"]')!;

    fireEvent.click(item1, { ctrlKey: true });
    fireEvent.click(item2, { ctrlKey: true });

    fireEvent.contextMenu(item2);
    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Group/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Work' }));

    expect(onMoveToGroup).toHaveBeenCalledWith(['s1', 's2'], 'g1');
  });

  test('"Remove from Group" only appears for a session that currently has a groupId', () => {
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];
    const sessions = [session('s1', 'g1'), session('s2')];
    render(<SessionList {...baseProps()} sessions={sessions} groups={groups} />);

    const grouped = screen.getByText('Session s1').closest('[data-testid="session-item"]')!;
    fireEvent.contextMenu(grouped);
    expect(screen.getByRole('menuitem', { name: 'Remove from Group' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    const ungrouped = screen.getByText('Session s2').closest('[data-testid="session-item"]')!;
    fireEvent.contextMenu(ungrouped);
    expect(screen.queryByRole('menuitem', { name: 'Remove from Group' })).not.toBeInTheDocument();
  });

  test('right-clicking a group header offers Rename Group and Delete Group', () => {
    const onDeleteGroup = vi.fn();
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Work' }];
    const sessions = [session('s1', 'g1')];
    render(
      <SessionList {...baseProps()} onDeleteGroup={onDeleteGroup} sessions={sessions} groups={groups} />,
    );

    const workSection = screen.getByTestId('session-group-section');
    const header = within(workSection).getByTestId('session-group-header');
    fireEvent.contextMenu(header);

    expect(screen.getByRole('menuitem', { name: 'Rename Group' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Group' }));
    expect(onDeleteGroup).toHaveBeenCalledWith('g1');
  });
});
