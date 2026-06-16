import React, { useEffect, useRef, useState } from 'react';
import { ContextBreakdownPopover } from './ContextBreakdownPopover';
import type { ContextUsage } from '../lib/ipc';

interface Props {
  usage: ContextUsage;
  onCompact: () => void;
  /** Ask the host for a fresh breakdown (fired when the popover opens). */
  onRefresh?: (() => void) | undefined;
}

/** Percent-filled ring of context occupancy; click → breakdown popover. */
export function ContextUsageRing({ usage, onCompact, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pct = Math.min(100, Math.max(0, usage.percentage));

  useEffect(() => {
    if (!open) return;
    onRefresh?.();
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // onRefresh intentionally excluded — only fire on open transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <span className="cc-ring-wrap" ref={wrapRef} data-testid="usage-ring">
      <button
        type="button"
        className="cc-ring"
        style={{ ['--cc-ring-pct' as string]: `${pct}%` } as React.CSSProperties}
        onClick={() => setOpen((o) => !o)}
        title={`Context ${pct}% used`}
        aria-label={`Context ${pct}% used — open breakdown`}
      />
      {open && (
        <ContextBreakdownPopover
          usage={usage}
          onCompact={() => {
            onCompact();
            setOpen(false);
          }}
        />
      )}
    </span>
  );
}
