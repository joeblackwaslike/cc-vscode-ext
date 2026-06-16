import type { ContextUsage, ContextCategory } from '../types/ipc';

/**
 * Normalize the CLI's `get_context_usage` control response into our ContextUsage
 * shape. The response carries `categories[]` ({name, tokens, color, isDeferred}),
 * `totalTokens`, `maxTokens`, and `percentage` (plus a `gridRows` viz we ignore).
 * Returns null when the payload is missing a usable `maxTokens`.
 */
export function parseContextUsage(response: Record<string, unknown> | undefined): ContextUsage | null {
  if (!isRecord(response)) return null;
  const maxTokens = num(response.maxTokens);
  if (maxTokens <= 0) return null;

  const rawCategories = Array.isArray(response.categories) ? response.categories : [];
  const categories: ContextCategory[] = rawCategories.filter(isRecord).map((c) => ({
    name: String(c.name ?? ''),
    tokens: num(c.tokens),
    color: String(c.color ?? 'inactive'),
    ...(c.isDeferred === true ? { isDeferred: true } : {}),
  }));

  return {
    categories,
    totalTokens: num(response.totalTokens),
    maxTokens,
    percentage: num(response.percentage),
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
