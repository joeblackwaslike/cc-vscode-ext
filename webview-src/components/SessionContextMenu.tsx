import { useEffect, useRef, useState } from 'react';

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
 * Escape, matching `ComposerMenu.tsx`'s convention. Items may carry a
 * `submenu`, rendered as a nested flyout on hover/click.
 */
export function SessionContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);

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
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <div
          key={`${item.label}-${i}`}
          className="cc-ctxmenu__item-wrap"
          onMouseEnter={() => item.submenu && setOpenSubmenu(i)}
          onMouseLeave={() => item.submenu && setOpenSubmenu((cur) => (cur === i ? null : cur))}
        >
          <button
            type="button"
            role="menuitem"
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
            {item.submenu && <span className="cc-ctxmenu__chev">▸</span>}
          </button>
          {item.submenu && openSubmenu === i && (
            <div className="cc-ctxmenu cc-ctxmenu--submenu" role="menu">
              {item.submenu.map((sub, j) => (
                <button
                  type="button"
                  key={`${sub.label}-${j}`}
                  role="menuitem"
                  disabled={sub.disabled}
                  className="cc-ctxmenu__item"
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
