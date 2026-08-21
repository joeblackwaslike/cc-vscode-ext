/**
 * Focus View grouping: collapses runs of routine tool calls into a single
 * foldable summary row, while text/thinking/"always visible" tool blocks stay
 * standalone in their original position. Pure, no React — see
 * `FocusSummaryRow`/`AssistantTurn` for the rendering side.
 */
import type { AssistantBlock, ToolUseBlock } from './conversationModel';

/**
 * Tool names that must never fold, even inside an otherwise-foldable run —
 * their content is worth seeing inline every time. `AskUserQuestion` is the
 * CLI's actual clarifying-question tool name, empirically confirmed via
 * `strings` on the bundled @anthropic-ai/claude-code binary (2.1.237); it was
 * not otherwise referenced anywhere in this codebase before this task.
 * Extend this set as more "always show" tools are identified.
 */
export const ALWAYS_VISIBLE_TOOL_NAMES: ReadonlySet<string> = new Set(['TodoWrite', 'AskUserQuestion']);

export type FocusGroup =
  | { type: 'visible'; block: AssistantBlock }
  | { type: 'folded'; tools: ToolUseBlock[] };

/**
 * Walks `blocks` in order. Text/thinking/always-visible-tool blocks become
 * standalone `visible` entries; consecutive runs of other `tool_use` blocks
 * collapse into one `folded` group per contiguous run, so commentary
 * interleaved between tool runs stays visible in its original position and a
 * turn can contain more than one folded group.
 */
export function groupBlocksForFocusView(blocks: AssistantBlock[]): FocusGroup[] {
  const groups: FocusGroup[] = [];
  let currentFold: ToolUseBlock[] = [];

  const flushFold = (): void => {
    if (currentFold.length > 0) {
      groups.push({ type: 'folded', tools: currentFold });
      currentFold = [];
    }
  };

  for (const block of blocks) {
    if (block.type === 'tool_use' && !ALWAYS_VISIBLE_TOOL_NAMES.has(block.name)) {
      currentFold.push(block);
      continue;
    }
    flushFold();
    groups.push({ type: 'visible', block });
  }
  flushFold();

  return groups;
}
