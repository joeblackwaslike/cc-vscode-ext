/**
 * Derives a renderable conversation from the flat stream-event log.
 *
 * The CLI delivers tool *results* as `tool_result` blocks inside *later*
 * `user` events, keyed to their `tool_use` by `tool_use_id`. A single forward
 * scan pairs them so each tool call renders with its result inline, and the
 * carrier user events (which hold only tool_result blocks) don't show up as
 * empty "You" turns. Pure + memoizable on the `events` reference.
 */
import type { ClaudeStreamEvent } from './ipc';
import { extractText, isRecord } from './blocks';

export interface ToolResult {
  text: string;
  isError: boolean;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: ToolResult;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
}

export type AssistantBlock = TextBlock | ThinkingBlock | ToolUseBlock;

export interface ResultMeta {
  costUsd?: number;
  durationMs?: number;
  usedTokens?: number;
}

export type Turn =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; blocks: AssistantBlock[] }
  | { kind: 'result'; key: string; isError: boolean; meta: ResultMeta }
  | { kind: 'error'; key: string; message: string };

export function buildConversation(events: ClaudeStreamEvent[]): Turn[] {
  // Pass 1: index every tool_result (carried inside user events) by its id.
  const resultsById = new Map<string, ToolResult>();
  for (const event of events) {
    if (event.type !== 'user') continue;
    const content = (event.message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (isRecord(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        resultsById.set(block.tool_use_id, {
          text: extractText(block.content),
          isError: block.is_error === true,
        });
      }
    }
  }

  // Pass 2: build turns, attaching results to their tool calls.
  const turns: Turn[] = [];
  events.forEach((event, i) => {
    const key = String(i);
    switch (event.type) {
      case 'user':
        pushUserTurn(turns, key, event);
        break;
      case 'assistant':
        pushAssistantTurn(turns, key, event, resultsById);
        break;
      case 'result':
        turns.push({
          kind: 'result',
          key,
          isError: event.subtype === 'error' || event.is_error === true,
          meta: extractResultMeta(event),
        });
        break;
      case 'error':
        turns.push({ kind: 'error', key, message: String(event.message ?? 'Unknown error') });
        break;
      // 'system' and unknown event types render nothing.
    }
  });
  return turns;
}

function pushUserTurn(turns: Turn[], key: string, event: ClaudeStreamEvent): void {
  const message = event.message as string | { content?: unknown } | undefined;
  const content = typeof message === 'string' ? message : message?.content;

  // Skip carrier events that hold only tool_result blocks (no prose) — their
  // output is shown inside the paired ToolCall, not as an empty user turn.
  if (Array.isArray(content) && !content.some((b) => isRecord(b) && b.type === 'text')) {
    return;
  }

  const text = extractText(content);
  if (text) turns.push({ kind: 'user', key, text });
}

function pushAssistantTurn(
  turns: Turn[],
  key: string,
  event: ClaudeStreamEvent,
  resultsById: Map<string, ToolResult>,
): void {
  const content = (event.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return;

  const blocks: AssistantBlock[] = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    if (raw.type === 'text') {
      blocks.push({ type: 'text', text: String(raw.text ?? '') });
    } else if (raw.type === 'thinking') {
      // Empirically verified against the bundled `claude` CLI (2.1.238,
      // --output-format stream-json): the anthropic Messages API's `thinking`
      // content block carries its text under a `thinking` field, not `text`.
      // The `raw.text` fallback is defensive only, for a future/alternate
      // shape — it should never be the live path today.
      blocks.push({ type: 'thinking', text: String(raw.thinking ?? raw.text ?? '') });
    } else if (raw.type === 'tool_use') {
      const id = String(raw.id ?? '');
      const block: ToolUseBlock = {
        type: 'tool_use',
        id,
        name: String(raw.name ?? 'tool'),
        input: isRecord(raw.input) ? raw.input : {},
      };
      const result = id ? resultsById.get(id) : undefined;
      if (result) block.result = result;
      blocks.push(block);
    }
  }

  if (blocks.length) turns.push({ kind: 'assistant', key, blocks });
}

function extractResultMeta(event: ClaudeStreamEvent): ResultMeta {
  const meta: ResultMeta = {};
  if (typeof event.total_cost_usd === 'number') meta.costUsd = event.total_cost_usd;
  if (typeof event.duration_ms === 'number') meta.durationMs = event.duration_ms;
  const usage = event.usage;
  if (isRecord(usage)) {
    const input = Number(usage.input_tokens ?? 0);
    const output = Number(usage.output_tokens ?? 0);
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
    const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
    const total = input + output + cacheRead + cacheWrite;
    if (total > 0) meta.usedTokens = total;
  }
  return meta;
}
