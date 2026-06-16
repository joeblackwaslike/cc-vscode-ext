import { renderMarkdown } from '../lib/markdown';
import { ToolCall } from './ToolCall';
import type { AssistantBlock } from '../lib/conversationModel';

/** An assistant turn — green dot gutter, then markdown text + tool calls. */
export function AssistantTurn({ blocks }: { blocks: AssistantBlock[] }) {
  return (
    <div className="cc-assistant" data-testid="chat-message-assistant">
      <div className="cc-assistant__gutter">
        <span className="cc-assistant__dot" />
      </div>
      <div className="cc-assistant__body">
        {blocks.map((block, i) =>
          block.type === 'text' ? (
            <div
              key={i}
              className="cc-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(block.text) }}
            />
          ) : (
            <ToolCall key={i} tool={block} />
          ),
        )}
      </div>
    </div>
  );
}
