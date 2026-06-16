/** Helpers for the opaque content-block arrays carried by stream events. */

export type Block = Record<string, unknown> & { type?: unknown };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Flatten a message's `content` to plain text. Accepts the two shapes the CLI
 * emits: a bare string, or an array of content blocks (we keep only `text`
 * blocks — tool_use / tool_result / image blocks contribute no prose here).
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .filter((b) => b.type === 'text')
      .map((b) => String(b.text ?? ''))
      .join('');
  }
  return '';
}
