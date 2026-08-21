import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { SessionContextMenu, type ContextMenuItem } from './SessionContextMenu';

// The sidebar view this renders in is only ~300px wide by default — these
// tests simulate that narrow container and assert the menu stays fully
// on-screen (including once "Move to Group" expands) instead of trusting
// the click position to leave enough room.
const NARROW_WIDTH = 300;
const NARROW_HEIGHT = 400;

function mockRect(overrides: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

describe('SessionContextMenu: viewport clamping', () => {
  let originalInnerWidth: number;
  let originalInnerHeight: number;

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { value: NARROW_WIDTH, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: NARROW_HEIGHT, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    vi.restoreAllMocks();
  });

  test('clamps the root menu position so it never overflows the viewport', () => {
    // A 180x120 menu opened near the bottom-right corner of a 300x400
    // sidebar would overflow both edges without clamping.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      mockRect({ width: 180, height: 120, right: 180, bottom: 120 }),
    );

    render(<SessionContextMenu x={280} y={390} items={[{ label: 'Item' }]} onClose={() => {}} />);

    const menu = screen.getByTestId('session-context-menu');
    const left = parseFloat(menu.style.left);
    const top = parseFloat(menu.style.top);

    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(NARROW_WIDTH - 180);
    expect(top).toBeLessThanOrEqual(NARROW_HEIGHT - 120);
  });

  test('does not move the menu when it already fits at the click position', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      mockRect({ width: 180, height: 120, right: 180, bottom: 120 }),
    );

    render(<SessionContextMenu x={10} y={10} items={[{ label: 'Item' }]} onClose={() => {}} />);

    const menu = screen.getByTestId('session-context-menu');
    expect(menu.style.left).toBe('10px');
    expect(menu.style.top).toBe('10px');
  });

  test('expanding "Move to Group" inline (not a flyout) keeps the whole menu within the viewport', () => {
    // A true side-opening flyout can never fit here: both a root menu and a
    // submenu share min-width: 180px, and 180+180=360 doesn't fit inside a
    // 300px-wide sidebar at any root position. "Move to Group" expands
    // inline instead — same 180px-wide column, taller once expanded. Opened
    // near the bottom-right corner (needs clamping collapsed AND expanded).
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const expanded = this.querySelector('[data-testid="session-context-submenu"]') !== null;
      const width = 180;
      const height = expanded ? 160 : 40;
      return mockRect({ width, height, right: width, bottom: height });
    });

    const items: ContextMenuItem[] = [
      {
        label: 'Move to Group',
        submenu: [
          { label: 'Work', onSelect: () => {} },
          { label: 'Personal', onSelect: () => {} },
          { label: 'Archive', onSelect: () => {} },
        ],
      },
    ];
    render(<SessionContextMenu x={280} y={390} items={items} onClose={() => {}} />);

    const menu = screen.getByTestId('session-context-menu');
    // Collapsed (40px tall): already needs vertical clamping at this click position.
    expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(NARROW_HEIGHT - 40);

    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Group/ }));

    // Expanded: the SAME element is now measured at 160px tall. Assert the
    // actual resulting on-screen rectangle — position plus measured size —
    // stays fully inside the 300x400 viewport in both dimensions. A class
    // name assertion wouldn't catch a still-off-screen flyout; this does.
    const left = parseFloat(menu.style.left);
    const top = parseFloat(menu.style.top);
    const mockedWidth = 180;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(left + mockedWidth).toBeLessThanOrEqual(NARROW_WIDTH);
    expect(top + 160).toBeLessThanOrEqual(NARROW_HEIGHT);

    // The group rows live inside this very element — there is no second,
    // independently-positioned panel that could overflow on its own.
    const workRow = screen.getByRole('menuitem', { name: 'Work' });
    expect(menu.contains(workRow)).toBe(true);
  });

  test('re-clamps when the rendered item labels change width without an x/y or submenu change', () => {
    // Simulate a label swap (e.g. "Delete Group" -> `Confirm delete "<name>"`)
    // widening the menu at a fixed click position near the right edge — the
    // clamp must react to the new measured width, not just to x/y/openSubmenu.
    let width = 120;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() =>
      mockRect({ width, height: 40, right: width, bottom: 40 }),
    );

    const { rerender } = render(
      <SessionContextMenu x={280} y={10} items={[{ label: 'Delete Group' }]} onClose={() => {}} />,
    );

    const menu = screen.getByTestId('session-context-menu');
    expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(NARROW_WIDTH - 120);

    // Widen the menu via a longer label at the same x/y, same (collapsed) submenu state.
    width = 260;
    rerender(
      <SessionContextMenu
        x={280}
        y={10}
        items={[{ label: 'Confirm delete "A Rather Long Group Name"', danger: true }]}
        onClose={() => {}}
      />,
    );

    expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(NARROW_WIDTH - 260);
  });
});

describe('SessionContextMenu: submenu items', () => {
  test('a submenu item with keepOpen does not close the menu after onSelect runs', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const items: ContextMenuItem[] = [
      {
        label: 'Parent',
        submenu: [{ label: 'Stay Open', onSelect, keepOpen: true }],
      },
    ];
    render(<SessionContextMenu x={10} y={10} items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Parent/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stay Open' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a submenu item without keepOpen closes the menu after onSelect runs (default behavior)', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const items: ContextMenuItem[] = [
      {
        label: 'Parent',
        submenu: [{ label: 'Close Me', onSelect }],
      },
    ];
    render(<SessionContextMenu x={10} y={10} items={items} onClose={onClose} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Parent/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Me' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a danger submenu item renders with the destructive styling class', () => {
    const items: ContextMenuItem[] = [
      {
        label: 'Parent',
        submenu: [{ label: 'Confirm delete "x"', danger: true }],
      },
    ];
    render(<SessionContextMenu x={10} y={10} items={items} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Parent/ }));
    const row = screen.getByRole('menuitem', { name: 'Confirm delete "x"' });
    expect(row.className).toMatch(/cc-ctxmenu__item--danger/);
  });
});
