import { describe, it, expect } from 'vitest';
import { groupBlocksForFocusView, ALWAYS_VISIBLE_TOOL_NAMES } from './focusView';
import type { AssistantBlock, ToolUseBlock, TextBlock } from './conversationModel';

const tool = (id: string, name: string): ToolUseBlock => ({ type: 'tool_use', id, name, input: {} });
const text = (t: string): TextBlock => ({ type: 'text', text: t });

describe('groupBlocksForFocusView', () => {
  it('returns an empty array for empty input', () => {
    expect(groupBlocksForFocusView([])).toEqual([]);
  });

  it('collapses an all-foldable run of tool_use blocks into one folded group', () => {
    const blocks: AssistantBlock[] = [tool('1', 'Read'), tool('2', 'Bash'), tool('3', 'Grep')];
    const groups = groupBlocksForFocusView(blocks);
    expect(groups).toEqual([{ type: 'folded', tools: blocks }]);
  });

  it('keeps TodoWrite always visible, breaking a fold into two groups', () => {
    const t1 = tool('1', 'Read');
    const todo = tool('2', 'TodoWrite');
    const t2 = tool('3', 'Bash');
    const groups = groupBlocksForFocusView([t1, todo, t2]);
    expect(groups).toEqual([
      { type: 'folded', tools: [t1] },
      { type: 'visible', block: todo },
      { type: 'folded', tools: [t2] },
    ]);
  });

  it('keeps AskUserQuestion always visible', () => {
    expect(ALWAYS_VISIBLE_TOOL_NAMES.has('AskUserQuestion')).toBe(true);
    const ask = tool('1', 'AskUserQuestion');
    expect(groupBlocksForFocusView([ask])).toEqual([{ type: 'visible', block: ask }]);
  });

  it('produces multiple folded groups when text/commentary interleaves tool runs', () => {
    const t1 = tool('1', 'Read');
    const t2 = tool('2', 'Edit');
    const msg = text('here is what I found');
    const t3 = tool('3', 'Bash');
    const groups = groupBlocksForFocusView([t1, t2, msg, t3]);
    expect(groups).toEqual([
      { type: 'folded', tools: [t1, t2] },
      { type: 'visible', block: msg },
      { type: 'folded', tools: [t3] },
    ]);
  });

  it('keeps standalone text/thinking blocks as visible entries in position', () => {
    const msg = text('hello');
    const groups = groupBlocksForFocusView([msg]);
    expect(groups).toEqual([{ type: 'visible', block: msg }]);
  });
});
