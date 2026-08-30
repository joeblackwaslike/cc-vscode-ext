import React, { useCallback, useState } from 'react';
import { ExtensionContext, useExtensionReducer } from './store/extensionStore';
import { SessionContext, useSessionReducer } from './store/sessionStore';
import { useMessages } from './hooks/useMessages';
import { useSession } from './hooks/useSession';
import { postMessage } from './lib/ipc';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ConversationView } from './components/ConversationView';
import { SessionList } from './components/SessionList';
import { TabBar, type TabInfo } from './components/TabBar';
import type { ClaudeStreamEvent, ToWebviewMessage } from './lib/ipc';

// ─── Detect view mode from flags injected by HtmlBuilder ─────────────────────

const IS_SESSION_LIST_ONLY = window.IS_SESSION_LIST_ONLY === true;

// ─── Root ─────────────────────────────────────────────────────────────────────

export function App() {
  const ext = useExtensionReducer();
  const sess = useSessionReducer();

  // Fan out incoming messages to both stores
  const handleMessage = useCallback(
    (msg: ToWebviewMessage) => {
      ext.handleMessage(msg);
      sess.handleMessage(msg);
    },
    [ext.handleMessage, sess.handleMessage],
  );

  useMessages(handleMessage);

  // Request initial state on mount
  React.useEffect(() => {
    postMessage({ type: 'list_sessions_request' });
    postMessage({ type: 'get_auth_status' });
  }, []);

  return (
    <ExtensionContext.Provider value={ext}>
      <SessionContext.Provider value={sess}>
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          {IS_SESSION_LIST_ONLY ? (
            <SessionListView />
          ) : (
            <MainView />
          )}
        </div>
      </SessionContext.Provider>
    </ExtensionContext.Provider>
  );
}

// ─── Main view (panel / sidebar) ──────────────────────────────────────────────

function MainView() {
  const { state: extState } = React.useContext(ExtensionContext)!;
  const { state: sessState, dispatch } = React.useContext(SessionContext)!;
  const { launch, sendText, interrupt, compact, requestContextUsage, close, deleteSession } = useSession();

  // One tab per conversation channel. `tabs` drives the tab bar; `activeId` is
  // the channel currently shown. Stream state lives in the session store keyed
  // by the same channelId, so switching tabs is just a re-render.
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const channelState = activeId ? sessState.channels[activeId] : undefined;

  const openTab = useCallback(
    (title: string, opts: { resume?: string } = {}) => {
      const channelId = crypto.randomUUID();
      setTabs((prev) => [...prev, { channelId, title }]);
      setActiveId(channelId);
      // Apply the current composer defaults (mode/effort/model) at launch — these
      // are CLI launch flags, so they take effect when the conversation starts.
      launch(channelId, {
        ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
        permissionMode: extState.defaultPermissionMode,
        thinkingLevel: extState.thinkingLevel,
        ...(extState.model !== undefined ? { model: extState.model } : {}),
      });
    },
    [launch, extState.defaultPermissionMode, extState.thinkingLevel, extState.model],
  );

  const startNewSession = useCallback(() => openTab('New conversation'), [openTab]);

  const openSession = useCallback(
    (sessionId: string) => {
      const existing = extState.sessions.find((s) => s.id === sessionId);
      openTab(existing?.title || 'Conversation', { resume: sessionId });
    },
    [openTab, extState.sessions],
  );

  const closeTab = useCallback(
    (channelId: string) => {
      close(channelId);
      dispatch({ type: 'CLEAR_CHANNEL', channelId });
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.channelId === channelId);
        const next = prev.filter((t) => t.channelId !== channelId);
        setActiveId((curr) => {
          if (curr !== channelId) return curr;
          if (next.length === 0) return null;
          return next[Math.min(idx, next.length - 1)]!.channelId;
        });
        return next;
      });
    },
    [close, dispatch],
  );

  const handleSend = useCallback(
    (text: string) => {
      if (!activeId) return;
      const requestId = crypto.randomUUID();
      // Optimistically render the user's turn — the CLI's stream-json output
      // does not echo user input back, so without this the message never shows.
      dispatch({
        type: 'STREAM_EVENT',
        channelId: activeId,
        event: { type: 'user', message: { role: 'user', content: text } } as ClaudeStreamEvent,
      });
      dispatch({ type: 'SET_RUNNING', channelId: activeId, running: true });
      sendText(activeId, text, requestId);
    },
    [activeId, sendText, dispatch],
  );

  const handleInterrupt = useCallback(() => {
    if (activeId) interrupt(activeId);
  }, [activeId, interrupt]);

  const handleCompact = useCallback(() => {
    if (activeId) compact(activeId);
  }, [activeId, compact]);

  const handleRefreshUsage = useCallback(() => {
    if (activeId) requestContextUsage(activeId);
  }, [activeId, requestContextUsage]);

  if (tabs.length === 0 || activeId === null) {
    return (
      <WelcomeScreen
        onNewSession={startNewSession}
        authenticated={extState.authenticated}
        loginUrl={extState.loginUrl}
      />
    );
  }

  return (
    <div className="cc-main">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onNew={startNewSession}
        sessions={extState.sessions}
        onOpenSession={openSession}
        onDeleteSession={deleteSession}
      />
      <ConversationView
        channelId={activeId}
        events={channelState?.events ?? []}
        running={channelState?.running ?? false}
        usage={channelState?.usage}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
        onCompact={handleCompact}
        onRefreshUsage={handleRefreshUsage}
      />
    </div>
  );
}

// ─── Session-list-only view (clawdVSCodeSessionsList panel) ──────────────────

function SessionListView() {
  const { state } = React.useContext(ExtensionContext)!;
  const { deleteSession, renameSession, createGroup, renameGroup, deleteGroup, moveSessionsToGroup } = useSession();

  const handleSelect = useCallback((sessionId: string) => {
    postMessage({ type: 'get_session_request', sessionId });
  }, []);

  const handleNew = useCallback(() => {
    postMessage({ type: 'new_conversation_tab' });
  }, []);

  return (
    <SessionList
      sessions={state.sessions}
      groups={state.groups}
      activeSessionId={state.activeSessionId}
      onSelect={handleSelect}
      onDelete={deleteSession}
      onRename={renameSession}
      onNew={handleNew}
      onCreateGroup={createGroup}
      onRenameGroup={renameGroup}
      onDeleteGroup={deleteGroup}
      onMoveToGroup={moveSessionsToGroup}
    />
  );
}
