import React, { useCallback, useRef } from 'react';
import { ExtensionContext, useExtensionReducer } from './store/extensionStore';
import { SessionContext, useSessionReducer } from './store/sessionStore';
import { useMessages } from './hooks/useMessages';
import { useSession } from './hooks/useSession';
import { postMessage } from './lib/ipc';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ConversationView } from './components/ConversationView';
import { SessionList } from './components/SessionList';
import type { ToWebviewMessage } from './lib/ipc';

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
  const { launch, sendText, interrupt } = useSession();
  const channelIdRef = useRef<string | null>(null);

  const activeChannelId = channelIdRef.current;
  const channelState = activeChannelId ? sessState.channels[activeChannelId] : undefined;
  const hasConversation = activeChannelId !== null && channelState !== undefined;

  const startNewSession = useCallback(() => {
    const id = crypto.randomUUID();
    channelIdRef.current = id;
    launch(id);
  }, [launch]);

  const handleSend = useCallback(
    (text: string) => {
      if (!channelIdRef.current) return;
      const requestId = crypto.randomUUID();
      dispatch({ type: 'SET_RUNNING', channelId: channelIdRef.current, running: true });
      sendText(channelIdRef.current, text, requestId);
    },
    [sendText, dispatch],
  );

  const handleInterrupt = useCallback(() => {
    if (channelIdRef.current) interrupt(channelIdRef.current);
  }, [interrupt]);

  if (!hasConversation) {
    return (
      <WelcomeScreen
        onNewSession={startNewSession}
        authenticated={extState.authenticated}
        loginUrl={extState.loginUrl}
      />
    );
  }

  return (
    <ConversationView
      channelId={activeChannelId}
      events={channelState?.events ?? []}
      running={channelState?.running ?? false}
      onSend={handleSend}
      onInterrupt={handleInterrupt}
      onNew={startNewSession}
    />
  );
}

// ─── Session-list-only view (clawVSCodeSessionsList panel) ──────────────────

function SessionListView() {
  const { state } = React.useContext(ExtensionContext)!;
  const { deleteSession, renameSession } = useSession();

  const handleSelect = useCallback((sessionId: string) => {
    postMessage({ type: 'get_session_request', sessionId });
  }, []);

  const handleNew = useCallback(() => {
    postMessage({ type: 'new_conversation_tab' });
  }, []);

  return (
    <SessionList
      sessions={state.sessions}
      activeSessionId={state.activeSessionId}
      onSelect={handleSelect}
      onDelete={deleteSession}
      onRename={renameSession}
      onNew={handleNew}
    />
  );
}
