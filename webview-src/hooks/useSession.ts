import { useCallback } from 'react';
import { postMessage } from '../lib/ipc';
import type { PermissionMode } from '../lib/ipc';

interface LaunchOptions {
  resume?: string;
  cwd?: string;
  permissionMode?: PermissionMode;
}

export function useSession() {
  const launch = useCallback((channelId: string, opts: LaunchOptions = {}): void => {
    postMessage({
      type: 'launch_claude',
      channelId,
      ...(opts.resume !== undefined ? { resume: opts.resume } : {}),
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.permissionMode !== undefined ? { permissionMode: opts.permissionMode } : {}),
    });
  }, []);

  const sendText = useCallback((channelId: string, text: string, requestId: string): void => {
    postMessage({
      type: 'control_request',
      channelId,
      requestId,
      data: { type: 'user', message: text },
    });
  }, []);

  const interrupt = useCallback((channelId: string): void => {
    postMessage({ type: 'interrupt_claude', channelId });
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

  return { launch, sendText, interrupt, close, listSessions, deleteSession, renameSession };
}
