import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { PermissionDock } from './permissions/PermissionDock';
import { useChannelPermissions } from '../store/sessionStore';
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
  const { permissions } = useChannelPermissions(channelId);
  return (
    <div data-testid="conversation-view" className="cc-conversation">
      <MessageList events={events} channelId={channelId} running={running} />
      <PermissionDock channelId={channelId} />
      <ChatInput
        channelId={channelId}
        onSend={onSend}
        onInterrupt={onInterrupt}
        onCompact={onCompact}
        onRefreshUsage={onRefreshUsage}
        running={running}
        usage={usage}
        disabled={permissions.pending.length > 0}
      />
    </div>
  );
}
