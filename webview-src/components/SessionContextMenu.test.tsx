import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { SessionContextMenu, type ContextMenuItem } from './SessionContextMenu';

// The sidebar view this renders in is only ~300px wide by default — these
// tests simulate that narrow container and assert the menu clamps/flips
// itself to stay fully on-screen instead of trusting the click position.
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

  test('flips the submenu to open on the left when it would overflow the right edge', () => {
    // Root menu fits; the submenu, opening at left:100% of a 180px-wide
    // parent inside a 300px-wide sidebar, would spill past the right edge.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.getAttribute('data-testid') === 'session-context-submenu') {
        return mockRect({ width: 180, right: 320 });
      }
      return mockRect({ width: 180, height: 40, right: 180, bottom: 40 });
    });

    const items: ContextMenuItem[] = [
      { label: 'Move to Group', submenu: [{ label: 'Work', onSelect: () => {} }] },
    ];
    render(<SessionContextMenu x={10} y={10} items={items} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Group/ }));

    expect(screen.getByTestId('session-context-submenu')).toHaveClass('cc-ctxmenu--submenu-left');
  });

  test('keeps the submenu on the right when it fits', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      mockRect({ width: 180, height: 40, right: 180, bottom: 40 }),
    );

    const items: ContextMenuItem[] = [
      { label: 'Move to Group', submenu: [{ label: 'Work', onSelect: () => {} }] },
    ];
    render(<SessionContextMenu x={10} y={10} items={items} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /Move to Group/ }));

    expect(screen.getByTestId('session-context-submenu')).not.toHaveClass('cc-ctxmenu--submenu-left');
  });
});
