import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface Props {
  options: MenuOption[];
  /** Currently-selected value (shows a ✓). Omit for action menus like "+". */
  value?: string;
  onSelect: (value: string) => void;
  triggerLabel: ReactNode;
  align?: 'left' | 'right';
  showChevron?: boolean;
  triggerClass?: string;
  triggerTestId?: string;
  triggerTitle?: string;
}

/** A small toolbar dropdown: a trigger button + a popover list of options. */
export function ComposerMenu({
  options,
  value,
  onSelect,
  triggerLabel,
  align = 'left',
  showChevron = true,
  triggerClass = '',
  triggerTestId,
  triggerTitle,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="cc-menu-wrap" ref={ref}>
      <button
        type="button"
        className={`cc-tbtn ${triggerClass}`}
        data-testid={triggerTestId}
        title={triggerTitle}
        onClick={() => setOpen((o) => !o)}
      >
        {triggerLabel}
        {showChevron && <span className="cc-tbtn__chev">▾</span>}
      </button>
      {open && (
        <div className={`cc-menu cc-menu--${align}`} role="menu">
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              role="menuitem"
              disabled={opt.disabled}
              className={`cc-menu__item${opt.value === value ? ' cc-menu__item--active' : ''}`}
              onClick={() => {
                if (opt.disabled) return;
                onSelect(opt.value);
                setOpen(false);
              }}
            >
              <span className="cc-menu__check">{opt.value === value ? '✓' : ''}</span>
              <span className="cc-menu__label">{opt.label}</span>
              {opt.hint && <span className="cc-menu__hint">{opt.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
