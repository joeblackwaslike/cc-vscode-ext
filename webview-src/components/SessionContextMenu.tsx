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
 * Escape, matching `ComposerMenu.tsx`'s convention. Items may carry a
 * `submenu`, rendered as a nested flyout on hover/click.
 *
 * The sidebar view this renders in is only ~300px wide, so both the root
 * menu and any submenu clamp/flip themselves against the viewport instead
 * of trusting the click position to leave enough room.
 */
export function SessionContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<number | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

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
  }, [x, y]);

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
          {item.submenu && openSubmenu === i && <Submenu items={item.submenu} onClose={onClose} />}
        </div>
      ))}
    </div>
  );
}

interface SubmenuProps {
  items: ContextMenuItem[];
  onClose: () => void;
}

/** Nested flyout for a `submenu` entry. Flips to the left when it would overflow the viewport. */
function Submenu({ items, onClose }: SubmenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipLeft, setFlipLeft] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) setFlipLeft(true);
  }, []);

  return (
    <div
      ref={ref}
      className={`cc-ctxmenu cc-ctxmenu--submenu${flipLeft ? ' cc-ctxmenu--submenu-left' : ''}`}
      role="menu"
      data-testid="session-context-submenu"
    >
      {items.map((sub, j) => (
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
  );
}
