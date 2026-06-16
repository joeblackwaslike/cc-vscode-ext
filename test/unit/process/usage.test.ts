import { describe, it, expect } from 'vitest';
import { parseContextUsage } from '../../../src/process/usage';

describe('parseContextUsage', () => {
  it('maps the CLI get_context_usage response to ContextUsage', () => {
    const usage = parseContextUsage({
      categories: [
        { name: 'Messages', tokens: 15360, color: 'purple_FOR_SUBAGENTS_ONLY' },
        { name: 'MCP tools (deferred)', tokens: 54688, color: 'inactive', isDeferred: true },
        { name: 'Free space', tokens: 948702, color: 'promptBorder' },
      ],
      totalTokens: 44771,
      maxTokens: 1_000_000,
      percentage: 4,
      gridRows: [[{ color: 'promptBorder' }]],
    });
    expect(usage).toEqual({
      categories: [
        { name: 'Messages', tokens: 15360, color: 'purple_FOR_SUBAGENTS_ONLY' },
        { name: 'MCP tools (deferred)', tokens: 54688, color: 'inactive', isDeferred: true },
        { name: 'Free space', tokens: 948702, color: 'promptBorder' },
      ],
      totalTokens: 44771,
      maxTokens: 1_000_000,
      percentage: 4,
    });
  });

  it('returns null without a usable maxTokens', () => {
    expect(parseContextUsage(undefined)).toBeNull();
    expect(parseContextUsage({ categories: [], totalTokens: 0, percentage: 0 })).toBeNull();
  });
});
