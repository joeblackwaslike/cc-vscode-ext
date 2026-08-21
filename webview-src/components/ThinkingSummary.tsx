import { useEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  /** True only while this block's turn is actively streaming. */
  running: boolean;
}

/**
 * Collapsed "Thought for Ns" / "Thinking…" summary for a `thinking` block,
 * expandable to the raw text on click.
 *
 * The duration is a client-side wall-clock approximation: the stream event
 * carries no per-block timestamp, so it's measured from this component's
 * first render to the moment `running` flips false (turn completion). This
 * over-counts if the block already existed before mount (e.g. reopening a
 * historical turn) — it's a best-effort UX affordance, not an exact timer.
 */
export function ThinkingSummary({ text, running }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [manuallyExpanded, setManuallyExpanded] = useState(false);
  const startRef = useRef(Date.now());
  const wasRunningRef = useRef(running);
  const [durationSec, setDurationSec] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (wasRunningRef.current && !running && durationSec === undefined) {
      setDurationSec(Math.max(1, Math.round((Date.now() - startRef.current) / 1000)));
    }
    wasRunningRef.current = running;

    // Re-collapse once the turn completes, but only if the user had manually
    // expanded it — mirrors the upstream "re-collapse on turn completion" behavior.
    if (!running && manuallyExpanded) {
      setExpanded(false);
      setManuallyExpanded(false);
    }
  }, [running, durationSec, manuallyExpanded]);

  const toggle = (): void => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) setManuallyExpanded(true);
      return next;
    });
  };

  const summary = running
    ? 'Thinking…'
    : durationSec !== undefined
      ? `Thought for ${durationSec}s`
      : 'Thought';

  return (
    <div className="cc-thinking" data-testid="thinking-summary">
      <button
        type="button"
        className="cc-thinking__toggle"
        onClick={toggle}
        data-testid="thinking-summary-toggle"
      >
        <span className="cc-thinking__chev">{expanded ? '▾' : '▸'}</span>
        <span>{summary}</span>
      </button>
      {expanded && <div className="cc-thinking__body">{text}</div>}
    </div>
  );
}
