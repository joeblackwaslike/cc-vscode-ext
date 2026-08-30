import { createContext, useContext, useReducer, useCallback } from 'react';
import type { SessionInfo, SessionGroup, PermissionMode, ThinkingLevel, ToWebviewMessage } from '../lib/ipc';

// ─── State ────────────────────────────────────────────────────────────────────

export interface ExtensionState {
  sessions: SessionInfo[];
  groups: SessionGroup[];
  activeSessionId: string | undefined;
  defaultPermissionMode: PermissionMode;
  thinkingLevel: ThinkingLevel;
  model: string | undefined;
  focusViewEnabled: boolean;
  authenticated: boolean;
  loginUrl: string | undefined;
  customModels: string[];
}

const initialState: ExtensionState = {
  sessions: [],
  groups: [],
  activeSessionId: undefined,
  defaultPermissionMode: 'default',
  thinkingLevel: 'medium',
  model: undefined,
  focusViewEnabled: false,
  authenticated: true, // assume authenticated until told otherwise
  loginUrl: undefined,
  customModels: [],
};

// ─── Actions ──────────────────────────────────────────────────────────────────

type SessionDefaults = Partial<
  Pick<ExtensionState, 'defaultPermissionMode' | 'thinkingLevel' | 'model' | 'focusViewEnabled'>
>;

type Action =
  | { type: 'UPDATE_STATE'; payload: Omit<ExtensionState, 'authenticated' | 'loginUrl'> }
  | { type: 'AUTH_STATUS'; authenticated: boolean; loginUrl?: string }
  | { type: 'LIST_SESSIONS'; sessions: SessionInfo[]; groups: SessionGroup[] }
  | { type: 'SET_DEFAULTS'; defaults: SessionDefaults };

function reducer(state: ExtensionState, action: Action): ExtensionState {
  switch (action.type) {
    case 'UPDATE_STATE':
      return { ...state, ...action.payload };
    case 'SET_DEFAULTS':
      // Optimistic: reflect a selector change instantly, before the host echoes.
      return { ...state, ...action.defaults };
    case 'AUTH_STATUS':
      return {
        ...state,
        authenticated: action.authenticated,
        loginUrl: action.loginUrl,
      };
    case 'LIST_SESSIONS':
      return { ...state, sessions: action.sessions, groups: action.groups };
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
              groups: msg.groups,
              activeSessionId: msg.activeSessionId,
              defaultPermissionMode: msg.defaultPermissionMode,
              thinkingLevel: msg.thinkingLevel,
              model: msg.model,
              focusViewEnabled: msg.focusViewEnabled,
              customModels: msg.customModels ?? [],
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
          dispatch({ type: 'LIST_SESSIONS', sessions: msg.sessions, groups: msg.groups });
          break;
        default:
          break;
      }
    },
    [dispatch],
  );

  return { state, dispatch, handleMessage };
}
