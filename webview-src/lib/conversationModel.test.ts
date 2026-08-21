import { describe, it, expect } from 'vitest';
import { buildConversation, type Turn } from './conversationModel';
import type { ClaudeStreamEvent } from './ipc';

const ev = (e: Record<string, unknown>) => e as ClaudeStreamEvent;

describe('buildConversation', () => {
  it('renders a plain string user turn (optimistic echo shape)', () => {
    const turns = buildConversation([
      ev({ type: 'user', message: { role: 'user', content: 'hello there' } }),
    ]);
    expect(turns).toEqual<Turn[]>([{ kind: 'user', key: '0', text: 'hello there' }]);
  });

  it('pairs a tool_use with its later tool_result and hides the carrier user turn', () => {
    const turns = buildConversation([
      ev({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'reading the file' },
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a/utils.py' } },
          ],
        },
      }),
      // tool_result arrives as a user event — must NOT become a visible user turn
      ev({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'line1\nline2', is_error: false },
          ],
        },
      }),
    ]);

    expect(turns).toHaveLength(1);
    const turn = turns[0];
    expect(turn.kind).toBe('assistant');
    if (turn.kind !== 'assistant') throw new Error('expected assistant turn');
    const tool = turn.blocks.find((b) => b.type === 'tool_use');
    expect(tool).toMatchObject({
      type: 'tool_use',
      name: 'Read',
      result: { text: 'line1\nline2', isError: false },
    });
  });

  it('keeps a user turn that mixes text with a tool_result block', () => {
    const turns = buildConversation([
      ev({
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'here is context' },
            { type: 'tool_result', tool_use_id: 'tu_x', content: 'ignored', is_error: false },
          ],
        },
      }),
    ]);
    expect(turns).toEqual<Turn[]>([{ kind: 'user', key: '0', text: 'here is context' }]);
  });

  it('marks an errored tool_result', () => {
    const turns = buildConversation([
      ev({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'false' } }] } }),
      ev({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'boom', is_error: true }] } }),
    ]);
    const turn = turns[0];
    if (turn.kind !== 'assistant') throw new Error('expected assistant turn');
    expect(turn.blocks[0]).toMatchObject({ result: { isError: true } });
  });

  it('extracts cost/duration/token meta from a result event', () => {
    const turns = buildConversation([
      ev({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.04,
        duration_ms: 18000,
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
      }),
    ]);
    expect(turns[0]).toEqual<Turn>({
      kind: 'result',
      key: '0',
      isError: false,
      meta: { costUsd: 0.04, durationMs: 18000, usedTokens: 160 },
    });
  });

  it('ignores system events', () => {
    const turns = buildConversation([ev({ type: 'system', subtype: 'init' })]);
    expect(turns).toEqual([]);
  });

  it('parses a thinking-type content block into a ThinkingBlock', () => {
    const turns = buildConversation([
      ev({
        type: 'assistant',
        message: {
          content: [{ type: 'thinking', thinking: 'let me consider the options' }],
        },
      }),
    ]);
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    if (turn.kind !== 'assistant') throw new Error('expected assistant turn');
    expect(turn.blocks).toEqual([{ type: 'thinking', text: 'let me consider the options' }]);
  });
});
