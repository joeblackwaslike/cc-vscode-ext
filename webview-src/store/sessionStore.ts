import { createContext, useContext, useReducer, useCallback } from 'react';
import type { ClaudeStreamEvent, ContextUsage, ToWebviewMessage } from '../lib/ipc';

// ─── State ────────────────────────────────────────────────────────────────────

export interface ChannelState {
  events: ClaudeStreamEvent[];
  running: boolean;
  usage?: ContextUsage;
}

export interface SessionStoreState {
  channels: Record<string, ChannelState>;
}

const initialState: SessionStoreState = { channels: {} };

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'STREAM_EVENT'; channelId: string; event: ClaudeStreamEvent }
  | { type: 'SET_RUNNING'; channelId: string; running: boolean }
  | { type: 'SET_USAGE'; channelId: string; usage: ContextUsage }
  | { type: 'CLEAR_CHANNEL'; channelId: string };

function reducer(state: SessionStoreState, action: Action): SessionStoreState {
  switch (action.type) {
    case 'STREAM_EVENT': {
      const prev = state.channels[action.channelId] ?? { events: [], running: false };
      return {
        ...state,
        channels: {
          ...state.channels,
          [action.channelId]: { ...prev, events: [...prev.events, action.event] },
        },
      };
    }
    case 'SET_RUNNING': {
      const prev = state.channels[action.channelId] ?? { events: [], running: false };
      return {
        ...state,
        channels: {
          ...state.channels,
          [action.channelId]: { ...prev, running: action.running },
        },
      };
    }
    case 'SET_USAGE': {
      const prev = state.channels[action.channelId] ?? { events: [], running: false };
      return {
        ...state,
        channels: {
          ...state.channels,
          [action.channelId]: { ...prev, usage: action.usage },
        },
      };
    }
    case 'CLEAR_CHANNEL': {
      const { [action.channelId]: _removed, ...rest } = state.channels;
      void _removed;
      return { ...state, channels: rest };
    }
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface SessionContextValue {
  state: SessionStoreState;
  dispatch: React.Dispatch<Action>;
  handleMessage: (msg: ToWebviewMessage) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSessionStore() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionStore must be used within SessionProvider');
  return ctx;
}

export function useSessionReducer() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleMessage = useCallback(
    (msg: ToWebviewMessage): void => {
      if (msg.type === 'relay_started') {
        dispatch({
          type: 'STREAM_EVENT',
          channelId: msg.channelId,
          event: { type: 'relay_marker', fromSessionId: msg.fromSessionId, toSessionId: msg.toSessionId },
        });
        return;
      }
      if (msg.type === 'context_usage') {
        dispatch({ type: 'SET_USAGE', channelId: msg.channelId, usage: msg.usage });
        return;
      }
      if (msg.type === 'handoff_prompt') {
        dispatch({
          type: 'STREAM_EVENT',
          channelId: msg.channelId,
          event: { type: 'handoff_prompt', content: msg.content },
        });
        return;
      }
      if (msg.type !== 'request') return;
      const event = msg.request;
      dispatch({ type: 'STREAM_EVENT', channelId: msg.channelId, event });
      // Mark channel idle when result arrives
      if (event.type === 'result' || event.type === 'error') {
        dispatch({ type: 'SET_RUNNING', channelId: msg.channelId, running: false });
      }
    },
    [dispatch],
  );

  return { state, dispatch, handleMessage };
}
