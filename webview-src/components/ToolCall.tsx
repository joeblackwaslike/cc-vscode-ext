import { getToolRenderer } from '../lib/toolRegistry';
import { ToolResult } from './ToolResult';
import type { ToolUseBlock } from '../lib/conversationModel';

/** Compact tool invocation: `Read` (utils.py) with its result inline beneath. */
export function ToolCall({ tool }: { tool: ToolUseBlock }) {
  const renderer = getToolRenderer(tool.name);
  const arg = renderer.primaryArg(tool.input);
  const result = tool.result;
  const rendered = result ? renderer.renderResult(result.text, tool.input) : null;

  return (
    <div className="cc-tool" data-testid="tool-call">
      <div className="cc-tool__hd">
        <span className="cc-tool__name">{tool.name}</span>
        {arg && <span className="cc-tool__arg">({arg})</span>}
        <div className="cc-tool__actions">
          {result?.isError && <span className="cc-tool__status--error">✗</span>}
          <button
            className="cc-tool__copy"
            title="Copy"
            onClick={() => navigator.clipboard.writeText(renderer.copyText(tool.input))}
          >
            ⎘
          </button>
        </div>
      </div>
      {rendered && rendered.content.trim() !== '' && (
        <ToolResult result={rendered} isError={result?.isError ?? false} />
      )}
    </div>
  );
}
