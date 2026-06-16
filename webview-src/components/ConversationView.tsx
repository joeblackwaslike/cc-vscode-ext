import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import type { ClaudeStreamEvent, ContextUsage } from '../lib/ipc';

interface Props {
  channelId: string;
  events: ClaudeStreamEvent[];
  running: boolean;
  usage?: ContextUsage | undefined;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onCompact: () => void;
  onRefreshUsage: () => void;
  /** Kept for compatibility; the TabBar now owns "new conversation". */
  onNew?: () => void;
}

export function ConversationView({
  channelId,
  events,
  running,
  usage,
  onSend,
  onInterrupt,
  onCompact,
  onRefreshUsage,
}: Props) {
  return (
    <div data-testid="conversation-view" className="cc-conversation">
      <MessageList events={events} />
      <ChatInput
        channelId={channelId}
        onSend={onSend}
        onInterrupt={onInterrupt}
        onCompact={onCompact}
        onRefreshUsage={onRefreshUsage}
        running={running}
        usage={usage}
      />
    </div>
  );
}
