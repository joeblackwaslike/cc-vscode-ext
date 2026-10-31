import { createContext, useContext, useReducer, useCallback } from 'react';
import type {
  ClaudeStreamEvent,
  ContextUsage,
  PermissionDecision,
  PermissionRequest,
  ToWebviewMessage,
} from '../lib/ipc';
import type { PlanComment } from '../lib/permissions';

// ─── State ────────────────────────────────────────────────────────────────────

export interface ChannelState {
  events: ClaudeStreamEvent[];
  running: boolean;
  usage?: ContextUsage;
}

export interface ChannelPermissions {
  pending: PermissionRequest[];
  answers: Record<string, Record<string, string>>;
  decisions: Record<string, 'allowed' | 'denied' | 'cancelled'>;
  planComments: Record<string, PlanComment[]>;
}

export interface SessionStoreState {
  channels: Record<string, ChannelState>;
  permissions: Record<string, ChannelPermissions>;
}

const initialState: SessionStoreState = { channels: {}, permissions: {} };

const emptyPermissions: ChannelPermissions = { pending: [], answers: {}, decisions: {}, planComments: {} };

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}

function withPermissions(
  state: SessionStoreState,
  channelId: string,
  update: (prev: ChannelPermissions) => ChannelPermissions,
): SessionStoreState {
  const prev = state.permissions[channelId] ?? emptyPermissions;
  return { ...state, permissions: { ...state.permissions, [channelId]: update(prev) } };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type Action =
  | { type: 'STREAM_EVENT'; channelId: string; event: ClaudeStreamEvent }
  | { type: 'SET_RUNNING'; channelId: string; running: boolean }
  | { type: 'SET_USAGE'; channelId: string; usage: ContextUsage }
  | { type: 'CLEAR_CHANNEL'; channelId: string }
  | { type: 'PERMISSION_ADDED'; request: PermissionRequest }
  | {
      type: 'PERMISSION_RESOLVED';
      channelId: string;
      requestId: string;
      toolUseId: string | undefined;
      decision: PermissionDecision;
    }
  | { type: 'PERMISSIONS_CANCELLED'; channelId: string; requestIds: string[]; toolUseIds: string[] }
  | { type: 'COMMENT_ADDED'; channelId: string; toolUseId: string; comment: PlanComment }
  | { type: 'COMMENT_REMOVED'; channelId: string; toolUseId: string; commentId: string };

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
      const { [action.channelId]: _removedPermissions, ...restPermissions } = state.permissions;
      void _removedPermissions;
      return { ...state, channels: rest, permissions: restPermissions };
    }
    case 'PERMISSION_ADDED':
      return withPermissions(state, action.request.channelId, (prev) =>
        prev.pending.some((r) => r.requestId === action.request.requestId)
          ? prev
          : { ...prev, pending: [...prev.pending, action.request] },
      );
    case 'PERMISSION_RESOLVED':
      return withPermissions(state, action.channelId, (prev) => {
        const next = { ...prev, pending: prev.pending.filter((r) => r.requestId !== action.requestId) };
        const { toolUseId, decision } = action;
        if (toolUseId === undefined) return next;
        next.decisions = { ...prev.decisions, [toolUseId]: decision.behavior === 'allow' ? 'allowed' : 'denied' };
        if (decision.behavior === 'allow' && isStringRecord(decision.updatedInput.answers)) {
          next.answers = { ...prev.answers, [toolUseId]: { ...decision.updatedInput.answers } };
        }
        return next;
      });
    case 'PERMISSIONS_CANCELLED':
      return withPermissions(state, action.channelId, (prev) => ({
        ...prev,
        pending: prev.pending.filter((r) => !action.requestIds.includes(r.requestId)),
        decisions: {
          ...prev.decisions,
          ...Object.fromEntries(action.toolUseIds.map((id) => [id, 'cancelled' as const])),
        },
      }));
    case 'COMMENT_ADDED':
      return withPermissions(state, action.channelId, (prev) => ({
        ...prev,
        planComments: {
          ...prev.planComments,
          [action.toolUseId]: [...(prev.planComments[action.toolUseId] ?? []), action.comment],
        },
      }));
    case 'COMMENT_REMOVED':
      return withPermissions(state, action.channelId, (prev) => ({
        ...prev,
        planComments: {
          ...prev.planComments,
          [action.toolUseId]: (prev.planComments[action.toolUseId] ?? []).filter((c) => c.id !== action.commentId),
        },
      }));
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

export function useChannelPermissions(channelId: string): {
  permissions: ChannelPermissions;
  dispatch: React.Dispatch<Action> | undefined;
} {
  const ctx = useContext(SessionContext);
  return { permissions: ctx?.state.permissions[channelId] ?? emptyPermissions, dispatch: ctx?.dispatch };
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
      if (msg.type === 'permission_request') {
        dispatch({ type: 'PERMISSION_ADDED', request: msg.request });
        return;
      }
      if (msg.type === 'permission_resolved') {
        dispatch({
          type: 'PERMISSION_RESOLVED',
          channelId: msg.channelId,
          requestId: msg.requestId,
          toolUseId: msg.toolUseId,
          decision: msg.decision,
        });
        return;
      }
      if (msg.type === 'permission_cancelled') {
        dispatch({
          type: 'PERMISSIONS_CANCELLED',
          channelId: msg.channelId,
          requestIds: msg.requestIds,
          toolUseIds: msg.toolUseIds,
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
