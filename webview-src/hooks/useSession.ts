import { useCallback } from 'react';
import { postMessage } from '../lib/ipc';
import type { PermissionMode, ThinkingLevel } from '../lib/ipc';

interface LaunchOptions {
  resume?: string;
  cwd?: string;
  permissionMode?: PermissionMode;
  thinkingLevel?: ThinkingLevel;
  model?: string;
}

export function useSession() {
  const launch = useCallback((channelId: string, opts: LaunchOptions = {}): void => {
    postMessage({
      type: 'launch_claude',
      channelId,
      ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.permissionMode !== undefined ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    });
  }, []);

  const sendText = useCallback((channelId: string, text: string, requestId: string): void => {
    // Send raw text; the host wraps it in the CLI's stream-json user envelope.
    postMessage({ type: 'control_request', channelId, requestId, text });
  }, []);

  const interrupt = useCallback((channelId: string): void => {
    postMessage({ type: 'interrupt_claude', channelId });
  }, []);

  const compact = useCallback((channelId: string): void => {
    // Compaction is the /compact slash command over the stream-json input
    // (the `compact` control subtype is unsupported — verified against the CLI).
    postMessage({ type: 'control_request', channelId, requestId: crypto.randomUUID(), text: '/compact' });
  }, []);

  const requestContextUsage = useCallback((channelId: string): void => {
    postMessage({ type: 'get_context_usage', channelId });
  }, []);

  const close = useCallback((channelId: string): void => {
    postMessage({ type: 'close_channel', channelId });
  }, []);

  const listSessions = useCallback((includeHidden = false): void => {
    postMessage({ type: 'list_sessions_request', includeHidden });
  }, []);

  const deleteSession = useCallback((sessionId: string): void => {
    postMessage({ type: 'delete_session', sessionId });
  }, []);

  const renameSession = useCallback((sessionId: string, title: string): void => {
    postMessage({ type: 'rename_session', sessionId, title });
  }, []);

  const createGroup = useCallback((name: string): void => {
    postMessage({ type: 'create_session_group', name });
  }, []);

  const renameGroup = useCallback((groupId: string, name: string): void => {
    postMessage({ type: 'rename_session_group', groupId, name });
  }, []);

  const deleteGroup = useCallback((groupId: string): void => {
    postMessage({ type: 'delete_session_group', groupId });
  }, []);

  const moveSessionsToGroup = useCallback((sessionIds: string[], groupId: string | null): void => {
    postMessage({ type: 'move_sessions_to_group', sessionIds, groupId });
  }, []);

  return {
    launch,
    sendText,
    interrupt,
    compact,
    requestContextUsage,
    close,
    listSessions,
    deleteSession,
    renameSession,
    createGroup,
    renameGroup,
    deleteGroup,
    moveSessionsToGroup,
  };
}
