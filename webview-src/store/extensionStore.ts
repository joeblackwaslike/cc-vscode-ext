import { createContext, useContext, useReducer, useCallback } from 'react';
import type { SessionInfo, PermissionMode, ThinkingLevel, ToWebviewMessage } from '../lib/ipc';

// ─── State ────────────────────────────────────────────────────────────────────

export interface ExtensionState {
  sessions: SessionInfo[];
  activeSessionId: string | undefined;
  defaultPermissionMode: PermissionMode;
  thinkingLevel: ThinkingLevel;
  authenticated: boolean;
  loginUrl: string | undefined;
}

const initialState: ExtensionState = {
  sessions: [],
  activeSessionId: undefined,
  defaultPermissionMode: 'default',
  thinkingLevel: 'none',
  authenticated: true, // assume authenticated until told otherwise
  loginUrl: undefined,
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type Action =
  | { type: 'UPDATE_STATE'; payload: Omit<ExtensionState, 'authenticated' | 'loginUrl'> }
  | { type: 'AUTH_STATUS'; authenticated: boolean; loginUrl?: string }
  | { type: 'LIST_SESSIONS'; sessions: SessionInfo[] };

function reducer(state: ExtensionState, action: Action): ExtensionState {
  switch (action.type) {
    case 'UPDATE_STATE':
      return { ...state, ...action.payload };
    case 'AUTH_STATUS':
      return {
        ...state,
        authenticated: action.authenticated,
        loginUrl: action.loginUrl,
      };
    case 'LIST_SESSIONS':
      return { ...state, sessions: action.sessions };
    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface ExtensionContextValue {
  state: ExtensionState;
  dispatch: React.Dispatch<Action>;
  handleMessage: (msg: ToWebviewMessage) => void;
}

export const ExtensionContext = createContext<ExtensionContextValue | null>(null);

export function useExtensionStore() {
  const ctx = useContext(ExtensionContext);
  if (!ctx) throw new Error('useExtensionStore must be used within ExtensionProvider');
  return ctx;
}

export function useExtensionReducer() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleMessage = useCallback(
    (msg: ToWebviewMessage): void => {
      switch (msg.type) {
        case 'update_state':
          dispatch({
            type: 'UPDATE_STATE',
            payload: {
              sessions: msg.sessions,
              activeSessionId: msg.activeSessionId,
              defaultPermissionMode: msg.defaultPermissionMode,
              thinkingLevel: msg.thinkingLevel,
            },
          });
          break;
        case 'get_auth_status_response':
          dispatch({
            type: 'AUTH_STATUS',
            authenticated: msg.authenticated,
            ...(msg.loginUrl !== undefined ? { loginUrl: msg.loginUrl } : {}),
          });
          break;
        case 'list_sessions_response':
          dispatch({ type: 'LIST_SESSIONS', sessions: msg.sessions });
          break;
        default:
          break;
      }
    },
    [dispatch],
  );

  return { state, dispatch, handleMessage };
}
