import type { ContextUsage, ContextCategory } from '../lib/ipc';

interface Props {
  usage: ContextUsage;
  onCompact: () => void;
}

/** Maps the CLI's semantic color keys to concrete swatch colors. */
const COLOR: Record<string, string> = {
  warning: '#d6a23e',
  claude: 'var(--cc-accent)',
  permission: '#c98fff',
  purple_FOR_SUBAGENTS_ONLY: '#a371f7',
  inactive: 'var(--cc-muted)',
  promptBorder: '#3a3a3a',
};

/** Desktop-style context breakdown: header bar + per-category rows + PreCompact. */
export function ContextBreakdownPopover({ usage, onCompact }: Props) {
  const { categories, totalTokens, maxTokens, percentage } = usage;

  return (
    <div className="cc-ctx" data-testid="context-breakdown" onClick={(e) => e.stopPropagation()}>
      <div className="cc-ctx__head">
        <span className="cc-ctx__title">Context window</span>
        <span className="cc-ctx__total">
          {fmt(totalTokens)} / {fmt(maxTokens)} ({percentage}%)
        </span>
      </div>
      <div className="cc-ctx__bar">
        <span className="cc-ctx__bar-fill" style={{ width: `${Math.min(100, percentage)}%` }} />
      </div>

      <div className="cc-ctx__rows">
        {categories.map((c) => (
          <Row key={c.name} category={c} maxTokens={maxTokens} />
        ))}
      </div>

      <button className="cc-ctx__compact" data-testid="precompact-button" onClick={onCompact}>
        PreCompact conversation
      </button>
    </div>
  );
}

function Row({ category, maxTokens }: { category: ContextCategory; maxTokens: number }) {
  const pct = maxTokens > 0 ? (category.tokens / maxTokens) * 100 : 0;
  return (
    <div className={`cc-ctx__row${category.isDeferred ? ' cc-ctx__row--deferred' : ''}`}>
      <span className="cc-ctx__dot" style={{ background: COLOR[category.color] ?? 'var(--cc-muted)' }} />
      <span className="cc-ctx__name">{category.name}</span>
      <span className="cc-ctx__tokens">{fmt(category.tokens)}</span>
      <span className="cc-ctx__pct">{pct < 0.1 ? '0%' : `${pct.toFixed(1)}%`}</span>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
