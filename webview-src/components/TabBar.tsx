import { ConversationTab } from './ConversationTab';
import { PastConversationsDropdown } from './PastConversationsDropdown';
import type { SessionInfo } from '../lib/ipc';

export interface TabInfo {
  channelId: string;
  title: string;
}

interface Props {
  tabs: TabInfo[];
  activeId: string | null;
  onSelect: (channelId: string) => void;
  onClose: (channelId: string) => void;
  onNew: () => void;
  sessions: SessionInfo[];
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

/** Conversation tab row + "+" new-tab button, with a Past-conversations subbar. */
export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  sessions,
  onOpenSession,
  onDeleteSession,
}: Props) {
  return (
    <>
      <div className="cc-tabbar">
        <div className="cc-tabs">
          {tabs.map((tab) => (
            <ConversationTab
              key={tab.channelId}
              title={tab.title}
              active={tab.channelId === activeId}
              onSelect={() => onSelect(tab.channelId)}
              onClose={() => onClose(tab.channelId)}
            />
          ))}
        </div>
        <button
          className="cc-newtab"
          data-testid="new-tab-button"
          title="New conversation (⌘N)"
          onClick={onNew}
        >
          +
        </button>
      </div>
      <div className="cc-subbar">
        <PastConversationsDropdown
          sessions={sessions}
          onOpen={onOpenSession}
          onDelete={onDeleteSession}
        />
      </div>
    </>
  );
}
