import React, { useEffect, useRef } from 'react';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import type { ClaudeStreamEvent } from '../lib/ipc';

interface Props {
  channelId: string;
  events: ClaudeStreamEvent[];
  running: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onNew: () => void;
}

export function ConversationView({
  channelId: _channelId,
  events,
  running,
  onSend,
  onInterrupt,
  onNew,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as events arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div data-testid="conversation-view" style={styles.container}>
      <div style={styles.toolbar}>
        <button data-testid="new-conversation-button" style={styles.toolbarButton} onClick={onNew} title="New conversation">
          + New
        </button>
      </div>
      <div data-testid="messages-list" style={styles.messages}>
        {events.map((event, i) => (
          <ChatMessage key={i} event={event} />
        ))}
        <div ref={bottomRef} />
      </div>
      <ChatInput
        onSend={onSend}
        onInterrupt={onInterrupt}
        running={running}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '6px 12px',
    borderBottom: '1px solid var(--vscode-editorWidget-border)',
    flexShrink: 0,
  },
  toolbarButton: {
    background: 'none',
    border: '1px solid var(--vscode-button-secondaryBackground)',
    borderRadius: '4px',
    padding: '3px 10px',
    fontSize: '12px',
    cursor: 'pointer',
    color: 'var(--vscode-foreground)',
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 16px',
  },
};
