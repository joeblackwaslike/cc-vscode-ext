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
  onRenameTab: (channelId: string, title: string) => void;
  onNew: () => void;
  sessions: SessionInfo[];
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
}

/** Conversation tab row with + new and 🕐 history buttons. */
export function TabBar({
  tabs, activeId, onSelect, onClose, onRenameTab, onNew,
  sessions, onOpenSession, onDeleteSession, onRenameSession,
}: Props) {
  return (
    <div className="cc-tabbar">
      <div className="cc-tabs">
        {tabs.map((tab) => (
          <ConversationTab
            key={tab.channelId}
            title={tab.title}
            active={tab.channelId === activeId}
            onSelect={() => onSelect(tab.channelId)}
            onClose={() => onClose(tab.channelId)}
            onRename={(title) => onRenameTab(tab.channelId, title)}
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
      <PastConversationsDropdown
        sessions={sessions}
        onOpen={onOpenSession}
        onDelete={onDeleteSession}
        onRename={onRenameSession}
      />
    </div>
  );
}
