import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Generic fixed-position right-click popup. Closes on outside-click or
 * Escape, matching `ComposerMenu.tsx`'s convention.
 *
 * Items may carry a `submenu`, expanded inline as an indented accordion
 * section directly beneath the parent row — NOT a side-opening flyout.
 * The sidebar view this renders in is only ~300px wide, and both this menu
 * and a would-be flyout submenu share the same `min-width: 180px`; a
 * 180px root plus a 180px side-by-side submenu simply cannot both fit
 * inside a 300px viewport at any root position, so there is no clamp/flip
 * scheme that makes a true flyout reachable here. Expanding in place keeps
 * everything in one column and lets the existing root-menu clamp (below)
 * cover the taller, expanded state too.
 */
export function SessionContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Re-measures on every expand/collapse (not just on x/y change) — the
  // accordion changes the menu's own height, and the clamp has to react to
  // that or a menu opened near the bottom edge would push its expanded
  // rows off-screen even though the collapsed state fit.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setPos({ left: x, top: y });
      return;
    }
    const rect = el.getBoundingClientRect();
    const clampedLeft = Math.max(0, Math.min(x, window.innerWidth - rect.width));
    const clampedTop = Math.max(0, Math.min(y, window.innerHeight - rect.height));
    setPos({ left: clampedLeft, top: clampedTop });
  }, [x, y, openSubmenu]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="cc-ctxmenu"
      role="menu"
      data-testid="session-context-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`} className="cc-ctxmenu__item-wrap">
          <button
            type="button"
            role="menuitem"
            aria-expanded={item.submenu ? openSubmenu === i : undefined}
            disabled={item.disabled}
            className="cc-ctxmenu__item"
            onClick={() => {
              if (item.disabled) return;
              if (item.submenu) {
                setOpenSubmenu((cur) => (cur === i ? null : i));
                return;
              }
              item.onSelect?.();
              onClose();
            }}
          >
            <span className="cc-ctxmenu__label">{item.label}</span>
            {item.submenu && <span className="cc-ctxmenu__chev">{openSubmenu === i ? '▾' : '▸'}</span>}
          </button>
          {item.submenu && openSubmenu === i && (
            <div className="cc-ctxmenu__submenu-inline" role="group" data-testid="session-context-submenu">
              {item.submenu.map((sub, j) => (
                <button
                  type="button"
                  key={`${sub.label}-${j}`}
                  role="menuitem"
                  disabled={sub.disabled}
                  className="cc-ctxmenu__item cc-ctxmenu__item--indented"
                  onClick={() => {
                    if (sub.disabled) return;
                    sub.onSelect?.();
                    onClose();
                  }}
                >
                  <span className="cc-ctxmenu__label">{sub.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
